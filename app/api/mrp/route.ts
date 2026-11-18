import { z } from 'zod';
import { database } from '../../../db/raw';
import { ApiError, failure, jsonBody, requestContext, respond, type RequestContext } from '../../../lib/api/http';
import { calculateMaterialRequirement } from '../../../lib/application/mrp';

const command = z.object({ horizonDays: z.number().int().min(1).max(365).default(30) }).strict();
type StockRow = { id: string; unit: string; minimum: number; physicalOnHand: number };
type RecommendationRow = {
 recommendationId: string; runId: string; materialId: string;
 available: number; minimum: number; netRequirement: number; unit: string;
 approvalStatus: 'draft' | 'approved' | 'rejected' | 'converted';
 rowVersion: number; purchaseOrderId: string | null; createdAt: string;
 sku: string; name: string;
};

export async function POST(request: Request) {
 let context: RequestContext | undefined;
 try {
  context = requestContext(request, true);
  const parsed = command.safeParse(await jsonBody(request));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Horizonte de planejamento inválido.');
  const db = database();
  const rows = await db.prepare(`SELECT id,unit,minimum,
   COALESCE((SELECT SUM(delta) FROM inventory_movements m
     WHERE m.item_id=inventory_items.id AND m.owner_id=inventory_items.owner_id),0) AS "physicalOnHand"
   FROM inventory_items WHERE owner_id=? ORDER BY sku`)
   .bind(context.actorId).all<StockRow>();
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const planned = rows.results.map(row => ({
   row, calculation: calculateMaterialRequirement({ physicalOnHand: Number(row.physicalOnHand), safetyStock: Number(row.minimum) }),
  }));
  const shortages = planned.filter(item => item.calculation.netReplenishmentRequirement > 0);
  // D1 batch is transactional. The anti-duplicate condition executes inside
  // the same write transaction, preventing repeated planning from generating
  // another active purchasing proposal for an already-open material shortage.
  const statements = [
   db.prepare(`INSERT INTO mrp_runs
     (id,owner_id,actor_id,horizon_days,status,started_at)
     VALUES (?,?,?,?,'running',?)`)
     .bind(runId,context.actorId,context.actorId,parsed.data.horizonDays,now),
   ...shortages.map(({row,calculation}) => db.prepare(`INSERT INTO mrp_recommendations
    (id,run_id,owner_id,material_id,available,minimum,net_requirement,unit,status,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,'draft',?,?
    WHERE NOT EXISTS (
      SELECT 1 FROM mrp_recommendations existing
      WHERE existing.owner_id=? AND existing.material_id=? AND existing.status IN ('draft','approved')
    )`).bind(crypto.randomUUID(),runId,context!.actorId,row.id,
    calculation.projectedBalanceBeforeReplenishment,row.minimum,
    calculation.netReplenishmentRequirement,row.unit,now,now,context!.actorId,row.id)),
   db.prepare(`UPDATE mrp_runs SET status='completed',evaluated_materials=?,shortages=?,
     recommendations=(SELECT COUNT(*) FROM mrp_recommendations WHERE run_id=?),completed_at=?
     WHERE id=? AND owner_id=? AND status='running'`)
    .bind(planned.length,shortages.length,runId,now,runId,context.actorId),
  ];
  await db.batch(statements);
  const count = await db.prepare('SELECT recommendations FROM mrp_runs WHERE id=? AND owner_id=?')
   .bind(runId,context.actorId).first<{recommendations:number}>();
  return respond({runId,evaluatedMaterials:planned.length,shortages:shortages.length,
   recommendations:count?.recommendations??0,policy:'minimum-stock'},context,201);
 } catch (error) { return failure(error,context); }
}

export async function GET(request: Request) {
 let context: RequestContext | undefined;
 try {
  context = requestContext(request);
  const db = database();
  const results = await db.batch([
   db.prepare(`SELECT r.id AS "recommendationId",r.run_id AS "runId",
     r.material_id AS "materialId",r.available,r.minimum,
     r.net_requirement AS "netRequirement",r.unit,r.status AS "approvalStatus",
     r.row_version AS "rowVersion",r.purchase_order_id AS "purchaseOrderId",
     r.created_at AS "createdAt",i.sku,i.name
     FROM mrp_recommendations r
     JOIN inventory_items i ON i.id=r.material_id AND i.owner_id=r.owner_id
     WHERE r.owner_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 500`)
    .bind(context.actorId),
   db.prepare(`SELECT id,horizon_days AS "horizonDays",status,
     evaluated_materials AS "evaluatedMaterials",shortages,recommendations,
     started_at AS "startedAt",completed_at AS "completedAt"
     FROM mrp_runs WHERE owner_id=? ORDER BY started_at DESC,id DESC LIMIT 15`)
    .bind(context.actorId),
  ]);
  const recommendations=(results[0].results as RecommendationRow[]).map(row=>({
   ...row,available:Number(row.available),minimum:Number(row.minimum),
   netRequirement:Number(row.netRequirement),rowVersion:Number(row.rowVersion),
   coverageStatus:Number(row.available)<Number(row.minimum)?'attention':'covered',
  }));
  return respond({recommendations,runs:results[1].results},context);
 } catch(error){return failure(error,context);}
}
