import { z } from 'zod';
import { database } from '../../../../db/raw';
import { lockFinancePeriodScope } from '../../../../lib/application/finance';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
export const dynamic='force-dynamic';
const period=z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
const create=z.object({id:z.string().uuid(),accountId:z.string().uuid(),periodMonth:period,
 plannedScaled:z.string().regex(/^[1-9][0-9]{0,15}$/),reference:z.string().trim().min(3).max(160)}).strict();
type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>}>;
export async function assertBudgetMonthOpen(q:Query,owner:string,month:string) {
 const found=await q("SELECT 1 FROM finance_period_closes WHERE actor_id=$1 AND status='closed' "+
  "AND period_start <= ((to_date($2,'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date)::text "+
  "AND period_end >= $2 LIMIT 1",[owner,month+'-01']);
 if(found.rows.length)throw new ApiError(409,'FINANCE_PERIOD_CLOSED','A competência orçamentária está encerrada.');
}
export async function GET(request:Request) {
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const month=new URL(request.url).searchParams.get('periodMonth')??new Date().toISOString().slice(0,7);
  if(!period.safeParse(month).success)throw new ApiError(400,'VALIDATION_FAILED','Competência inválida.');
  const rows=await database().transaction(async q=>{
   await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const result=await q(
    'SELECT b.id,b.account_id AS "accountId",b.period_month AS "periodMonth",b.planned_scaled::text AS "plannedScaled",'+
    'b.state,b.row_version AS "rowVersion",b.reference,b.approved_at AS "approvedAt",c.code AS "accountCode",'+
    'c.name AS "accountName",c.type AS "accountType",'+
    "COALESCE((SELECT SUM(CASE WHEN c.type='expense' THEN l.debit::numeric-l.credit::numeric "+
    "ELSE l.credit::numeric-l.debit::numeric END) FROM journal_lines l "+
    "JOIN journal_entries j ON j.id=l.entry_id WHERE l.account_id=b.account_id "+
    "AND j.actor_id=b.actor_id AND j.status='posted' AND j.effective_date >= (b.period_month||'-01') "+
    "AND j.effective_date < ((to_date(b.period_month||'-01','YYYY-MM-DD')+interval '1 month')::date)::text),0)::text AS \"actualScaled\" "+
    'FROM controlling_budgets b JOIN chart_accounts c ON c.id=b.account_id AND c.actor_id=b.actor_id '+
    'WHERE b.actor_id=$1 AND b.period_month=$2 ORDER BY c.code,b.id',[ctx!.actorId,month]);
   return result.rows;
  });
  let planned=0n,actual=0n,approved=0,drafts=0;
  const items=rows.map(row=>{
   const p=BigInt(String(row.plannedScaled)),a=BigInt(String(row.actualScaled));
   if(row.state==='approved'){planned+=p;actual+=a;approved++;}else drafts++;
   return {...row,deviationScaled:(a-p).toString()};
  });
  return respond({periodMonth:month,items,summary:{approved,drafts,plannedScaled:planned.toString(),
   actualScaled:actual.toString(),deviationScaled:(actual-planned).toString()},
   provenance:'Dotação persistida versus diário publicado por conta e competência, incluindo estornos.',
   disclaimer:'Aprovação pelo proprietário autenticado; aprovação independente por outro operador não implementada.'},ctx);
 }catch(e){return failure(e,ctx);}
}
export async function POST(request:Request) {
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const parsed=create.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Dados de orçamento inválidos.');
  const data=parsed.data,hash=await fingerprint({actor:ctx.actorId,scope:'budget.create',data});
  const result=await database().transaction(async q=>{
   await lockFinancePeriodScope(q,ctx!.actorId);
   const prior=await q('SELECT actor_id,request_hash FROM controlling_budgets WHERE id=$1 FOR UPDATE',[data.id]);
   if(prior.rows.length){
    if(prior.rows[0].actor_id!==ctx!.actorId||prior.rows[0].request_hash!==hash)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador de orçamento reutilizado.');
    return {id:data.id,replayed:true};
   }
   await assertBudgetMonthOpen(q,ctx!.actorId,data.periodMonth);
   const acc=await q("SELECT id FROM chart_accounts WHERE id=$1 AND actor_id=$2 AND active=1 "+
    "AND type IN ('expense','revenue') FOR SHARE",[data.accountId,ctx!.actorId]);
   if(!acc.rows.length)throw new ApiError(409,'BUDGET_ACCOUNT_INVALID','Escolha conta própria ativa de receita ou despesa.');
   const now=new Date().toISOString();
   await q('INSERT INTO controlling_budgets(id,actor_id,account_id,period_month,planned_scaled,state,row_version,reference,request_hash,correlation_id,created_at,updated_at) '+
    "VALUES($1,$2,$3,$4,$5,'draft',1,$6,$7,$8,$9,$9)",
    [data.id,ctx!.actorId,data.accountId,data.periodMonth,data.plannedScaled,data.reference,hash,ctx!.correlationId,now]);
   await q('INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) '+
    "VALUES($1,'controlling_budget',$2,'created',$3,$4,$5,$6,$7)",
    [crypto.randomUUID(),data.id,ctx!.actorId,hash,ctx!.correlationId,
     JSON.stringify({accountId:data.accountId,periodMonth:data.periodMonth,plannedScaled:data.plannedScaled}),now]);
   return {id:data.id,rowVersion:1,state:'draft',replayed:false};
  });
  return respond(result,ctx,result.replayed?200:201);
 }catch(e){
  if(e&&typeof e==='object'&&'code' in e&&e.code==='23505')
   return failure(new ApiError(409,'BUDGET_EXISTS','Já existe dotação para esta conta e competência.'),ctx);
  return failure(e,ctx);
 }
}
