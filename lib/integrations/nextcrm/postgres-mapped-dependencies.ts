import type { OrderDocumentLinkDependencies } from './document-link-preflight.ts';
import { createPostgresOrderOwnershipReader, type OrderOwnershipQuery } from './postgres-order-ownership.ts';
import { createNextcrmHttpDocumentVerifier, type NextcrmBridgeConfig } from './nextcrm-http-document-verifier.ts';

/** Uses only trusted, approved ERP mappings; no public API may modify them. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INSTANCE = /^[A-Za-z0-9_-]{3,128}$/;
export function createPostgresNextcrmLinkDependencies(
  db: OrderOwnershipQuery, trustedErpActorId: string, config: NextcrmBridgeConfig,
): OrderDocumentLinkDependencies {
  if (!trustedErpActorId || trustedErpActorId.length > 200 ||
      !INSTANCE.test(config.instanceKey)) throw new Error('NEXTCRM_TRUSTED_MAPPING_CONFIGURATION_INVALID');
  const verifier = createNextcrmHttpDocumentVerifier(config);
  return {
    ...createPostgresOrderOwnershipReader(db),
    async resolveMappedIdentity(erpActorId: string) {
      if (erpActorId !== trustedErpActorId) return null;
      const result = await db.query(`
        SELECT erp_actor_id,nextcrm_subject_id,instance_key
        FROM nextcrm_erp_identity_mappings
        WHERE erp_actor_id=$1 AND instance_key=$2
          AND active=true AND verified_at IS NOT NULL
        LIMIT 1
      `,[trustedErpActorId,config.instanceKey]);
      const row=result.rows[0];
      if (!row||row.erp_actor_id!==trustedErpActorId||
          row.instance_key!==config.instanceKey||
          typeof row.nextcrm_subject_id!=='string'||!UUID.test(row.nextcrm_subject_id)) return null;
      return {
        erpActorId:trustedErpActorId,
        nextcrmSubjectId:row.nextcrm_subject_id,
        tenantKey:config.instanceKey,
      };
    },
    async findAccountMapping(erpClientId: string, instanceKey: string) {
      if(!UUID.test(erpClientId)||instanceKey!==config.instanceKey)return null;
      const result=await db.query(`
        SELECT m.nextcrm_account_id,m.instance_key
        FROM nextcrm_erp_client_account_mappings AS m
        JOIN clients AS c ON c.id=m.erp_client_id AND c.owner_id=m.erp_owner_id
        WHERE m.erp_client_id=$1 AND m.erp_owner_id=$2
          AND m.instance_key=$3 AND m.active=true AND m.verified_at IS NOT NULL
          AND c.status='active'
        LIMIT 1
      `,[erpClientId,trustedErpActorId,config.instanceKey]);
      const row=result.rows[0];
      if(!row||row.instance_key!==config.instanceKey||
        typeof row.nextcrm_account_id!=='string'||!UUID.test(row.nextcrm_account_id))return null;
      return {accountId:row.nextcrm_account_id,tenantKey:config.instanceKey};
    },
    verifyDocumentForLink:verifier.verifyDocumentForLink,
  };
}
