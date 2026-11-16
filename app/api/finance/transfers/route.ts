import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { registerCashTransfer } from '../../../../lib/application/finance';

const money = z.string().trim().regex(/^\d{1,12}(?:[,.]\d{1,4})?$/).transform(value => { const [whole, fraction = ''] = value.split(/[,.]/); return Number(whole) * 10000 + Number(fraction.padEnd(4, '0')); }).refine(value => value > 0);
const command = z.object({ id: z.string().uuid(), fromAccountReference: z.string().trim().min(3).max(160), toAccountReference: z.string().trim().min(3).max(160), amount: money, effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().min(1).max(160) }).strict();

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Transferência de caixa inválida.');
    const data = parsed.data;
    const result = await registerCashTransfer(context, { ...data, requestHash: await fingerprint({ actor: context.actorId, data }) });
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) { return failure(error, context); }
}
