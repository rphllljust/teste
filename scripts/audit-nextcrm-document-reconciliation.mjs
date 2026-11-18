#!/usr/bin/env node
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const report = {
  readOnly: true,
  generatedAt: new Date().toISOString(),
  checks: [],
};
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='12000ms'");
  const checks = [
    ['links_without_order', `SELECT count(*)::int AS count
      FROM nextcrm_order_document_links l
      LEFT JOIN service_orders o ON o.id=l.service_order_id
      WHERE o.id IS NULL`],
    ['links_without_client', `SELECT count(*)::int AS count
      FROM nextcrm_order_document_links l
      LEFT JOIN clients c ON c.id=l.erp_client_id
      WHERE c.id IS NULL`],
    ['links_without_event', `SELECT count(*)::int AS count
      FROM nextcrm_order_document_links l
      LEFT JOIN nextcrm_order_document_events e
        ON e.link_id=l.id AND e.event_type='linked'
      WHERE e.id IS NULL`],
    ['duplicate_logical_links', `SELECT count(*)::int AS count FROM (
      SELECT service_order_id,owner_id,nextcrm_document_id,document_version
      FROM nextcrm_order_document_links
      GROUP BY 1,2,3,4 HAVING count(*)>1
    ) duplicates`],
    ['account_mappings_without_client', `SELECT count(*)::int AS count
      FROM nextcrm_erp_client_account_mappings m
      LEFT JOIN clients c ON c.id=m.erp_client_id
      WHERE c.id IS NULL`],
    ['active_account_mappings_without_identity', `SELECT count(*)::int AS count
      FROM nextcrm_erp_client_account_mappings m
      LEFT JOIN nextcrm_erp_identity_mappings i
        ON i.erp_owner_id=m.erp_owner_id
       AND i.instance_key=m.instance_key
       AND i.active=true
      WHERE m.active=true AND i.erp_actor_id IS NULL`],
  ];
  for (const [name, sql] of checks) {
    const result = await client.query(sql);
    const count = Number(result.rows[0].count);
    report.checks.push({ name, count, status: count === 0 ? 'reconciled' : 'inconsistent' });
  }
  report.summary = report.checks.every(check => check.status === 'reconciled')
    ? 'reconciled'
    : 'inconsistencies-found';
  await client.query('COMMIT');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  console.error(JSON.stringify({
    readOnly: true,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
