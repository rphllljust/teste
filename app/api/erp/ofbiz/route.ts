import { z } from 'zod';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { ofbizRequest } from '../../../../lib/integrations/ofbiz';

const query = z.object({ resource: z.enum(['health', 'suppliers', 'products', 'purchase-orders', 'inventory']).default('health') });
const paths = {
  health: '/api/v1/health',
  suppliers: '/api/v1/procurement/suppliers',
  products: '/api/v1/catalog/products',
  'purchase-orders': '/api/v1/procurement/purchase-orders',
  inventory: '/api/v1/facility/inventory',
} as const;

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const parsed = query.safeParse({ resource: new URL(request.url).searchParams.get('resource') ?? 'health' });
    if (!parsed.success) return respond({ connected: false, error: 'Recurso OFBiz inválido.' }, context, 400);
    const resource = parsed.data.resource;
    const data = await ofbizRequest<unknown>(paths[resource]);
    return respond({ connected: true, source: 'apache-ofbiz', resource, data }, context);
  } catch (error) {
    return failure(error, context);
  }
}
