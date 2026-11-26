import { z } from 'zod';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { getEnterpriseDossier } from '../../../../../lib/application/process-dossier';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const uuid = z.string().uuid();

/** Read-only, repeatable-read dossier: verified service order first, relations second. */
export async function GET(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id } = await params;
    if (!uuid.safeParse(id).success)
      throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador de processo empresarial inválido.');
    return respond(await getEnterpriseDossier(context.actorId, id), context);
  } catch (error) {
    return failure(error, context);
  }
}
