import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {outstandingExpression} from '../../../../../lib/projections/operation';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const id=(await params).id;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Acompanhamento inválido.');
  const db=database();
  const r=await db.batch([
   db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').bind(),
   db.prepare('SELECT c.id,c.status,c.row_version AS "rowVersion",c.promise_date AS "promiseDate",'+
    'c.source_note AS "sourceNote",c.receivable_id AS "receivableId",'+
    'o.title AS "orderTitle",o.client,r.due_date AS "dueDate",'+
    '('+outstandingExpression+')::text AS "outstandingScaled" '+
    'FROM finance_collection_cases c JOIN receivables r ON r.id=c.receivable_id '+
    'JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id '+
    'WHERE c.id=? AND c.actor_id=? AND o.owner_id=c.actor_id').bind(id,context.actorId),
   db.prepare('SELECT id,action,note,promise_date AS "promiseDate",created_at AS "createdAt",'+
    'correlation_id AS "correlationId" FROM finance_collection_events WHERE case_id=? AND actor_id=? '+
    'ORDER BY created_at ASC,id ASC LIMIT 500').bind(id,context.actorId),
  ]);
  if(!r[1].results.length)throw new ApiError(404,'NOT_FOUND','Acompanhamento indisponível.');
  return respond({case:r[1].results[0],history:r[2].results,
   warnings:['Anotações e promessas são registros internos; não comprovam contato externo, cobrança enviada ou quitação.']},context);
 }catch(error){return failure(error,context);}
}
