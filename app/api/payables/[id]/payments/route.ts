import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { registerPayablePayment, reversePayablePayment } from '../../../../../lib/application/finance';

const command = z.object({ key: z.string().uuid(), command: z.enum(['record_payment', 'reverse_payment']), amount: z.string().trim().regex(/^\d{1,12}(?:[,.]\d{1,4})?$/).optional(), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().min(1).max(160), reversesId: z.string().uuid().optional() }).strict();
const money = (value: string) => { const [whole, fraction = ''] = value.split(/[,.]/); return Number(whole) * 10000 + Number(fraction.padEnd(4, '0')); };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const payableId = (await params).id;
    if (!z.string().uuid().safeParse(payableId).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Obrigação inválida.');
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success || (parsed.data.command === 'record_payment' && !parsed.data.amount) || (parsed.data.command === 'reverse_payment' && !parsed.data.reversesId)) throw new ApiError(400, 'VALIDATION_FAILED', 'Comando de pagamento inválido.');
    const data = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, data: { payableId, ...data } });
    const result = data.command === 'record_payment'
      ? await registerPayablePayment(context, { payableId, amount: money(data.amount!), effectiveDate: data.effectiveDate, reference: data.reference, commandKey: data.key, requestHash })
      : await reversePayablePayment(context, { paymentId: data.reversesId!, commandKey: data.key, effectiveDate: data.effectiveDate, reference: data.reference, requestHash });
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) { return failure(error, context); }
}
