import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../../lib/api/http';
import { reverseReceivableSettlement } from '../../../../../../../lib/application/finance';

const command = z.object({
  commandKey: z.string().uuid(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().trim().min(1).max(160),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const id = (await params).id;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Baixa inválida.');
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Verifique a chave, data e referência do estorno.');
    const requestHash = await fingerprint({ actor: context.actorId, data: { id, ...parsed.data } });
    const result = await reverseReceivableSettlement(context, { settlementId: id, ...parsed.data, requestHash });
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) {
    return failure(error, context);
  }
}
