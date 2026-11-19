/**
 * Strict comparison of the immutable D1 baseline with additive PostgreSQL.
 * Only the explicitly audited 0006 service-order foreign-key column is exempt
 * from legacy row hashing; all other unknown columns are a NO-GO.
 */
export function legacyColumnsCompatible(table, actualColumns, legacyColumns) {
  if (!Array.isArray(actualColumns) || !Array.isArray(legacyColumns) ||
      legacyColumns.length === 0 || actualColumns.length === 0) return false;
  const safe = column => typeof column === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(column);
  if (![...actualColumns,...legacyColumns].every(safe)) return false;
  const actual = new Set(actualColumns);
  const legacy = new Set(legacyColumns);
  if (actual.size !== actualColumns.length || legacy.size !== legacyColumns.length) return false;
  if (legacyColumns.some(column => !actual.has(column))) return false;
  const additive = table === 'service_orders'
    ? new Set(['service_catalog_id'])
    : table === 'execution_entries'
      ? new Set(['stage','started_at','ended_at','notes','responsible_person_id'])
      : new Set();
  return actualColumns.every(column => legacy.has(column) || additive.has(column));
}
