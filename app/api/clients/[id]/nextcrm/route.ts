import { z } from 'zod';
import { databasePool } from '../../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { getNextcrmInstanceKey } from '../../../../../lib/integrations/nextcrm/config';
import { createNextcrmHttpAccountVerifier, NextcrmAccountLookupUnavailable } from '../../../../../lib/integrations/nextcrm/nextcrm-http-account-verifier';
import type { NextcrmBridgeConfig } from '../../../../../lib/integrations/nextcrm/nextcrm-http-document-verifier';

export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();
function bridgeConfig(): NextcrmBridgeConfig { return { baseUrl: 'http://nextcrm-web.railway.internal:3000', secret: process.env.CISNE_NEXTCRM_BRIDGE_SECRET ?? '', instanceKey: getNextcrmInstanceKey(), timeoutMs: 3000 }; }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id } = await params;
    if (!uuid.safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador do cliente inválido.');
    const instanceKey = getNextcrmInstanceKey();
    if (!instanceKey) return respond({ mapped: false, state: 'not_configured', message: 'A integração NextCRM não está configurada neste ambiente.' }, context);
    const pool = databasePool();
    const mapping = await pool.query(`SELECT nextcrm_account_id AS "accountId", instance_key AS "instanceKey", verified_at AS "verifiedAt" FROM nextcrm_erp_client_account_mappings WHERE erp_client_id=$1 AND erp_owner_id=$2 AND instance_key=$3 AND active=true AND verified_at IS NOT NULL LIMIT 1`, [id, context.actorId, instanceKey]);
    if (!mapping.rows[0]) return respond({ mapped: false, state: 'not_linked', message: 'O cliente ainda não possui vínculo NextCRM aprovado.' }, context);
    const identity = await pool.query(`SELECT nextcrm_subject_id AS "subjectId" FROM nextcrm_erp_identity_mappings WHERE erp_actor_id=$1 AND instance_key=$2 AND active=true LIMIT 1`, [context.actorId, instanceKey]);
    const subjectId = identity.rows[0]?.subjectId;
    if (!subjectId) return respond({ mapped: false, state: 'unavailable', message: 'A identidade empresarial NextCRM não está disponível.' }, context);
    const evidence = await createNextcrmHttpAccountVerifier(bridgeConfig()).lookupAccountForClient(subjectId, id, instanceKey);
    if (!evidence || evidence.accountId !== mapping.rows[0].accountId) return respond({ mapped: false, state: 'invalid', message: 'O vínculo NextCRM não pôde ser confirmado pelo serviço autorizado.' }, context);
    return respond({ mapped: true, state: 'synchronized', mapping: mapping.rows[0], profile: evidence.profile ?? null }, context);
  } catch (error) {
    if (error instanceof NextcrmAccountLookupUnavailable) return failure(new ApiError(503, 'NEXTCRM_UNAVAILABLE', 'O NextCRM está temporariamente indisponível.'), context);
    return failure(error, context);
  }
}
