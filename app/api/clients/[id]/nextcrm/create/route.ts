import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database, databasePool } from '../../../../../../db/raw';
import { ApiError, failure, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../lib/api/http';
import { getNextcrmInstanceKey } from '../../../../../../lib/integrations/nextcrm/config';
import { createPostgresNextcrmLinkDependencies } from '../../../../../../lib/integrations/nextcrm/postgres-mapped-dependencies';
import {
  NextcrmAccountCreateUnavailable, NextcrmAccountCreateConflict,
  createNextcrmAccountForClient,
} from '../../../../../../lib/integrations/nextcrm/nextcrm-http-account-creator';
import {
  NextcrmAccountLookupUnavailable, createNextcrmHttpAccountVerifier,
} from '../../../../../../lib/integrations/nextcrm/nextcrm-http-account-verifier';
import type { NextcrmBridgeConfig } from '../../../../../../lib/integrations/nextcrm/nextcrm-http-document-verifier';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{id: string}> };
const uuid = z.string().uuid();
const allowed = new Set([
  'officePhone','website','fax','email','companyId','vat',
  'billingStreet','billingPostalCode','billingCity','billingState','billingCountry',
  'shippingStreet','shippingPostalCode','shippingCity','shippingState','shippingCountry',
  'description','annualRevenue','memberOf',
]);
const profile = z.record(z.string().max(40), z.string().max(500).nullable()).superRefine((value,ctx) => {
  for (const k of Object.keys(value)) {
    if (!allowed.has(k)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Campo CRM não permitido.',path:[k]});
  }
});
const intent = z.object({key:uuid, profile}).strict();

function config(): NextcrmBridgeConfig {
  return {
    baseUrl: 'http://nextcrm-web.railway.internal:3000',
    secret: process.env.CISNE_NEXTCRM_BRIDGE_SECRET ?? '',
    instanceKey: getNextcrmInstanceKey(), timeoutMs: 3000,
  };
}

export async function POST(request: Request, {params}: RouteContext) {
  let context: RequestContext | undefined;
  let dbClient: PoolClient | undefined;
  try {
    context = requestContext(request, true);
    const {id} = await params;
    if (!uuid.safeParse(id).success) throw new ApiError(400,'VALIDATION_FAILED','Cliente inválido.');
    const parsed = intent.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400,'VALIDATION_FAILED','Confira os dados CRM informados.');
    const instanceKey = getNextcrmInstanceKey();
    if (!instanceKey) throw new ApiError(503,'NEXTCRM_NOT_CONFIGURED','O NextCRM não está configurado.');

    const record = await database().prepare(
      "SELECT id, legal_name AS \"legalName\", status FROM clients WHERE id=? AND owner_id=? LIMIT 1"
    ).bind(id,context.actorId).first<{id:string;legalName:string;status:string}>();
    if (!record || record.status !== 'active') {
      throw new ApiError(404,'CLIENT_NOT_FOUND','Cliente ERP ativo não encontrado.');
    }
    if (record.legalName.length > 100) {
      throw new ApiError(400,'NEXTCRM_NAME_TOO_LONG','O nome empresarial para o NextCRM deve ter no máximo 100 caracteres.');
    }
    const pool = databasePool();
    const identity = await createPostgresNextcrmLinkDependencies(
      pool, context.actorId, config(),
    ).resolveMappedIdentity(context.actorId);
    if (!identity) {
      throw new ApiError(403,'NEXTCRM_IDENTITY_REQUIRED','A identidade autorizada do NextCRM não está disponível.');
    }
    const createResult = await createNextcrmAccountForClient(
      config(), identity.nextcrmSubjectId, id, record.legalName, parsed.data.profile,
    );
    // Re-read from the CRM; a signed creation receipt alone is not an approved
    // ERP mapping and must not be accepted without an independent lookup.
    const evidence = await createNextcrmHttpAccountVerifier(config()).lookupAccountForClient(
      identity.nextcrmSubjectId, id, instanceKey,
    );
    if (!evidence || evidence.accountId !== createResult.accountId) {
      throw new ApiError(503,'NEXTCRM_LINK_UNCONFIRMED',
        'A conta CRM foi criada ou localizada, mas o vínculo ainda não pôde ser confirmado. Refaça a integração; não crie outro cliente ERP.');
    }
    dbClient = await pool.connect();
    await dbClient.query('BEGIN');
    const owner = await dbClient.query(
      'SELECT id FROM clients WHERE id=$1 AND owner_id=$2 AND status=$3 FOR UPDATE',
      [id,context.actorId,'active'],
    );
    if (!owner.rowCount) throw new ApiError(404,'CLIENT_NOT_FOUND','Cliente ERP ativo não encontrado.');
    const current = await dbClient.query(
      'SELECT nextcrm_account_id, instance_key, active FROM nextcrm_erp_client_account_mappings WHERE erp_client_id=$1 FOR UPDATE',
      [id],
    );
    const old = current.rows[0] as {nextcrm_account_id:string;instance_key:string;active:boolean}|undefined;
    if (old?.active && (old.nextcrm_account_id !== evidence.accountId || old.instance_key !== instanceKey)) {
      throw new ApiError(409,'NEXTCRM_MAPPING_CONFLICT','Cliente já vinculado a outra conta NextCRM.');
    }
    const persisted = await dbClient.query(
      `INSERT INTO nextcrm_erp_client_account_mappings
        (erp_client_id, erp_owner_id, nextcrm_account_id, instance_key,
         active, verified_source, verified_by, verified_at)
       VALUES($1,$2,$3,$4,true,$5,$6,now())
       ON CONFLICT (erp_client_id) DO UPDATE SET
         erp_owner_id=EXCLUDED.erp_owner_id,
         nextcrm_account_id=EXCLUDED.nextcrm_account_id,
         instance_key=EXCLUDED.instance_key, active=true,
         verified_source=EXCLUDED.verified_source,
         verified_by=EXCLUDED.verified_by,
         verified_at=EXCLUDED.verified_at
       RETURNING nextcrm_account_id AS "accountId", verified_at AS "verifiedAt"`,
      [id,context.actorId,evidence.accountId,instanceKey,
        'nextcrm-bridge-account-create',identity.nextcrmSubjectId],
    );
    await dbClient.query('COMMIT');
    dbClient.release();dbClient=undefined;
    return respond({
      mapped:true, state:'synchronized', erpClientId:id,
      accountId:evidence.accountId, created:createResult.created,
      mapping:persisted.rows[0], refreshPolicy:['clients.detail'],
    },context,createResult.created?201:200);
  } catch (error) {
    if (dbClient) {
      await dbClient.query('ROLLBACK').catch(()=>{});
      dbClient.release();
    }
    if (error instanceof NextcrmAccountCreateConflict) {
      return failure(new ApiError(409,'NEXTCRM_ACCOUNT_CONFLICT',error.message),context);
    }
    if (error instanceof NextcrmAccountCreateUnavailable || error instanceof NextcrmAccountLookupUnavailable) {
      return failure(new ApiError(503,'NEXTCRM_UNAVAILABLE',
        'O cadastro ERP foi preservado; a integração NextCRM não pôde ser confirmada. Tente novamente.'),context);
    }
    return failure(error,context);
  }
}
