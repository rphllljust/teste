import {z} from 'zod';
import {database} from '../../../../db/raw';
import {payableBalance} from '../../../../lib/projections/payables';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,validDate,type RequestContext} from '../../../../lib/api/http';
import {assertFinancePeriodOpen} from '../../../../lib/application/finance';
export const dynamic='force-dynamic';
const input=z.object({
 id:z.string().uuid(),reference:z.string().trim().min(3).max(160),
 effectiveDate:z.string().refine(validDate),
 items:z.array(z.object({payableId:z.string().uuid(),
  amount:z.string().regex(/^\d{1,9}(?:[.,]\d{1,4})?$/)}).strict()).min(1).max(50),
}).strict();
const scaled=(s:string)=>{
 const [whole,fraction='']=s.split(/[,.]/);
 const n=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
 if(n<=0n||n>2147483647n)throw new ApiError(400,'VALIDATION_FAILED','Valor fora da capacidade da escrituração contábil.');
 return Number(n);
};
const from='FROM finance_payment_runs r';
export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const page=Number(new URL(request.url).searchParams.get('page')??'1');
  if(!Number.isSafeInteger(page)||page<1||page>10000)throw new ApiError(400,'VALIDATION_FAILED','Página inválida.');
  const db=database();
  const rows=await db.batch([
   db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').bind(),
   db.prepare('SELECT r.id,r.reference,r.effective_date AS "effectiveDate",r.status,r.row_version AS "rowVersion",'+
    'r.created_at AS "createdAt",r.completed_at AS "completedAt",'+
    '(SELECT COUNT(*)::int FROM finance_payment_run_items i WHERE i.run_id=r.id) AS "itemCount",'+
    '(SELECT COALESCE(SUM(amount),0)::text FROM finance_payment_run_items i WHERE i.run_id=r.id) AS "totalScaled" '+
    from+' WHERE r.actor_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET ?').bind(context.actorId,(page-1)*20),
   db.prepare('SELECT COUNT(*)::int AS count FROM finance_payment_runs WHERE actor_id=?').bind(context.actorId),
  ]);
  const total=Number((rows[2].results[0] as {count?:number})?.count??0);
  return respond({items:rows[1].results.slice(0,20),pageInfo:{page,total,hasMore:total>page*20},
   warnings:['O lote prepara lançamentos internos. Não transmite pagamentos ao banco.'],generatedAt:new Date().toISOString()},context);
 }catch(error){return failure(error,context);}
}
export async function POST(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const parsed=input.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Verifique referência, data e títulos (máximo 50).');
  const data=parsed.data;
  const amounts=data.items.map(item=>({...item,amountScaled:scaled(item.amount)}));
  const ids=amounts.map(x=>x.payableId);
  if(new Set(ids).size!==ids.length)throw new ApiError(400,'VALIDATION_FAILED','Título duplicado no mesmo lote.');
  const hash=await fingerprint({actor:context.actorId,payload:data});
  const result=await database().transaction(async query=>{
   await assertFinancePeriodOpen(query,context!.actorId,data.effectiveDate);
   const existing=await query('SELECT actor_id,request_hash,status FROM finance_payment_runs WHERE id=$1 FOR UPDATE',[data.id]);
   if(existing.rowCount){
    if(existing.rows[0].actor_id!==context!.actorId||existing.rows[0].request_hash!==hash)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador de lote reutilizado.');
    return {id:data.id,status:existing.rows[0].status,replayed:true};
   }
   const rows=await query('SELECT p.id,('+payableBalance+')::bigint AS outstanding '+
    'FROM payables p WHERE p.actor_id=$1 AND p.id=ANY($2::text[]) ORDER BY p.id FOR UPDATE OF p',
    [context!.actorId,ids]);
   const map=new Map(rows.rows.map(row=>[String(row.id),BigInt(String(row.outstanding))]));
   if(map.size!==ids.length)throw new ApiError(404,'NOT_FOUND','Um ou mais títulos não pertencem à empresa autenticada.');
   for(const item of amounts)
    if(BigInt(item.amountScaled)>map.get(item.payableId)!)
     throw new ApiError(409,'PAYMENT_RUN_STALE','O valor excede o saldo atual do título.');
   const now=new Date().toISOString();
   await query('INSERT INTO finance_payment_runs(id,actor_id,reference,effective_date,status,row_version,request_hash,correlation_id,created_at) '+
    "VALUES($1,$2,$3,$4,'prepared',1,$5,$6,$7)",
    [data.id,context!.actorId,data.reference,data.effectiveDate,hash,context!.correlationId,now]);
   for(const item of amounts)
    await query('INSERT INTO finance_payment_run_items(id,run_id,payable_id,amount,baseline_outstanding,payment_key) '+
     'VALUES($1,$2,$3,$4,$5,$6)',
     [crypto.randomUUID(),data.id,item.payableId,item.amountScaled,
      Number(map.get(item.payableId)!),crypto.randomUUID()]);
   await query('INSERT INTO finance_payment_run_events(id,run_id,actor_id,action,request_hash,correlation_id,created_at,metadata) '+
    "VALUES($1,$2,$3,'prepared',$4,$5,$6,$7::jsonb)",
    [crypto.randomUUID(),data.id,context!.actorId,hash,context!.correlationId,now,JSON.stringify({itemCount:amounts.length})]);
   return {id:data.id,status:'prepared',replayed:false};
  });
  return respond(result,context,result.replayed?200:201);
 }catch(error){return failure(error,context);}
}
