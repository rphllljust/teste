import { database } from '../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic = 'force-dynamic';

/** Read-only, authenticated catalog. No tenant or legal entity is required to inspect declared CNAEs. */
export async function GET(request: Request) {
  let ctx: RequestContext | undefined;
  try {
    ctx = requestContext(request);
    const result = await database().prepare(
      'SELECT code,description,is_primary AS "isPrimary" ' +
      'FROM enterprise_declared_cnaes ORDER BY display_order',
    ).bind().all();
    return respond({ items: result.results, total: result.results.length }, ctx);
  } catch (error) {
    return failure(error, ctx);
  }
}
