#!/usr/bin/env node
/**
 * Read-only snapshot comparison with a D1 SQL-export fingerprint.
 * Outputs per-table counts/status only, never raw rows or connection strings.
 * NOT a migration/copy utility: a match cannot replace backup/restore or E2E.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

const schema = await readFile(new URL('../db/schema.ts', import.meta.url), 'utf8');
const tables = [...new Set([...schema.matchAll(/pgTable\('([A-Za-z_][A-Za-z0-9_]*)'/g)].map(m => m[1]))].sort();
if (tables.length < 30) {
  console.error('NO-GO: PostgreSQL schema inventory incomplete');
  process.exit(2);
}
const idx = process.argv.indexOf('--source');
if (idx === -1 || !process.argv[idx+1] || !process.env.DATABASE_URL) {
  console.error('NO-GO: supply --source <offline-d1-manifest.json> and DATABASE_URL');
  process.exit(2);
}
const source = JSON.parse(await readFile(process.argv[idx+1], 'utf8'));
if (source.format !== 'cisne-d1-postgres-fingerprint-v1' ||
    source.origin !== 'cloudflare-d1-offline-sql-export' ||
    !source.tables || Object.keys(source.tables).sort().join(',') !== tables.join(',')) {
  console.error('NO-GO: incompatible or incomplete D1 manifest');
  process.exit(2);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
let client;
let discrepancies = 0;
let totalRows = 0;

function canonical(row, cols) {
  if (cols.some(c => Buffer.isBuffer(row[c]))) throw new Error('BLOB requires separate review');
  return JSON.stringify(cols.map(c => [c, row[c] === null ? null : String(row[c])])) + '\n';
}
try {
  client = await pool.connect();
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '30000ms'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '60000ms'");
  for (const table of tables) {
    const expected = source.tables[table];
    const columnResult = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY column_name",
      [table]
    );
    const cols = columnResult.rows.map(r => r.column_name);
    if (!expected || cols.join(',') !== expected.columns?.join(',')) {
      discrepancies++;
      console.log(table + ': NO-GO (columns differ or missing)');
      continue;
    }
    if (!cols.includes('id')) { discrepancies++; console.log(table+': NO-GO (id missing)'); continue; }
    const digest = createHash('sha256');
    let count = 0, lastId = null;
    const identifier = '"' + table + '"'; // from strict trusted schema regex, not user input
    while (true) {
      const sql = lastId === null
        ? `SELECT * FROM ${identifier} ORDER BY "id" COLLATE "C" LIMIT $1`
        : `SELECT * FROM ${identifier} WHERE "id" COLLATE "C" > $1 ORDER BY "id" COLLATE "C" LIMIT $2`;
      const res = await client.query(sql, lastId === null ? [400] : [lastId, 400]);
      if (res.rows.length === 0) break;
      for (const row of res.rows) {
        digest.update(canonical(row, cols), 'utf8');
        count++;
      }
      lastId = res.rows.at(-1).id;
      if (typeof lastId !== 'string') throw new Error('text primary key required');
    }
    totalRows += count;
    const match = count === expected.rows && digest.digest('hex') === expected.sha256;
    if (!match) discrepancies++;
    console.log(`${table}: ${match ? 'MATCH' : 'NO-GO'} (D1=${expected.rows}, PostgreSQL=${count})`);
  }
  await client.query('ROLLBACK'); // explicitly end read-only snapshot
} catch (error) {
  discrepancies++;
  console.error('NO-GO: PostgreSQL read-only snapshot could not be completed; code=' + (error.code || 'UNVERIFIED'));
  if (client) await client.query('ROLLBACK').catch(() => {});
} finally {
  client?.release();
  await pool.end();
}
if (totalRows === 0) { discrepancies++; console.error('NO-GO: PostgreSQL target is empty or unverified'); }
if (discrepancies) {
  console.error(`NO-GO: ${discrepancies} discrepancies / blockers; retain D1 and prohibit cutover`);
  process.exitCode = 1;
} else {
  console.log(`FINGERPRINT MATCH: ${tables.length} tables, ${totalRows} rows. Backup/restore, frozen writes and business UAT still required.`);
}
