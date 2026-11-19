import { z } from 'zod';
import type { PoolClient } from 'pg';
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
const linkIntent = z.object({ key: uuid }).strict();

function bridgeConfig(): NextcrmBridgeConfig {
  return {
    baseUrl: 'http://nextcrm-web.railway.internal:3000',
    secret: process.env.CISNE_NEXTCRM_BRIDGE_SECRET ?? '',
    instanceKey: getNextcrmInstanceKey(),
    timeoutMs: 3000,
  };
}

function isValidUuid(value: string): boolean {
  return uuid.safeParse(value).success;
}

export async function GET(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id } = await params;
    if (!isValidUuid(id)) {
      return respond({ mapped: false, state: 'invalid' }, context, 400);
    }

    const instanceKey = getNextcrmInstanceKey();
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

export async function POST(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  let client: PoolClient | undefined;
  try {
    context = requestContext(request, true);
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador do cliente inválido.');
    }
    const parsed = linkIntent.safeParse(await jsonBody(request));
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Comando de vínculo inválido.');
    }

    const instanceKey = getNextcrmInstanceKey();
    if (!instanceKey) {
      throw new ApiError(503, 'NEXTCRM_NOT_CONFIGURED', 'A instância NextCRM não está configurada.');
    }

    const pool = databasePool();
    const dependencies = createPostgresNextcrmLinkDependencies(pool, context.actorId, bridgeConfig());
    const identity = await dependencies.resolveMappedIdentity(context.actorId);
    if (!identity) {
      throw new ApiError(403, 'NEXTCRM_IDENTITY_REQUIRED', 'O contexto empresarial ainda não possui identidade NextCRM aprovada.');
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const owned = await client.query(
      'SELECT id FROM clients WHERE id=$1 AND owner_id=$2 AND status=$3 FOR UPDATE',
      [id, context.actorId, 'active'],
    );
    if (!owned.rows[0]) {
      throw new ApiError(404, 'NOT_FOUND', 'Cliente não encontrado.');
    }

    const current = await client.query(
      `SELECT nextcrm_account_id AS "accountId", instance_key AS "instanceKey", active
         FROM nextcrm_erp_client_account_mappings
        WHERE erp_client_id=$1
        FOR UPDATE`,
      [id],
    );
    if (current.rows[0]?.active) {
      if (current.rows[0].instanceKey !== instanceKey) {
        throw new ApiError(409, 'NEXTCRM_MAPPING_CONFLICT', 'O cliente já está vinculado a outra instância NextCRM.');
      }
      await client.query('COMMIT');
      return respond({
        mapped: true,
        created: false,
        state: 'synchronized',
        mapping: { accountId: current.rows[0].accountId, instanceKey },
      }, context);
    }

    const evidence = await createNextcrmHttpAccountVerifier(bridgeConfig())
      .lookupAccountForClient(identity.nextcrmSubjectId, id, instanceKey);
    if (!evidence) {
      throw new ApiError(404, 'NEXTCRM_ACCOUNT_NOT_FOUND', 'Nenhuma conta NextCRM autorizada corresponde a este cliente ERP.');
    }

    const saved = await client.query(
      `INSERT INTO nextcrm_erp_client_account_mappings
        (erp_client_id,erp_owner_id,nextcrm_account_id,instance_key,active,
         verified_source,verified_by,verified_at)
       VALUES($1,$2,$3,$4,true,$5,$6,now())
       ON CONFLICT (erp_client_id) DO UPDATE SET
         erp_owner_id=EXCLUDED.erp_owner_id,
         nextcrm_account_id=EXCLUDED.nextcrm_account_id,
         instance_key=EXCLUDED.instance_key,
         active=true,
         verified_source=EXCLUDED.verified_source,
         verified_by=EXCLUDED.verified_by,
         verified_at=EXCLUDED.verified_at
       RETURNING nextcrm_account_id AS "accountId", instance_key AS "instanceKey",
                 verified_at AS "verifiedAt"`,
      [id, context.actorId, evidence.accountId, instanceKey,
        'nextcrm-bridge-account-lookup', identity.nextcrmSubjectId],
    );
    await client.query('COMMIT');
    client.release();
    client = undefined;

    return respond({
      mapped: true,
      created: true,
      state: 'synchronized',
      mapping: saved.rows[0],
      refreshPolicy: ['clients.detail', 'orders.documents'],
    }, context, 201);
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    if (error instanceof NextcrmAccountLookupUnavailable) {
      return failure(new ApiError(503, 'NEXTCRM_UNAVAILABLE', 'O serviço NextCRM não pôde confirmar a conta.'), context);
    }
    return failure(error, context);
  }
}
