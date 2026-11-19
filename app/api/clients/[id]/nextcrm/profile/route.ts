import { z } from 'zod';
import { database, databasePool } from '../../../../../db/raw';
import {
  ApiError, failure, jsonBody, requestContext, respond, type RequestContext,
} from '../../../../../lib/api/http';
import { getNextcrmInstanceKey } from '../../../../../lib/integrations/nextcrm/config';
import {
  createPostgresNextcrmLinkDependencies,
} from '../../../../../lib/integrations/nextcrm/postgres-mapped-dependencies';
import {
  NextcrmAccountLookupUnavailable,
  createNextcrmHttpAccountVerifier,
} from '../../../../../lib/integrations/nextcrm/nextcrm-http-account-verifier';
import type { NextcrmBridgeConfig } from '../../../../../lib/integrations/nextcrm/nextcrm-http-document-verifier';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };
const uuid = z.string().uuid();
const changes = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,40}$/),
  z.string().max(500).nullable(),
).superRefine((value, ctx) => {
  const allowed = new Set([
    'officePhone', 'website', 'fax', 'email', 'billingStreet',
    'billingPostalCode', 'billingCity', 'billingState', 'billingCountry',
    'shippingStreet', 'shippingPostalCode', 'shippingCity',
    'shippingState', 'shippingCountry', 'description', 'annualRevenue',
    'memberOf', 'vat', 'companyId',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Campo CRM não permitido.', path: [key] });
  }
  if (!Object.keys(value).length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe ao menos um campo CRM.' });
});
const inputSchema = z.object({ key: uuid, changes }).strict();

function bridgeConfig(): NextcrmBridgeConfig {
  return {
    baseUrl: 'http://nextcrm-web.railway.internal:3000',
    secret: process.env.CISNE_NEXTCRM_BRIDGE_SECRET ?? '',
    instanceKey: getNextcrmInstanceKey(),
    timeoutMs: 3000,
  };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador do cliente inválido.');
    }
    const parsed = inputSchema.safeParse(await jsonBody(request));
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Alteração CRM inválida.');
    }
    const instanceKey = getNextcrmInstanceKey();
    if (!instanceKey) {
      throw new ApiError(503, 'NEXTCRM_NOT_CONFIGURED', 'A instância NextCRM não está configurada.');
    }

    const mapping = await database().prepare(`
      SELECT m.nextcrm_account_id AS "accountId"
        FROM nextcrm_erp_client_account_mappings m
        JOIN clients c ON c.id=m.erp_client_id AND c.owner_id=m.erp_owner_id
       WHERE m.erp_client_id=? AND m.erp_owner_id=? AND m.instance_key=?
         AND m.active=true AND m.verified_at IS NOT NULL AND c.status='active'
       LIMIT 1
    `).bind(id, context.actorId, instanceKey).first<{accountId:string}>();
    if (!mapping) throw new ApiError(409, 'NEXTCRM_MAPPING_REQUIRED', 'Vincule o cliente a uma conta NextCRM antes de editar os dados CRM.');

    const dependencies = createPostgresNextcrmLinkDependencies(databasePool(), context.actorId, bridgeConfig());
    const identity = await dependencies.resolveMappedIdentity(context.actorId);
    if (!identity) throw new ApiError(403, 'NEXTCRM_IDENTITY_REQUIRED', 'A identidade empresarial NextCRM não está disponível.');

    const verifier = createNextcrmHttpAccountVerifier(bridgeConfig());
    const evidence = await verifier.lookupAccountForClient(identity.nextcrmSubjectId, id, instanceKey);
    if (!evidence || evidence.accountId !== mapping.accountId) {
      throw new ApiError(409, 'NEXTCRM_MAPPING_CONFLICT', 'A conta CRM confirmada não corresponde ao vínculo do cliente.');
    }
    await verifier.updateAccountForClient(
      identity.nextcrmSubjectId, id, instanceKey, mapping.accountId, parsed.data.changes,
    );
    const refreshed = await verifier.lookupAccountForClient(identity.nextcrmSubjectId, id, instanceKey);
    if (!refreshed || refreshed.accountId !== mapping.accountId) {
      throw new ApiError(503, 'NEXTCRM_PROFILE_REFRESH_FAILED', 'A atualização foi enviada, mas não pôde ser confirmada pelo NextCRM.');
    }
    return respond({
      mapped: true,
      state: 'synchronized',
      accountId: mapping.accountId,
      profile: refreshed.profile,
      refreshPolicy: ['clients.detail'],
    }, context);
  } catch (error) {
    if (error instanceof NextcrmAccountLookupUnavailable) {
      return failure(new ApiError(503, 'NEXTCRM_UNAVAILABLE', 'O NextCRM não pôde confirmar a alteração.'), context);
    }
    return failure(error, context);
  }
}
