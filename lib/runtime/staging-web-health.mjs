/**
 * Railway web staging health uses a fresh PostgreSQL read-only connection.
 * Only canonical schema existence is checked; no business rows are selected.
 * A successful container boot alone is not a readiness proof.
 */
export async function verifyStagingWebSchema(query) {
  try {
    const result = await query(
      "SELECT "+
      "to_regclass('public.clients') IS NOT NULL AS clients_ready, "+
      "to_regclass('public.service_orders') IS NOT NULL AS orders_ready, "+
      "to_regclass('public._cisne_schema_migrations') IS NOT NULL AS migrations_ready"
    );
    if (!Array.isArray(result?.rows) || result.rows.length !== 1) return false;
    const row = result.rows[0];
    return row?.clients_ready === true &&
      row?.orders_ready === true &&
      row?.migrations_ready === true;
  } catch {
    return false;
  }
}
