import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { executionInput, quantityScaled, resourceKinds } from '../../../../../lib/domain/execution';
import { escapedLike } from '../../../../../lib/api/query';
import { caseInsensitiveContains } from '../../../../../lib/api/postgres-query.mjs';

const query = z.object({
  q: z.string().trim().max(160).default(''),
  resourceKind: z.enum(resourceKinds).optional(),
  state: z.enum(['active', 'corrected']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(50),
}).strict();

function project(row: Record<string, unknown>) {
  return { id: String(row.id), resourceLabel: String(row.resource_kind), description: String(row.description), quantityScaled: String(row.quantity), unit: String(row.unit), resourceReference: row.resource_reference ? String(row.resource_reference) : null, effectiveDate: String(row.effective_date), reference: String(row.reference), state: { code: row.reverses_id ? 'corrected' : 'active', label: row.reverses_id ? 'Anulado' : 'Ativo' }, availableCommands: row.reverses_id ? [] : [{ id: 'void', label: 'Anular apontamento', expectedVersion: 1 }] };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const id = (await params).id;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Ordem inválida.');
    const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Consulta de execução inválida.');
    const { page, pageSize, state, q, resourceKind } = parsed.data;
    const offset = (page - 1) * pageSize;
    const from = 'FROM execution_entries e JOIN service_orders o ON o.id=e.order_id WHERE e.order_id=? AND o.owner_id=?';
    const stateFilter = state === 'active' ? "e.kind='report' AND NOT EXISTS (SELECT 1 FROM execution_entries reversal WHERE reversal.reverses_id=e.id)" : "e.kind='report' AND EXISTS (SELECT 1 FROM execution_entries reversal WHERE reversal.reverses_id=e.id)";
    const conditions = [stateFilter];
    const values = [id, context.actorId];
    if (q) {
      conditions.push(caseInsensitiveContains(['e.description', 'e.reference', 'e.resource_reference']));
      const pattern = escapedLike(q);
      values.push(pattern, pattern, pattern);
    }
    if (resourceKind) {
      conditions.push('e.resource_kind=?');
      values.push(resourceKind);
    }
    const filtered = from + ' AND ' + conditions.join(' AND ');
    const db = database();
    const rows = await db.batch([
      db.prepare('SELECT id,title,client,status,version FROM service_orders WHERE id=? AND owner_id=?').bind(id, context.actorId),
      db.prepare(`SELECT e.* ${filtered} ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?`).bind(...values, pageSize, offset),
      db.prepare(`SELECT count(*)::int total ${filtered}`).bind(...values),
      ...(q || resourceKind ? [db.prepare(`SELECT count(*)::int total ${from} AND ${stateFilter}`).bind(id, context.actorId)] : []),
    ]);
    const order = rows[0].results[0] as Record<string, unknown> | undefined;
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Ordem de serviço não encontrada.');
    const items = (rows[1].results as Record<string, unknown>[]).map(project);
    const total = Number((rows[2].results[0] as { total: number }).total);
    const sourceCount = rows[3]?.results[0] as { total: number } | undefined;
    const sourceTotal = sourceCount ? Number(sourceCount.total) : total;
    return respond({ order: { id: String(order.id), title: String(order.title), client: String(order.client), status: String(order.status), version: Number(order.version), availableCommands: [] }, items, pageInfo: { page, limit: pageSize, offset, total, sourceTotal, hasMore: page * pageSize < total }, availableCommands: String(order.status) === 'executing' ? [{ id: 'report', label: 'Registrar execução', expectedVersion: Number(order.version) }] : [], warnings: [] }, context);
  } catch (error) { return failure(error, context); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const id = (await params).id;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Ordem inválida.');
    const parsed = executionInput.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Apontamento de execução inválido.');
    const p = parsed.data;
    const hash = await fingerprint({ actor: context.actorId, orderId: id, payload: p });
    const result = await database().transaction(async query => {
      const order = await query('SELECT id,status,version FROM service_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, context!.actorId]);
      if (!order.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Ordem não encontrada.');
      const row = order.rows[0] as { id: string; status: string; version: number };
      if (row.status !== 'executing') throw new ApiError(409, 'INVALID_STATE', 'Apontamentos só podem ser registrados durante a execução.');
      if (row.version !== p.version) throw new ApiError(409, 'VERSION_CONFLICT', 'A OS foi alterada. Atualize o documento.');
      const prior = await query('SELECT result,request_hash FROM order_events WHERE id=$1', [p.key]);
      if (prior.rows.length) {
        if (prior.rows[0].request_hash !== hash || !prior.rows[0].result) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave de execução já utilizada.');
        return JSON.parse(String(prior.rows[0].result)) as Record<string, unknown>;
      }
      const now = new Date().toISOString();
      if (p.command === 'report') {
        // The execution entry id is also the audit-event id. Persist the
        // event first so PostgreSQL enforces that relationship atomically.
        // Reusing the idempotency key makes the fact replay-safe.
        const entryId = p.key;
        await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [entryId, id, p.command, row.version, now, context!.actorId, hash, entryId, context!.correlationId]);
        await query('INSERT INTO execution_entries(id,order_id,kind,resource_kind,description,quantity,unit,resource_reference,effective_date,reference,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [entryId, id, 'report', p.resourceKind, p.description, quantityScaled(p.quantity), p.unit, p.resourceReference, p.effectiveDate, p.reference, context!.actorId, now]);
        const result = { ok: true, resource: { type: 'executionEntry', id: entryId } };
        await query('UPDATE order_events SET result=$2 WHERE id=$1', [entryId, JSON.stringify(result)]);
        return result;
      }
      const original = await query(
        "SELECT e.id FROM execution_entries e WHERE e.id=$1 AND e.order_id=$2 AND e.kind='report' "+
        "AND NOT EXISTS (SELECT 1 FROM execution_entries reversal WHERE reversal.reverses_id=e.id) FOR UPDATE OF e",
        [p.reversesId, id],
      );
      if (!original.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Apontamento original não encontrado.');
      const reversalId = crypto.randomUUID();
      await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [reversalId, id, p.command, row.version, now, context!.actorId, hash, reversalId, context!.correlationId]);
      await query('INSERT INTO execution_entries(id,order_id,kind,resource_kind,description,quantity,unit,resource_reference,effective_date,reference,reverses_id,actor_id,created_at) SELECT $1,order_id,\'void\',resource_kind,$3,quantity,unit,resource_reference,effective_date,$4,id,$5,$6 FROM execution_entries WHERE id=$2', [reversalId, p.reversesId, p.reason, `Estorno: ${p.reason}`, context!.actorId, now]);
      const result = { ok: true, resource: { type: 'executionReversal', id: reversalId, reversesId: p.reversesId } };
      await query('UPDATE order_events SET result=$2 WHERE id=$1', [reversalId, JSON.stringify(result)]);
      await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [p.key, id, p.command, row.version, now, context!.actorId, hash, reversalId, JSON.stringify(result), context!.correlationId]);
      return result;
    });
    return respond(result, context, 201);
  } catch (error) { return failure(error, context); }
}

