import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database, databasePool } from '../../../../../../db/raw';
import {
  ApiError, failure, jsonBody, requestContext, respond, type RequestContext,
} from '../../../../../../lib/api/http';
import { getNextcrmInstanceKey } from '../../../../../../lib/integrations/nextcrm/config';
import {
  createPostgresNextcrmLinkDependencies,
} from '../../../../../../lib/integrations/nextcrm/postgres-mapped-dependencies';
import {
  NextcrmAccountLookupUnavailable,
  createNextcrmHttpAccountVerifier,
} from '../../../../../../lib/integrations/nextcrm/nextcrm-http-account-verifier';
import type { NextcrmBridgeConfig } from '../../../../../../lib/integrations/nextcrm/nextcrm-http-document-verifier';

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


export async function POST(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  let client: PoolClient | undefined;
  try {
    context = requestContext(request, true);
    const { id } = await params;
    if (!uuid.safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador do cliente inválido.');
    const parsed = inputSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Dados CRM inválidos.');
    const instanceKey = getNextcrmInstanceKey();
    if (!instanceKey) throw new ApiError(503, 'NEXTCRM_NOT_CONFIGURED', 'A instância NextCRM não está configurada.');

    const pool = databasePool();
    const identity = await createPostgresNextcrmLinkDependencies(pool, context.actorId, bridgeConfig()).resolveMappedIdentity(context.actorId);
    if (!identity) throw new ApiError(403, 'NEXTCRM_IDENTITY_REQUIRED', 'O contexto empresarial ainda não possui identidade NextCRM aprovada.');

    const owned = await pool.query(
      'SELECT legal_name AS "legalName" FROM clients WHERE id=$1 AND owner_id=$2 AND status=$3',
      [id, context.actorId, 'active'],
    );
    if (!owned.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Cliente não encontrado.');

    const existing = await pool.query(
      `SELECT nextcrm_account_id AS "accountId", instance_key AS "instanceKey", verified_at AS "verifiedAt"
         FROM nextcrm_erp_client_account_mappings
        WHERE erp_client_id=$1 AND erp_owner_id=$2 AND active=true
        LIMIT 1`,
      [id, context.actorId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].instanceKey !== instanceKey) throw new ApiError(409, 'NEXTCRM_MAPPING_CONFLICT', 'O cliente já está vinculado a outra instância NextCRM.');
      return respond({ mapped: true, created: false, state: 'synchronized', mapping: {
        accountId: existing.rows[0].accountId, instanceKey, verifiedAt: existing.rows[0].verifiedAt,
      }}, context);
    }

    const verifier = createNextcrmHttpAccountVerifier(bridgeConfig());
    const created = await verifier.createAccountForClient(
      identity.nextcrmSubjectId, id, instanceKey, owned.rows[0].legalName, parsed.data.changes,
    );
    const evidence = await verifier.lookupAccountForClient(identity.nextcrmSubjectId, id, instanceKey);
    if (!evidence || evidence.accountId !== created.accountId) {
      throw new ApiError(503, 'NEXTCRM_PROFILE_REFRESH_FAILED', 'A conta foi criada, mas não pôde ser confirmada pelo NextCRM.');
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT nextcrm_account_id AS "accountId", instance_key AS "instanceKey", active
         FROM nextcrm_erp_client_account_mappings
        WHERE erp_client_id=$1 FOR UPDATE`,
      [id],
    );
    if (locked.rows[0]?.active && locked.rows[0].accountId !== created.accountId) {
      throw new ApiError(409, 'NEXTCRM_MAPPING_CONFLICT', 'O cliente foi vinculado a outra conta durante a operação.');
    }
    const saved = await client.query(
      `INSERT INTO nextcrm_erp_client_account_mappings
        (erp_client_id,erp_owner_id,nextcrm_account_id,instance_key,active,verified_source,verified_by,verified_at)
       VALUES($1,$2,$3,$4,true,$5,$6,now())
       ON CONFLICT (erp_client_id) DO UPDATE SET
         erp_owner_id=EXCLUDED.erp_owner_id,nextcrm_account_id=EXCLUDED.nextcrm_account_id,
         instance_key=EXCLUDED.instance_key,active=true,verified_source=EXCLUDED.verified_source,
         verified_by=EXCLUDED.verified_by,verified_at=EXCLUDED.verified_at
       RETURNING nextcrm_account_id AS "accountId", instance_key AS "instanceKey", verified_at AS "verifiedAt"`,
      [id, context.actorId, created.accountId, instanceKey, 'nextcrm-bridge-account-create', identity.nextcrmSubjectId],
    );
    await client.query('COMMIT');
    client.release(); client = undefined;
    return respond({ mapped: true, created: true, state: 'synchronized', accountId: saved.rows[0].accountId,
      mapping: saved.rows[0], profile: evidence.profile ?? null, refreshPolicy: ['clients.detail'] }, context, 201);
  } catch (error) {
    if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    if (error instanceof NextcrmAccountLookupUnavailable) return failure(new ApiError(503, 'NEXTCRM_UNAVAILABLE', 'O NextCRM não pôde criar ou confirmar a conta.'), context);
    return failure(error, context);
  }
}

