import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return respond({ mapped: false, state: 'invalid' }, context, 400);
    }

    const instanceKey = process.env.NEXTCRM_INSTANCE_KEY ?? process.env.NEXTCRM_INSTANCE ?? '';
    if (!instanceKey) {
      return respond({
        mapped: false,
        state: 'not_configured',
        message: 'A instância NextCRM não está configurada neste ambiente.',
      }, context);
    }

    const mapping = await database().prepare(`
      SELECT m.nextcrm_account_id AS "nextcrmAccountId",
             m.instance_key AS "instanceKey",
             m.verified_at AS "verifiedAt"
        FROM nextcrm_erp_client_account_mappings m
        JOIN clients c ON c.id=m.erp_client_id AND c.owner_id=m.erp_owner_id
       WHERE m.erp_client_id=?
         AND m.erp_owner_id=?
         AND m.instance_key=?
         AND m.active=true
         AND m.verified_at IS NOT NULL
         AND c.status='active'
       LIMIT 1
    `).bind(id, context.actorId, instanceKey).first<{
      nextcrmAccountId: string;
      instanceKey: string;
      verifiedAt: string;
    }>();

    if (!mapping) {
      return respond({
        mapped: false,
        state: 'not_linked',
        message: 'Este cliente ainda não possui vínculo NextCRM aprovado.',
      }, context);
    }

    return respond({
      mapped: true,
      state: 'synchronized',
      mapping: {
        accountId: mapping.nextcrmAccountId,
        instanceKey: mapping.instanceKey,
        verifiedAt: mapping.verifiedAt,
      },
    }, context);
  } catch (error) {
    return failure(error, context);
  }
}
