import {database} from '../../../db/raw';
import {failure,requestContext,respond,type RequestContext} from '../../../lib/api/http';

export const dynamic='force-dynamic';

/** Read-only operational agenda. All rows are backed by PostgreSQL and owner-scoped. */
export async function GET(request:Request){
  let context:RequestContext|undefined;
  try {
    context=requestContext(request);
    const result=await database().prepare(
      'SELECT s.order_id AS "orderId",o.title,o.client,o.status,s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.location,s.version,(SELECT COUNT(*)::int FROM field_order_assignments a WHERE a.owner_id=s.owner_id AND a.order_id=s.order_id AND a.active=true) AS "assignedCount" FROM field_order_schedules s JOIN service_orders o ON o.id=s.order_id AND o.owner_id=s.owner_id WHERE s.owner_id=? ORDER BY s.starts_at,s.order_id LIMIT 100',
    ).bind(context.actorId).all();
    return respond({items:result.results},context);
  }catch(error){return failure(error,context);}
}
