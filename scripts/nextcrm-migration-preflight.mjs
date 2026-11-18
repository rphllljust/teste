/**
 * Fail-closed preflight for the two historical NextCRM ↔ CISNE PostgreSQL
 * migration paths. Pure decision; no DDL or migration-ledger writes.
 *
 * The legacy finance and document histories create the SAME four objects
 * under DIFFERENT migration IDs. They are not interchangeable without an
 * independently audited, versioned reconciliation.
 */
export const NEXTCRM_BRIDGE_MIGRATIONS = Object.freeze({
  financeLinks: '0001_nextcrm_order_document_links',
  financeMappings: '0002_nextcrm_verified_mappings',
  documentBridge: '0003_nextcrm_document_bridge',
});

export const NEXTCRM_BRIDGE_TABLES = Object.freeze([
  'nextcrm_erp_identity_mappings',
  'nextcrm_erp_client_account_mappings',
  'nextcrm_order_document_links',
  'nextcrm_order_document_events',
]);

function fail(reason) {
  throw new Error('NEXTCRM_MIGRATION_NO_GO_' + reason);
}

export function assertNextcrmMigrationPreflight({
  manifestIds,
  appliedIds,
  presentTables,
}) {
  const manifest = new Set(manifestIds);
  const applied = new Set(appliedIds);
  const tables = new Set(presentTables);
  const {financeLinks, financeMappings, documentBridge} =
    NEXTCRM_BRIDGE_MIGRATIONS;

  const deploysDocument = manifest.has(documentBridge);
  const deploysFinanceLinks = manifest.has(financeLinks);
  const deploysFinanceMappings = manifest.has(financeMappings);
  const deploysFinance = deploysFinanceLinks || deploysFinanceMappings;

  if ((!deploysDocument && !deploysFinance) ||
      (deploysDocument && deploysFinance) ||
      (deploysFinance && !(deploysFinanceLinks && deploysFinanceMappings))) {
    fail('MANIFEST_CONFLICT');
  }

  const docApplied = applied.has(documentBridge);
  const linkApplied = applied.has(financeLinks);
  const mappingApplied = applied.has(financeMappings);

  if (linkApplied !== mappingApplied) fail('FINANCE_PARTIAL_HISTORY');
  if (docApplied && (linkApplied || mappingApplied)) fail('MIXED_HISTORY');
  if (deploysDocument && (linkApplied || mappingApplied))
    fail('FINANCE_HISTORY_REQUIRES_RECONCILIATION');
  if (deploysFinance && docApplied)
    fail('DOCUMENT_HISTORY_REQUIRES_RECONCILIATION');

  const missingTables = NEXTCRM_BRIDGE_TABLES.filter(t => !tables.has(t));
  if (tables.size !== 0 && missingTables.length !== 0)
    fail('PARTIAL_BRIDGE_SCHEMA');

  const installed = docApplied || (linkApplied && mappingApplied);
  if (installed && missingTables.length)
    fail('APPLIED_MIGRATION_MISSING_SCHEMA');

  if (!installed && tables.size !== 0)
    fail('UNTRACKED_BRIDGE_SCHEMA');

  return {
    expectedPath: deploysDocument ? 'DOCUMENT_FIRST' : 'FINANCE_FIRST',
    // Metadata only. Caller may proceed with its standard backup/restore gate.
    bridgeInstalled: installed,
  };
}
