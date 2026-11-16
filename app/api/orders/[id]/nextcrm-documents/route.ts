import { z } from 'zod';
import { getPool } from '../../../../../db/raw';
import {
  ApiError, failure, requestContext, respond,
  type RequestContext,
} from '../../../../../lib/api/http';
import { listVisibleNextcrmOrderDocuments } from '../../../../../lib/integrations/nextcrm/order-documents-read';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };

/**
 * Same-origin CISNE read endpoint. It never calls a public NextCRM URL and
 * never grants download permission; only immutable authorized metadata.
 */
export async function GET(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador de OS inválido.');
    }
    const result = await listVisibleNextcrmOrderDocuments(getPool(), id, context.actorId);
    if (!result.orderFound) {
      throw new ApiError(404, 'NOT_FOUND', 'Ordem de serviço não encontrada.');
    }
    return respond({ items: result.items, hasMore: result.hasMore }, context);
  } catch (error) {
    return failure(error, context);
  }
}
