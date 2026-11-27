import {z} from 'zod';
import {database} from '../../../../../../db/raw';
import {payableBalance} from '../../../../../../lib/projections/payables';
import {ApiError,requestContext,respond,failure,type RequestContext} from '../../../../../../lib/api/http';
import {assessPaymentRunReadiness} from '../../../../../../lib/domain/payment-run-readiness.mjs';
export const dynamic='force-dynamic';
/** Pre-commit AP gate, no writes. The POST execute handler remains authoritative.
 * All records are the authenticated financial owner only; missing foreign items fail closed.
 */
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const runId=(await params).id;
  if(!z.string().uuid().safeParse(runId).success)throw new ApiError(400,'VALIDATION_FAILED','Lote inválido.');
  const result=await database().transaction(async query=>{
   await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const runs=await query('SELECT id,actor_id,reference,effective_date,status,row_version FROM finance_payment_runs '+
    'WHERE id=$1 AND actor_id=$2',[runId,ctx!.actorId]);
   if(!runs.rows.length)throw new ApiError(404,'NOT_FOUND','Lote indisponível.');
   const run=runs.rows[0];
   const lines=await query(
    'SELECT i.payable_id,i.amount::text AS "amountScaled",i.baseline_outstanding::text AS "baselineOutstandingScaled",'+
    'CASE WHEN p.id IS NULL THEN NULL ELSE ('+payableBalance+')::text END AS "currentOutstandingScaled",'+
    'pay.id AS "paymentId" FROM finance_payment_run_items i '+
    'LEFT JOIN payables p ON p.id=i.payable_id AND p.actor_id=$2 '+
    'LEFT JOIN payable_payments pay ON pay.id=i.payment_key AND pay.actor_id=$2 '+
    'WHERE i.run_id=$1 ORDER BY i.payable_id',[runId,ctx!.actorId]);
   const closed=await query("SELECT 1 FROM finance_period_closes WHERE actor_id=$1 AND status='closed' "+
    'AND period_start<=$2 AND period_end>=$2 LIMIT 1',[ctx!.actorId,run.effective_date]);
   const rules=await query('SELECT pr.id,pr.debit_account_id,pr.credit_account_id,'+
    'd.type AS debit_type,d.active AS debit_active,d.actor_id AS debit_owner,'+
    'c.type AS credit_type,c.active AS credit_active,c.actor_id AS credit_owner '+
    'FROM accounting_posting_rules pr LEFT JOIN chart_accounts d ON d.id=pr.debit_account_id '+
    'LEFT JOIN chart_accounts c ON c.id=pr.credit_account_id '+
    "WHERE pr.actor_id=$1 AND pr.source_type='payable_payment' AND pr.active=1",
    [ctx!.actorId]);
   const cfg=rules.rows[0],enabled=rules.rows.length>0;
   const valid=enabled&&rules.rows.length===1&&cfg.debit_type==='liability'&&cfg.credit_type==='asset'&&
    Number(cfg.debit_active)===1&&Number(cfg.credit_active)===1&&
    cfg.debit_owner===ctx!.actorId&&cfg.credit_owner===ctx!.actorId&&cfg.debit_account_id!==cfg.credit_account_id;
   let missingCount=0;
   if(valid&&lines.rows.length){
    // The exact accrual liability must match the payment posting rule.
    const sources=await query(
     'SELECT i.payable_id,EXISTS(SELECT 1 FROM accounting_payable_links al '+
      'JOIN journal_entries j ON j.id=al.journal_id AND j.actor_id=al.actor_id '+
      'JOIN payables p ON p.id=al.payable_id AND p.actor_id=al.actor_id '+
      'WHERE al.payable_id=i.payable_id AND al.actor_id=$2 AND al.amount=p.amount '+
      "AND j.status='posted' AND j.reversal_of IS NULL "+
      'AND NOT EXISTS(SELECT 1 FROM journal_entries rev WHERE rev.reversal_of=j.id) '+
      'AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id AND account_id=$3)=p.amount) AS ready '+
     'FROM finance_payment_run_items i WHERE i.run_id=$1 ORDER BY i.payable_id',
     [runId,ctx!.actorId,cfg.debit_account_id]);
    missingCount=sources.rows.filter(r=>r.ready!==true).length;
   }
   return {run,review:assessPaymentRunReadiness({run,items:lines.rows,
    periodClosed:closed.rows.length>0,rule:{enabled,valid},originReady:{missingCount}})};
  });
  return respond({
   runId,reference:result.run.reference,effectiveDate:result.run.effective_date,
   rowVersion:Number(result.run.row_version),status:result.run.status,
   ...result.review,scope:'authenticated_owner',advisoryOnly:true,
   generatedAt:new Date().toISOString()},ctx);
 }catch(error){return failure(error,ctx);}
}
