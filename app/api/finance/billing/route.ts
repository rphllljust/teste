import { z } from 'zod';
import { database } from '../../../../db/raw';
import { database } from '../../../../db/raw';
import { billApprovedMeasurement } from '../../../../lib/application/billing';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext, validDate } from '../../../../lib/api/http';

const command = z.object({
  measurementId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  commandKey: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional(),
}).strict();

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const commandKey = z.string().uuid().safeParse(new URL(request.url).searchParams.get('commandKey'));
    if (!commandKey.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Chave de cobrança inválida.');
    const stored = await database().prepare(
      "SELECT result FROM order_events WHERE id=? AND actor_id=? AND command='bill_measurement'",
    ).bind(commandKey.data, context.actorId).first<{result: unknown}>();
    if (!stored?.result) throw new ApiError(404, 'NOT_FOUND', 'Cobrança não localizada.');
    const result = typeof stored.result === 'string' ? JSON.parse(stored.result) : stored.result;
    return respond(result, context);
  } catch (error) {
    return failure(error, context);
  }
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success || !validDate(parsed.success ? parsed.data.dueDate : '')) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Informe uma medição, uma chave e um vencimento válidos.');
    }
    const input = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, data: input });
    const result = await billApprovedMeasurement(context, { ...input, requestHash });
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) {
    return failure(error, context);
  }
}
