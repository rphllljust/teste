import { databasePool } from '../../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}):Promise<Response>{let context:RequestContext|undefined;try{context=requestContext(request);const {id}=await params;const e=await databasePool().query(`SELECT id,effective_date AS "effectiveDate",source_reference AS "sourceReference",description,status,
COALESCE((SELECT SUM(debit) FROM journal_lines WHERE entry_id=e.id),0)::text AS "debitScaled",
COALESCE((SELECT SUM(credit) FROM journal_lines WHERE entry_id=e.id),0)::text AS "creditScaled",
reversal_of AS "reversalOf",(SELECT r.id FROM journal_entries r WHERE r.reversal_of=e.id LIMIT 1) AS "reversalId"
FROM journal_entries e WHERE e.id=$1 AND e.actor_id=$2 LIMIT 1`,[id,context.actorId]);if(!e.rowCount)throw new ApiError(404,'NOT_FOUND','Lançamento não encontrado.');const lines=await databasePool().query(`SELECT l.id,a.code,a.name,l.debit::text AS "debitScaled",l.credit::text AS "creditScaled" FROM journal_lines l JOIN chart_accounts a ON a.id=l.account_id WHERE l.entry_id=$1 ORDER BY l.id`,[id]);return respond({entry:e.rows[0],lines:lines.rows},context);}catch(error){return failure(error,context);}}
