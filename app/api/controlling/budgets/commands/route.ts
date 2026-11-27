import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { lockFinancePeriodScope } from '../../../../../lib/application/finance';
import { assertBudgetMonthOpen } from '../route';
import { ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext } from '../../../../../lib/api/http';
const command=z.discriminatedUnion('command',[
 z.object({key:z.string().uuid(),budgetId:z.string().uuid(),expectedVersion:z.number().int().positive(),command:z.literal('approve')}).strict(),
 z.object({key:z.string().uuid(),budgetId:z.string().uuid(),expectedVersion:z.number().int().positive(),command:z.literal('revise'),
  plannedScaled:z.string().regex(/^[1-9][0-9]{0,15}$/),reference:z.string().trim().min(3).max(160)}).strict(),
]);
export async function POST(request:Request) {
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const parsed=command.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando de orçamento inválido.');
  const data=parsed.data,hash=await fingerprint({actor:ctx.actorId,scope:'budget.command',data});
  const result=await database().transaction(async q=>{
   await lockFinancePeriodScope(q,ctx!.actorId);
   const existing=await q('SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',[data.key]);
   if(existing.rows.length){
    const old=existing.rows[0];
    if(old.actor_id!==ctx!.actorId||old.entity_type!=='controllingBudget'||old.entity_id!==data.budgetId||old.request_hash!==hash)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já usada.');
    return {...JSON.parse(String(old.result)),replayed:true};
   }
   const found=await q('SELECT state,row_version,period_month,planned_scaled FROM controlling_budgets WHERE id=$1 AND actor_id=$2 FOR UPDATE',
    [data.budgetId,ctx!.actorId]);
   const b=found.rows[0];
   if(!b)throw new ApiError(404,'NOT_FOUND','Orçamento não encontrado.');
   if(b.state!=='draft'||Number(b.row_version)!==data.expectedVersion)
    throw new ApiError(409,'BUDGET_VERSION_CONFLICT','Orçamento aprovado ou alterado. Recarregue.');
   await assertBudgetMonthOpen(q,ctx!.actorId,String(b.period_month));
   const now=new Date().toISOString();
   if(data.command==='approve')
    await q("UPDATE controlling_budgets SET state='approved',approved_at=$2,updated_at=$2,row_version=row_version+1 WHERE id=$1",
     [data.budgetId,now]);
   else
    await q('UPDATE controlling_budgets SET planned_scaled=$2,reference=$3,updated_at=$4,row_version=row_version+1 WHERE id=$1',
     [data.budgetId,data.plannedScaled,data.reference,now]);
   await q('INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [crypto.randomUUID(),'controlling_budget',data.budgetId,data.command==='approve'?'approved':'revised',
     ctx!.actorId,hash,ctx!.correlationId,JSON.stringify({fromVersion:data.expectedVersion,toVersion:data.expectedVersion+1,
      beforeScaled:String(b.planned_scaled),...(data.command==='revise'?{afterScaled:data.plannedScaled}:{})}),now]);
   const receipt={ok:true,budgetId:data.budgetId,state:data.command==='approve'?'approved':'draft',
    rowVersion:data.expectedVersion+1,refreshPolicy:['controlling.budgets','accounting.ledger']};
   await q('INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [data.key,ctx!.actorId,'controllingBudget',data.budgetId,data.command,hash,JSON.stringify(receipt),ctx!.correlationId,now]);
   return receipt;
  });
  return respond(result,ctx,result.replayed?200:201);
 }catch(e){return failure(e,ctx);}
}
