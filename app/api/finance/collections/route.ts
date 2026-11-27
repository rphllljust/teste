import {z} from 'zod';
import {database} from '../../../../db/raw';
import {outstandingExpression} from '../../../../lib/projections/operation';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
import {lockFinancePeriodScope} from '../../../../lib/application/finance';
export const dynamic='force-dynamic';
const create=z.object({id:z.string().uuid(),receivableId:z.string().uuid(),
 note:z.string().trim().min(5).max(1200)}).strict();
export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const params=new URL(request.url).searchParams;
  const status=params.get('status')??'all',page=Number(params.get('page')??'1');
  if(!['all','open','promised','settled','cancelled'].includes(status)||!Number.isSafeInteger(page)||page<1||page>10000)
   throw new ApiError(400,'VALIDATION_FAILED','Filtro de cobrança inválido.');
  const db=database();
  const where=status==='all'?'':' AND c.status=?';
  const values=status==='all'?[context.actorId]:[context.actorId,status];
  const r=await db.batch([
   db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').bind(),
   db.prepare('SELECT c.id,c.status,c.row_version AS "rowVersion",c.promise_date AS "promiseDate",'+
    'c.created_at AS "createdAt",c.updated_at AS "updatedAt",'+
    'r.id AS "receivableId",r.due_date AS "dueDate",'+
    'o.id AS "orderId",o.title AS "orderTitle",o.client,'+
    '('+outstandingExpression+')::text AS "outstandingScaled" '+
    'FROM finance_collection_cases c JOIN receivables r ON r.id=c.receivable_id '+
    'JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id '+
    'WHERE c.actor_id=? AND o.owner_id=c.actor_id'+where+
    ' ORDER BY c.updated_at DESC,c.id DESC LIMIT 21 OFFSET ?').bind(...values,(page-1)*20),
   db.prepare('SELECT COUNT(*)::int AS count FROM finance_collection_cases c WHERE c.actor_id=?'+where).bind(...values),
   db.prepare('SELECT r.id AS "receivableId",o.client,o.title AS "orderTitle",r.due_date AS "dueDate",'+
    '('+outstandingExpression+')::text AS "outstandingScaled" '+
    'FROM receivables r JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id '+
    'WHERE o.owner_id=? AND ('+outstandingExpression+')>0 '+
    'AND NOT EXISTS (SELECT 1 FROM finance_collection_cases c WHERE c.actor_id=o.owner_id AND c.receivable_id=r.id) '+
    'ORDER BY r.due_date,r.id LIMIT 50').bind(context.actorId),
  ]);
  const total=Number((r[2].results[0] as {count?:number})?.count??0);
  return respond({items:r[1].results.slice(0,20),candidates:r[3].results,pageInfo:{page,total,hasMore:total>page*20},
   warnings:['Acompanhamentos registram contatos e compromissos informados; não enviam mensagens nem comprovam liquidação.']},context);
 }catch(error){return failure(error,context);}
}
export async function POST(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const parsed=create.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Título ou anotação inválidos.');
  const data=parsed.data,hash=await fingerprint({actor:context.actorId,data});
  const response=await database().transaction(async query=>{
   await lockFinancePeriodScope(query,context!.actorId);
   const prior=await query('SELECT id,actor_id,request_hash FROM finance_collection_cases WHERE id=$1',[data.id]);
   if(prior.rowCount){
    if(prior.rows[0].actor_id!==context!.actorId||prior.rows[0].request_hash!==hash)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador de acompanhamento já utilizado.');
    return {id:data.id,status:'open',replayed:true};
   }
   const title=await query('SELECT r.id,('+outstandingExpression+')::bigint AS outstanding '+
    'FROM receivables r JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id '+
    'WHERE r.id=$1 AND o.owner_id=$2 FOR UPDATE OF r',[data.receivableId,context!.actorId]);
   if(!title.rowCount)throw new ApiError(404,'NOT_FOUND','Título indisponível.');
   if(BigInt(String(title.rows[0].outstanding))<=0n)throw new ApiError(409,'COLLECTION_SETTLED','Título sem saldo a cobrar.');
   const existing=await query('SELECT id FROM finance_collection_cases WHERE actor_id=$1 AND receivable_id=$2',[context!.actorId,data.receivableId]);
   if(existing.rowCount)throw new ApiError(409,'COLLECTION_EXISTS','Já existe acompanhamento deste título.');
   const now=new Date().toISOString();
   await query('INSERT INTO finance_collection_cases '+
    '(id,actor_id,receivable_id,status,row_version,source_note,request_hash,correlation_id,created_at,updated_at) '+
    "VALUES($1,$2,$3,'open',1,$4,$5,$6,$7,$7)",
    [data.id,context!.actorId,data.receivableId,data.note,hash,context!.correlationId,now]);
   await query("INSERT INTO finance_collection_events(id,case_id,actor_id,action,note,request_hash,correlation_id,created_at) VALUES($1,$2,$3,'opened',$4,$5,$6,$7)",
    [crypto.randomUUID(),data.id,context!.actorId,data.note,hash,context!.correlationId,now]);
   return {id:data.id,status:'open',replayed:false};
  });
  return respond(response,context,response.replayed?200:201);
 }catch(error){return failure(error,context);}
}
