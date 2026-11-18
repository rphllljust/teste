import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { executionInput, quantityScaled, resourceKinds } from '../../../../../lib/domain/execution';

const query = z.object({ q: z.string().trim().max(160).default(''), resourceKind: z.enum(resourceKinds).optional(), state: z.enum(['active', 'corrected', 'all']).default('active'), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(50) }).strict();

function project(row: Record<string, unknown>, canVoid: boolean) {
  const corrected=Boolean(row.reverses_id)||row.voided===true;
  return { id: String(row.id), resourceLabel: String(row.resource_kind), description: String(row.description), quantityScaled: String(row.quantity), unit: String(row.unit), resourceReference: row.resource_reference ? String(row.resource_reference) : null, effectiveDate: String(row.effective_date), reference: String(row.reference), state: { code: corrected ? 'corrected' : 'active', label: corrected ? 'Anulado' : 'Ativo' }, availableCommands: corrected || !canVoid ? [] : [{ id: 'void', label: 'Anular apontamento', expectedVersion: 1 }] };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const id = (await params).id;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Ordem inválida.');
    const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Consulta de execução inválida.');
    const offset = (parsed.data.page - 1) * parsed.data.pageSize;
    const db = database();
    const visibility = parsed.data.state==='active'
      ? 'e.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM execution_entries reversal WHERE reversal.reverses_id=e.id)'
      : parsed.data.state==='corrected' ? 'e.reverses_id IS NOT NULL' : 'TRUE';
    // The UI always sends q and sometimes resourceKind: accept both as real
    // parameterized filters rather than rejecting valid browser requests.
    const filters=[visibility],values:(string|number)[]=[id,context.actorId];
    if(parsed.data.resourceKind){filters.push('e.resource_kind=?');values.push(parsed.data.resourceKind);}
    if(parsed.data.q){
      filters.push('(strpos(lower(e.description),lower(?))>0 OR strpos(lower(e.reference),lower(?))>0 OR strpos(lower(e.resource_kind),lower(?))>0)');
      values.push(parsed.data.q,parsed.data.q,parsed.data.q);
    }
    const where='e.order_id=? AND (o.owner_id IS NULL OR o.owner_id=?) AND '+filters.join(' AND ');
    const rows = await db.batch([
      db.prepare('SELECT id,title,client,status,version FROM service_orders WHERE id=? AND (owner_id IS NULL OR owner_id=?)').bind(id, context.actorId),
      db.prepare(`SELECT e.*,EXISTS(SELECT 1 FROM execution_entries v WHERE v.reverses_id=e.id) AS voided FROM execution_entries e JOIN service_orders o ON o.id=e.order_id WHERE ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?`).bind(...values, parsed.data.pageSize, offset),
      db.prepare(`SELECT count(*)::int total FROM execution_entries e JOIN service_orders o ON o.id=e.order_id WHERE ${where}`).bind(...values),
    ]);
    const order = rows[0].results[0] as Record<string, unknown> | undefined;
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Ordem de serviço não encontrada.');
    const items = (rows[1].results as Record<string, unknown>[]).map(item=>project(item,String(order.status)==='executing'));
    const total = Number((rows[2].results[0] as { total: number }).total);
    return respond({ order: { id: String(order.id), title: String(order.title), client: String(order.client), status: String(order.status), version: Number(order.version), availableCommands: [] }, items, pageInfo: { page: parsed.data.page, limit: parsed.data.pageSize, offset, total, sourceTotal: total, hasMore: parsed.data.page * parsed.data.pageSize < total }, availableCommands: String(order.status) === 'executing' ? [{ id: 'report', label: 'Registrar execução', expectedVersion: Number(order.version) }] : [], warnings: [] }, context);
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
      const order = await query('SELECT id,status,version FROM service_orders WHERE id=$1 AND (owner_id IS NULL OR owner_id=$2) FOR UPDATE', [id, context!.actorId]);
      if (!order.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Ordem não encontrada.');
      const row = order.rows[0] as { id: string; status: string; version: number };
      const prior = await query('SELECT result,request_hash FROM order_events WHERE id=$1', [p.key]);
      if (prior.rows.length) {
        if (prior.rows[0].request_hash !== hash || !prior.rows[0].result) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave de execução já utilizada.');
        return JSON.parse(String(prior.rows[0].result)) as Record<string, unknown>;
      }
      if (row.status !== 'executing') throw new ApiError(409, 'INVALID_STATE', 'Apontamentos só podem ser registrados durante a execução.');
      if (row.version !== p.version) throw new ApiError(409, 'VERSION_CONFLICT', 'A ordem foi alterada. Atualize a execução.');
      const now = new Date().toISOString();
      if (p.command === 'report') {
        const entryId = p.key;
        const result = { ok: true, resource: { type: 'executionEntry', id: entryId } };
        await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [p.key, id, p.command, row.version, now, context!.actorId, hash, entryId, JSON.stringify(result), context!.correlationId]);
        await query('INSERT INTO execution_entries(id,order_id,kind,resource_kind,description,quantity,unit,resource_reference,effective_date,reference,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [entryId, id, 'report', p.resourceKind, p.description, quantityScaled(p.quantity), p.unit, p.resourceReference, p.effectiveDate, p.reference, context!.actorId, now]);
        return result;
      }
      const original = await query('SELECT id FROM execution_entries WHERE id=$1 AND order_id=$2 AND reverses_id IS NULL FOR UPDATE', [p.reversesId, id]);
      if (!original.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Apontamento original não encontrado.');
      const alreadyReversed = await query('SELECT id FROM execution_entries WHERE reverses_id=$1', [p.reversesId]);
      if (alreadyReversed.rows.length) throw new ApiError(409, 'ALREADY_REVERSED', 'O apontamento já foi anulado.');
      const reversalId = p.key;
      const result = { ok: true, resource: { type: 'executionReversal', id: reversalId, reversesId: p.reversesId } };
      await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [p.key, id, p.command, row.version, now, context!.actorId, hash, reversalId, JSON.stringify(result), context!.correlationId]);
      await query('INSERT INTO execution_entries(id,order_id,kind,resource_kind,description,quantity,unit,resource_reference,effective_date,reference,reverses_id,actor_id,created_at) SELECT $1,order_id,\'void\',resource_kind,$3,quantity,unit,resource_reference,effective_date,$4,id,$5,$6 FROM execution_entries WHERE id=$2', [reversalId, p.reversesId, p.reason, `Estorno: ${p.reason}`, context!.actorId, now]);
      return result;
    });
    return respond(result, context, 201);
  } catch (error) { return failure(error, context); }
}

