import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { registerPayablePayment } from '../../../../../lib/application/finance';

const command = z.object({ payableId: z.string().uuid(), amount: z.string().trim().regex(/^\d{1,12}$/).transform(Number).refine(value => value > 0), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().min(1).max(160), commandKey: z.string().uuid() }).strict();

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Verifique o título, valor, data e referência.');
    const input = parsed.data;
    const result = await registerPayablePayment(context, { ...input, requestHash: await fingerprint({ actor: context.actorId, data: input }) });
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) { return failure(error, context); }
}
