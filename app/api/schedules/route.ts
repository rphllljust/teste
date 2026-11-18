import {database} from '../../../db/raw';
import {failure,requestContext,respond,type RequestContext} from '../../../lib/api/http';

export const dynamic='force-dynamic';

/** Show active OS before LIMIT; prioritize upcoming windows over overdue ones. */
export async function GET(request:Request){
  let context:RequestContext|undefined;
  try {
    context=requestContext(request);
    const result=await database().prepare(
      'SELECT s.order_id AS "orderId",o.title,o.client,o.status,s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.location,s.version,(SELECT COUNT(*)::int FROM field_order_assignments a WHERE a.owner_id=s.owner_id AND a.order_id=s.order_id AND a.active=true) AS "assignedCount" FROM field_order_schedules s JOIN service_orders o ON o.id=s.order_id AND o.owner_id=s.owner_id WHERE s.owner_id=? AND o.status NOT IN (\'completed\',\'cancelled\') ORDER BY CASE WHEN s.ends_at>=CURRENT_TIMESTAMP THEN 0 ELSE 1 END,s.starts_at,s.order_id LIMIT 100',
    ).bind(context.actorId).all();
    return respond({items:result.results},context);
  }catch(error){return failure(error,context);}
}
