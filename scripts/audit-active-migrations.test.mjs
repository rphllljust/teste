import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrationEntries, declaredTables, auditActiveMigrations, auditRepositoryMigrations,
} from './audit-active-migrations.mjs';
import { fileURLToPath } from 'node:url';

test('parse only active migration manifest, not unreferenced SQL files', () => {
  const text = `const migrations = [
    { id: '0001_native_crm', file: '../drizzle-pg/0001_native_crm.sql' },
    { id: '0003_nextcrm_document_bridge', file: '../drizzle-pg/0003_nextcrm_document_bridge.sql' },
  ];`;
  assert.deepEqual(migrationEntries(text).map(x => x.id),
    ['0001_native_crm','0003_nextcrm_document_bridge']);
  assert.throws(() => migrationEntries('const migrations = [];'), /MANIFEST_NOT_FOUND/);
  assert.throws(() => migrationEntries(text + text), /DUPLICATE_OR_INVALID/);
});

test('CREATE TABLE, CREATE TABLE IF NOT EXISTS and quoted names still collide', () => {
  assert.deepEqual(declaredTables(`
    -- CREATE TABLE decoy (id text);
    CREATE TABLE "nextcrm_erp_identity_mappings" (id text);
    CREATE TABLE IF NOT EXISTS public."nextcrm_order_document_links" (id text);
  `), ['nextcrm_erp_identity_mappings','nextcrm_order_document_links']);

  assert.throws(() => auditActiveMigrations([
    {id:'0002_nextcrm_verified_mappings',sql:'CREATE TABLE IF NOT EXISTS "nextcrm_erp_identity_mappings"(id text);'},
    {id:'0003_nextcrm_document_bridge',sql:'CREATE TABLE "nextcrm_erp_identity_mappings"(id text);'},
  ]), /DUPLICATE_MIGRATION_DDL: nextcrm_erp_identity_mappings/);

  assert.throws(() => auditActiveMigrations([
    {id:'0001',sql:'CREATE TABLE "documents"(id text); CREATE TABLE IF NOT EXISTS documents(id text);'},
  ]), /DUPLICATE_MIGRATION_DDL: documents/);
});

test('current canonical list has no duplicated DDL across active migrations', async () => {
  const path = fileURLToPath(new URL('./migrate-postgres.mjs', import.meta.url));
  const result = await auditRepositoryMigrations(path);
  assert.ok(result.migrationCount >= 7);
  assert.ok(result.tableCount >= 40);
});
