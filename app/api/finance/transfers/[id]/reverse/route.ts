import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../lib/api/http';
import { reverseCashTransfer } from '../../../../../../lib/application/finance';

const command = z.object({ commandKey: z.string().uuid(), reference: z.string().trim().min(1).max(160) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const transferId = (await params).id;
    if (!z.string().uuid().safeParse(transferId).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Transferência inválida.');
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Estorno de transferência inválido.');
    const data = parsed.data;
    const result = await reverseCashTransfer(context, { transferId, ...data, requestHash: await fingerprint({ actor: context.actorId, data: { transferId, ...data } }) });
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) { return failure(error, context); }
}
