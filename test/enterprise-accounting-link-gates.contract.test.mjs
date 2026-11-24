import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const accountingRoute = new URL('../../app/api/accounting/journals/route.ts', import.meta.url);
const schema = new URL('../../drizzle-pg/0000_salty_lilith.sql', import.meta.url);
const fiscalRoute = new URL('../../app/api/fiscal/documents/route.ts', import.meta.url);
const commandRoute = new URL('../../app/api/commands/route.ts', import.meta.url);

test('accounting journal contract remains fail-closed without source links', async () => {
  const source = await readFile(accountingRoute, 'utf8');
  assert.match(source, /sourceReference/);
  assert.match(source, /\.strict\(\)/);
  for (const field of ['sourceType','sourceId','invoiceId','receivableId','procurementOrderId','fiscalDocumentId']) {
    assert.doesNotMatch(source, new RegExp(field));
  }
});

test('database has no persisted accounting-origin relation contract', async () => {
  const source = await readFile(schema, 'utf8');
  const journalTable = source.slice(source.indexOf('CREATE TABLE "journal_entries"'), source.indexOf('--> statement-breakpoint', source.indexOf('CREATE TABLE "journal_entries"')));
  assert.match(journalTable, /source_reference/);
  assert.doesNotMatch(journalTable, /source_type|source_id|invoice_id|receivable_id|procurement_order_id|fiscal_document_id/);
});

test('billing and fiscal contracts do not claim accounting posting', async () => {
  const [fiscal, commands] = await Promise.all([readFile(fiscalRoute, 'utf8'), readFile(commandRoute, 'utf8')]);
  assert.doesNotMatch(commands, /accounting\/journals/);
  assert.doesNotMatch(fiscal, /accounting\/journals/);
});
