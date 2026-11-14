import { z } from 'zod';
import { database } from '../../../db/raw';
import { ApiError, failure, jsonBody, requestContext, respond, type RequestContext } from '../../../lib/api/http';

const command = z.object({ horizonDays: z.number().int().min(1).max(365).default(30) }).strict();
export async function POST(request: Request) {
 let context: RequestContext | undefined;
 try {
  context = requestContext(request, true);
  const input = command.parse(await jsonBody(request));
  const db = database(); const runId = crypto.randomUUID(); const now = new Date().toISOString();
  await db.prepare('INSERT INTO mrp_runs (id,owner_id,actor_id,horizon_days,status,started_at) VALUES (?,?,?,?,?,?)').bind(runId, context.actorId, context.actorId, input.horizonDays, 'running', now).run();
  const result = await db.prepare('SELECT id, unit, minimum, COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE item_id=inventory_items.id),0) AS available FROM inventory_items WHERE owner_id=?').bind(context.actorId).all();
  let shortages=0; const inserts=[];
  for (const row of result.results as Array<{id:string;unit:string;minimum:number;available:number}>) { const net=Math.max(0,row.minimum-row.available); if (!net) continue; shortages++; inserts.push(db.prepare('INSERT INTO mrp_recommendations (id,run_id,owner_id,material_id,available,minimum,net_requirement,unit,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),runId,context!.actorId,row.id,row.available,row.minimum,net,row.unit,'draft',now,now)); }
  if (inserts.length) await db.batch(inserts);
  await db.prepare('UPDATE mrp_runs SET status=?,evaluated_materials=?,shortages=?,recommendations=?,completed_at=? WHERE id=? AND owner_id=?').bind('completed',result.results.length,shortages,inserts.length,now,runId,context.actorId).run();
  return respond({runId,evaluatedMaterials:result.results.length,shortages,recommendations:inserts.length},context,201);
 } catch(error){return failure(error,context);}
}
export async function GET(request: Request){let context:RequestContext|undefined;try{context=requestContext(request);const db=database();const rows=await db.prepare('SELECT r.*,i.sku,i.name FROM mrp_recommendations r JOIN inventory_items i ON i.id=r.material_id WHERE r.owner_id=? AND r.status IN (\'draft\',\'approved\') ORDER BY r.created_at DESC LIMIT 500').bind(context.actorId).all();return respond({recommendations:rows.results},context);}catch(error){return failure(error,context);}}
