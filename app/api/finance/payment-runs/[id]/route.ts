import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';
import {payableBalance} from '../../../../../lib/projections/payables';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const id=(await params).id;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Lote inválido.');
  const db=database();
  const r=await db.batch([
   db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').bind(),
   db.prepare('SELECT id,reference,effective_date AS "effectiveDate",status,row_version AS "rowVersion",'+
    'created_at AS "createdAt",completed_at AS "completedAt",correlation_id AS "correlationId" '+
    'FROM finance_payment_runs WHERE id=? AND actor_id=?').bind(id,context.actorId),
   db.prepare('SELECT i.id,i.payable_id AS "payableId",p.supplier,p.source_reference AS "sourceReference",'+
    'i.amount::text AS "amountScaled",i.baseline_outstanding::text AS "baselineOutstandingScaled",'+
    '('+payableBalance+')::text AS "currentOutstandingScaled",'+
    'CASE WHEN pay.id IS NOT NULL THEN pay.id ELSE NULL END AS "paymentId" '+
    'FROM finance_payment_run_items i JOIN finance_payment_runs r ON r.id=i.run_id AND r.actor_id=? '+
    'JOIN payables p ON p.id=i.payable_id AND p.actor_id=r.actor_id '+
    'LEFT JOIN payable_payments pay ON pay.id=i.payment_key '+
    'WHERE i.run_id=? ORDER BY p.due_date,p.id').bind(context.actorId,id),
   db.prepare('SELECT action,created_at AS "createdAt",correlation_id AS "correlationId" '+
    'FROM finance_payment_run_events WHERE run_id=? AND actor_id=? ORDER BY created_at,id').bind(id,context.actorId),
  ]);
  if(!r[1].results.length)throw new ApiError(404,'NOT_FOUND','Lote não encontrado.');
  return respond({run:r[1].results[0],items:r[2].results,history:r[3].results,
   warnings:['A confirmação registra baixas no livro financeiro local e lançamentos segundo políticas ativas; não realiza transferência bancária.']},context);
 }catch(error){return failure(error,context);}
}
