import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { database } from '../../../../db/raw';

const commandSchema = z.object({ id: z.string().uuid(), key: z.string().uuid(), rowVersion: z.number().int().positive(), command: z.enum(['set_default', 'clear_default']) }).strict();

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = commandSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Comando de consulta inválido.');
    const data = parsed.data;
    const hash = await fingerprint({ actor: context.actorId, data });
    const db = database();
    const result = await db.transaction(async query => {
      const row = (await query('SELECT id,owner_id,row_version,view_key FROM saved_views WHERE id=$1 AND owner_id=$2 FOR UPDATE', [data.id, context!.actorId])).rows[0] as { id: string; row_version: number; view_key: string } | undefined;
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Consulta não encontrada.');
      if (row.row_version !== data.rowVersion) throw new ApiError(409, 'VERSION_CONFLICT', 'A consulta foi alterada. Atualize e tente novamente.');
      await query('UPDATE saved_views SET is_default=0,row_version=row_version+1 WHERE owner_id=$1 AND view_key=$2', [context!.actorId, row.view_key]);
      if (data.command === 'set_default') await query('UPDATE saved_views SET is_default=1 WHERE id=$1 AND owner_id=$2', [data.id, context!.actorId]);
      await query('INSERT INTO saved_view_commands(id,view_id,owner_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [data.key, data.id, context!.actorId, data.command, hash, JSON.stringify({ id: data.id, command: data.command }), context!.correlationId, new Date().toISOString()]);
      return { id: data.id, command: data.command };
    });
    return respond(result, context, 201);
  } catch (error) { return failure(error, context); }
}
