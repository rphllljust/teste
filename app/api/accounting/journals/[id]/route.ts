import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};

export async function GET(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const {id}=await params;
    if(!z.string().uuid().safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador contábil inválido.');
    const result=await database().batch([
      database().prepare(
        'SELECT j.id,j.effective_date AS "effectiveDate",j.source_reference AS "sourceReference",j.description,j.status,j.reversal_of AS "reversalOf",r.id AS "reversalId" FROM journal_entries j LEFT JOIN journal_entries r ON r.reversal_of=j.id AND r.actor_id=j.actor_id WHERE j.id=? AND j.actor_id=? AND j.status=?',
      ).bind(id,context.actorId,'posted'),
      database().prepare(
        'SELECT l.id,a.code,a.name,l.debit::text AS "debitScaled",l.credit::text AS "creditScaled" FROM journal_lines l JOIN chart_accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.entry_id WHERE l.entry_id=? AND j.actor_id=? AND a.actor_id=? ORDER BY l.id',
      ).bind(id,context.actorId,context.actorId),
    ]);
    const entry=result[0].results[0];
    if(!entry)throw new ApiError(404,'NOT_FOUND','Lançamento não encontrado.');
    return respond({entry,lines:result[1].results},context);
  }catch(error){return failure(error,context);}
}
