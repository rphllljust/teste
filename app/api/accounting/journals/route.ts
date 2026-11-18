import { databasePool } from '../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
export async function GET(request:Request):Promise<Response>{let context:RequestContext|undefined;try{context=requestContext(request);const url=new URL(request.url);const page=Math.max(1,Number(url.searchParams.get('page')||1));const pageSize=Math.min(50,Math.max(1,Number(url.searchParams.get('pageSize')||20)));const offset=(page-1)*pageSize;const r=await databasePool().query(`SELECT e.id,e.effective_date AS "effectiveDate",e.source_reference AS "sourceReference",e.description,e.status,
COALESCE(SUM(l.debit),0)::text AS "debitScaled",COALESCE(SUM(l.credit),0)::text AS "creditScaled",e.reversal_of AS "reversalOf",
(SELECT r.id FROM journal_entries r WHERE r.reversal_of=e.id LIMIT 1) AS "reversalId"
FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id=e.id
WHERE e.actor_id=$1 GROUP BY e.id ORDER BY e.effective_date DESC,e.id DESC LIMIT $2 OFFSET $3`,[context.actorId,pageSize+1,offset]);const items=r.rows.slice(0,pageSize);return respond({items,pageInfo:{page, pageSize, hasMore:r.rows.length>pageSize}},context);}catch(error){return failure(error,context);}}
