import { withRC98SignedDbScope } from '../../../../../lib/api/staging-uat-db-scope.mjs';
import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { registerReceivableSettlement } from '../../../../../lib/application/finance';

const command = z.object({
  receivableId: z.string().uuid(),
  amount: z.string().trim().regex(/^\d{1,12}$/).transform(Number).refine(value => value > 0),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().trim().min(1).max(160),
  commandKey: z.string().uuid(),
}).strict();

async function rc98PostCore(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Verifique o título, valor, data e referência.');
    const input = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, data: input });
    const result = await registerReceivableSettlement(context, { ...input, requestHash });
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) {
    return failure(error, context);
  }
}

export function POST(request: Request) { return withRC98SignedDbScope(request, ()=>rc98PostCore(request)); }
