import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static, read-only fail-fast gate for the exact PostgreSQL migration list.
 * Detects conflicting IDs and tables before any migration opens a DB session.
 */
export function migrationEntries(source) {
  const entries = [...source.matchAll(
    /\{\s*id:\s*'([^']+)'\s*,\s*file:\s*'([^']+)'\s*\}/g,
  )].map(match => ({ id: match[1], file: match[2] }));
  if (!entries.length) throw new Error('MIGRATION_MANIFEST_NOT_FOUND');
  const seen = new Set();
  for (const item of entries) {
    if (!/^[a-zA-Z0-9_-]{5,96}$/.test(item.id) || seen.has(item.id)) {
      throw new Error('DUPLICATE_OR_INVALID_MIGRATION_ID: ' + item.id);
    }
    seen.add(item.id);
  }
  return entries;
}

export function declaredTables(sql) {
  const noComments = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  return [...noComments.matchAll(
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\.)?("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/gi,
  )].map(match => match[1].replaceAll('"', '').toLowerCase());
}

export function auditActiveMigrations(rows) {
  const owners = new Map();
  for (const { id, sql } of rows) {
    for (const table of declaredTables(sql)) {
      const previous = owners.get(table);
      if (previous) {
        throw new Error('DUPLICATE_MIGRATION_DDL: ' + table + ' in ' + previous + ' and ' + id);
      }
      owners.set(table, id);
    }
  }
  if (!owners.size) throw new Error('MIGRATION_TABLES_NOT_FOUND');
  return { migrationCount: rows.length, tableCount: owners.size };
}

export async function auditRepositoryMigrations(scriptFile) {
  const root = resolve(dirname(scriptFile), '..');
  const migrationDir = resolve(root, 'drizzle-pg');
  const source = await readFile(scriptFile, 'utf8');
  const entries = migrationEntries(source);
  const rows = [];
  for (const { id, file } of entries) {
    const absolute = resolve(dirname(scriptFile), file);
    const relation = relative(migrationDir, absolute);
    if (!relation || relation.startsWith('..' + sep) || relation === '..' ||
        relation.startsWith(sep) || !relation.endsWith('.sql')) {
      throw new Error('MIGRATION_PATH_OUTSIDE_APPROVED_DIRECTORY: ' + id);
    }
    rows.push({ id, sql: await readFile(absolute, 'utf8') });
  }
  return auditActiveMigrations(rows);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const migrationScript = join(dirname(scriptPath), 'migrate-postgres.mjs');
  const result = await auditRepositoryMigrations(migrationScript);
  console.log('MIGRATION_STATIC_GATE_OK migrations=' + result.migrationCount +
    ' created_tables=' + result.tableCount);
}
