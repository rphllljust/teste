import test from 'node:test';
import assert from 'node:assert/strict';
import { checkErpDatabaseReadiness, classifyReadinessError, REQUIRED_ERP_MIGRATIONS, REQUIRED_ERP_TABLES } from './readiness.mjs';

function queryFixture({ missingMigration, missingTable } = {}) {
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM _cisne_schema_migrations')) {
      return { rows: REQUIRED_ERP_MIGRATIONS
        .filter(value => value !== missingMigration).map(id => ({ id })) };
    }
    if (sql.includes('FROM information_schema.tables')) {
      return { rows: REQUIRED_ERP_TABLES
        .filter(value => value !== missingTable).map(table_name => ({ table_name })) };
    }
    throw Error('Unexpected query');
  };
  return { query, queries };
}

test('readiness validates both migration ledger and essential ERP tables', async () => {
  const { query, queries } = queryFixture();
  assert.equal(await checkErpDatabaseReadiness(query), true);
  assert.equal(queries.length, 2);
  assert.equal(queries.every(({ sql }) => /^SELECT\s/.test(sql)), true);
});

test('readiness fails closed when one finance migration has not run', async () => {
  const { query, queries } = queryFixture({ missingMigration: '0005_finance_period_closes' });
  assert.equal(await checkErpDatabaseReadiness(query), false);
  assert.equal(queries.length, 1);
});

test('readiness fails closed when the private NextCRM link table is absent', async () => {
  assert.equal(await checkErpDatabaseReadiness(
    queryFixture({ missingTable: 'nextcrm_order_document_links' }).query
  ), false);
});

test('readiness rejects unavailable DB and unsupported query callers', async () => {
  await assert.rejects(checkErpDatabaseReadiness(async () => {
    throw Error('private connection details never exposed in HTTP');
  }));
  await assert.rejects(checkErpDatabaseReadiness(null), TypeError);
});


test('readiness emits only safe classifications to operator logs', async () => {
  const reasons = [];
  assert.equal(await checkErpDatabaseReadiness(
    queryFixture({ missingMigration: '0005_finance_period_closes' }).query,
    reason => reasons.push(reason),
  ), false);
  assert.equal(await checkErpDatabaseReadiness(
    queryFixture({ missingTable: 'nextcrm_order_document_links' }).query,
    reason => reasons.push(reason),
  ), false);
  assert.deepEqual(reasons, ['MIGRATIONS_INCOMPLETE', 'TABLES_INCOMPLETE']);
});


test('database failures are classified without logging credentials or URLs', () => {
  const dsn='postgresql://secret:secret@db.railway.internal:5432/enterprise';
  assert.equal(classifyReadinessError(new Error('password secret'), undefined),'DATABASE_URL_MISSING');
  assert.equal(classifyReadinessError(new Error('password secret'), '${{AnotherService.DATABASE_URL}}'),'DATABASE_URL_UNRESOLVED');
  assert.equal(classifyReadinessError(new Error('password secret'),'garbage'),'DATABASE_URL_INVALID');
  assert.equal(classifyReadinessError(Object.assign(new Error('host secret'),{code:'28P01'}),dsn),'DB_CODE_28P01');
  assert.equal(classifyReadinessError(new TypeError('contains raw password'),dsn),'DB_TYPE_ERROR');
  assert.equal(classifyReadinessError(new Error('contains raw password'),dsn),'DB_QUERY_FAILED');
});
