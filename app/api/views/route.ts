import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../lib/api/http';
import { database } from '../../../db/raw';
import { savedViewDefinition, viewKey } from '../../../lib/api/view-definitions';

const createSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(60), query: z.string().trim().max(160).optional(), category: z.string().max(80).optional(), view: z.string().max(80).optional(), definition: savedViewDefinition }).strict();

function serialize(row: Record<string, unknown>) {
  let definition: unknown = null;
  try { definition = row.definition ? JSON.parse(String(row.definition)) : null; } catch { definition = null; }
  const parsed = definition ? savedViewDefinition.safeParse(definition) : null;
  return { id: String(row.id), name: String(row.name), query: String(row.query ?? ''), category: String(row.category ?? ''), view: String(row.view ?? ''), rowVersion: Number(row.row_version ?? 1), isDefault: Number(row.is_default ?? 0) === 1, compatible: Boolean(parsed?.success), definition: parsed?.success ? parsed.data : null };
}

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const requested = new URL(request.url).searchParams.get('viewKey');
    if (requested && !viewKey.safeParse(requested).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Consulta inválida.');
    const db = database();
    const rows = await db.prepare(`SELECT id,name,query,category,view,definition,row_version,is_default FROM saved_views WHERE (owner_id IS NULL OR owner_id=?)${requested ? ' AND view_key=?' : ''} ORDER BY is_default DESC,name ASC,id ASC`).bind(context.actorId, ...(requested ? [requested] : [])).all<Record<string, unknown>>();
    return respond({ views: rows.results.map(serialize) }, context);
  } catch (error) { return failure(error, context); }
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = createSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Nome ou definição da consulta inválidos.');
    const { id, name, definition } = parsed.data;
    const hash = await fingerprint({ actor: context.actorId, id, name, definition });
    const db = database();
    const prior = await db.prepare('SELECT owner_id FROM saved_views WHERE id=?').bind(id).first<{ owner_id: string | null }>();
    if (prior && prior.owner_id !== context.actorId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de consulta já utilizado.');
    const saved = await db.prepare(`INSERT INTO saved_views(id,name,query,category,view,created_at,owner_id,definition,schema_version,row_version,is_default,view_key) VALUES(?,?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,query=EXCLUDED.query,category=EXCLUDED.category,view=EXCLUDED.view,definition=EXCLUDED.definition,schema_version=EXCLUDED.schema_version,row_version=saved_views.row_version+1 WHERE saved_views.owner_id=EXCLUDED.owner_id RETURNING id`).bind(id, name, parsed.data.query ?? '', parsed.data.category ?? '', parsed.data.view ?? '', new Date().toISOString(), context.actorId, JSON.stringify(definition), definition.schemaVersion, definition.viewKey).first<{ id: string }>();
    if (!saved) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de consulta já utilizado.');
    return respond({ id, requestHash: hash }, context, prior ? 200 : 201);
  } catch (error) { return failure(error, context); }
}
