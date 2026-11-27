import {z} from 'zod';
import {database} from '../../../../../../db/raw';
import {payableBalance} from '../../../../../../lib/projections/payables';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../../../lib/api/http';
import {assertFinancePeriodOpen,lockFinancePeriodScope,registerPayablePaymentWithQuery} from '../../../../../../lib/application/finance';
const command=z.object({key:z.string().uuid(),action:z.enum(['execute','cancel']),
 expectedVersion:z.number().int().positive()}).strict();
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const id=(await params).id;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Lote inválido.');
  const parsed=command.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando ou versão inválidos.');
  const input=parsed.data;
  const hash=await fingerprint({actor:context.actorId,id,...input});
  const result=await database().transaction(async query=>{
   await lockFinancePeriodScope(query,context!.actorId);
   const fetched=await query('SELECT * FROM finance_payment_runs WHERE id=$1 AND actor_id=$2 FOR UPDATE',[id,context!.actorId]);
   if(!fetched.rowCount)throw new ApiError(404,'NOT_FOUND','Lote indisponível.');
   const run=fetched.rows[0];
   if(run.status==='posted'&&input.action==='execute'&&run.execution_key===input.key&&run.execution_hash===hash)
    return {id,status:'posted',replayed:true,paymentCount:null};
   if(run.status!=='prepared')throw new ApiError(409,'RUN_TERMINAL','O lote já foi concluído ou cancelado.');
   if(Number(run.row_version)!==input.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','O lote foi atualizado; recarregue.');
   const now=new Date().toISOString();
   if(input.action==='cancel'){
    await query("UPDATE finance_payment_runs SET status='cancelled',row_version=row_version+1,completed_at=$2 WHERE id=$1",
     [id,now]);
    await query("INSERT INTO finance_payment_run_events(id,run_id,actor_id,action,request_hash,correlation_id,created_at,metadata) VALUES($1,$2,$3,'cancelled',$4,$5,$6,'{}'::jsonb)",
     [crypto.randomUUID(),id,context!.actorId,hash,context!.correlationId,now]);
    return {id,status:'cancelled',replayed:false};
   }
   await assertFinancePeriodOpen(query,context!.actorId,String(run.effective_date));
   const items=await query('SELECT i.payable_id,i.amount,i.baseline_outstanding,i.payment_key '+
    'FROM finance_payment_run_items i WHERE i.run_id=$1 ORDER BY i.payable_id',[id]);
   if(!items.rowCount)throw new ApiError(409,'PAYMENT_RUN_EMPTY','Não há títulos neste lote.');
   // Deterministic row locks keep concurrent AP postings and payment runs serial.
   const payables=await query('SELECT p.id,('+payableBalance+')::bigint AS outstanding '+
    'FROM payables p WHERE p.actor_id=$1 AND p.id=ANY($2::text[]) ORDER BY p.id FOR UPDATE OF p',
    [context!.actorId,items.rows.map(x=>String(x.payable_id))]);
   const current=new Map(payables.rows.map(x=>[String(x.id),BigInt(String(x.outstanding))]));
   if(current.size!==items.rows.length)throw new ApiError(409,'PAYMENT_RUN_STALE','A carteira foi alterada.');
   for(const item of items.rows)
    if(current.get(String(item.payable_id))!==BigInt(String(item.baseline_outstanding)))
     throw new ApiError(409,'PAYMENT_RUN_STALE','Saldo alterado após a preparação. Recrie o lote.');
   // All individual journal postings, financial facts and audit events share THIS transaction.
   // A failure on any title rolls back every previous payment in the run.
   const payments=[];
   for(const item of items.rows){
    const requestHash=await fingerprint({runId:id,payableId:item.payable_id,
     amount:String(item.amount),paymentKey:item.payment_key,actor:context!.actorId});
    const payment=await registerPayablePaymentWithQuery(query,context!,{
     payableId:String(item.payable_id),amount:Number(item.amount),
     effectiveDate:String(run.effective_date),reference:String(run.reference),
     commandKey:String(item.payment_key),requestHash,
    });
    if(payment.replayed)throw new ApiError(409,'PAYMENT_RUN_COLLISION','Chave de pagamento previamente utilizada.');
    payments.push(payment.resource);
   }
   await query("UPDATE finance_payment_runs SET status='posted',row_version=row_version+1,execution_key=$2,execution_hash=$3,completed_at=$4 WHERE id=$1",
    [id,input.key,hash,now]);
   await query("INSERT INTO finance_payment_run_events(id,run_id,actor_id,action,request_hash,correlation_id,created_at,metadata) VALUES($1,$2,$3,'posted',$4,$5,$6,$7::jsonb)",
    [crypto.randomUUID(),id,context!.actorId,hash,context!.correlationId,now,
     JSON.stringify({paymentCount:payments.length,paymentIds:payments.map(p=>p.id)})]);
   return {id,status:'posted',replayed:false,payments};
  });
  return respond(result,context,result.replayed?200:201);
 }catch(error){return failure(error,context);}
}
