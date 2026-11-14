import { database } from '../../../db/raw';
import { requestContext, respond, failure, type RequestContext } from '../../../lib/api/http';

export async function GET(request: Request) {
 let context: RequestContext | undefined;
 try {
  context = requestContext(request);
  const db = database();
  const rows = await db.prepare('SELECT id, sku, name, unit, minimum, COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE item_id=inventory_items.id),0) AS available FROM inventory_items WHERE owner_id=? ORDER BY sku LIMIT 500').bind(context.actorId).all();
  const items = (rows.results as Array<{id:string;sku:string;name:string;unit:string;minimum:number;available:number}>).map(item => ({...item, netRequirement: Math.max(0, item.minimum - item.available), status: item.available <= item.minimum ? 'attention' : 'covered'}));
  return respond({items, generatedAt: new Date().toISOString()}, context);
 } catch (error) { return failure(error, context); }
}
