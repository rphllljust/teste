import { z } from 'zod';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { listEnterpriseDossiers } from '../../../../lib/application/process-dossier';

export const dynamic = 'force-dynamic';
const search = z.object({
  q: z.string().trim().max(120).default(''),
  status: z.enum(['all','draft','authorized','executing','completed','cancelled']).default('all'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

/** Paginated, actor-scoped business dossiers. Never leaks ownerless legacy OS. */
export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const params = search.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!params.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Filtros de processos empresariais inválidos.');
    return respond(await listEnterpriseDossiers(context.actorId, {
      q: params.data.q, status: params.data.status === 'all' ? '' : params.data.status,
      page: params.data.page, pageSize: params.data.pageSize,
    }), context);
  } catch (error) {
    return failure(error, context);
  }
}
