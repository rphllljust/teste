import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const model = read('lib/application/process-dossier.ts');
const list = read('app/api/enterprise/journeys/route.ts');
const detail = read('app/api/enterprise/journeys/[id]/route.ts');

test('enterprise dossier APIs authenticate before reading and reject invalid IDs',()=>{
  assert.match(list,/context = requestContext\(request\)/);
  assert.match(detail,/context = requestContext\(request\)/);
  assert.match(detail,/uuid\.safeParse\(id\)/);
  assert.match(detail,/getEnterpriseDossier\(context\.actorId, id\)/);
  assert.match(list,/max\(50\)/);
  assert.match(list,/status: params\.data\.status === 'all'/);
  assert.match(list,/listEnterpriseDossiers\(context\.actorId/);
  assert.match(detail,/export const dynamic = 'force-dynamic'/);
  assert.match(list,/export const dynamic = 'force-dynamic'/);
});

test('all data is selected from an owned OS under a read-only PostgreSQL snapshot',()=>{
  assert.match(model,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(model,/service_orders\s+WHERE id=\$1 AND owner_id=\$2/);
  assert.match(model,/o\.owner_id=\$1/);
  assert.doesNotMatch(model,/owner_id IS NULL OR/);
  assert.match(model,/return failure\(error, context\)/m ? detail : detail, /return failure\(error, context\)/);
  assert.match(model,/client\.release\(\)/);
  assert.match(model,/client\.query\('ROLLBACK'\)/);
  assert.match(model,/if \(!order\) throw new ApiError\(404/);
});

test('commercial source and finance relations are joined by exact document IDs',()=>{
  const relationships=[
    'FROM contracts WHERE id=$1 AND owner_id=$2',
    'FROM proposals',
    'crm_opportunity_proposals',
    'FROM execution_entries e',
    'FROM measurements m WHERE m.order_id=$1',
    'JOIN measurements m ON m.id=i.measurement_id',
    'LEFT JOIN receivables r ON r.invoice_id=i.id',
    'JOIN invoices i ON i.id=r.invoice_id',
    'LEFT JOIN accounting_invoice_links ail ON ail.invoice_id=i.id AND ail.actor_id=$2',
    'LEFT JOIN accounting_settlement_links asl ON asl.settlement_id=s.id AND asl.actor_id=$2',
    'JOIN bank_statements statement ON statement.id=line.statement_id AND statement.actor_id=$2',
    'WHERE j.actor_id=$1 AND j.id=ANY($2::text[])',
  ];
  for(const text of relationships)assert.ok(model.includes(text),'Missing immutable lineage '+text);
  assert.match(model,/NOT EXISTS\(SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=e.id\)/);
  assert.match(model,/new Set\(journalIds\)/);
  assert.doesNotMatch(model,/journal\.source_reference\s*=\s*i\.id/);
});

test('financial summaries remain exact and never claim completeness from linked records',()=>{
  assert.match(model,/BigInt\(scaled\(row\.amount_scaled\)\)/);
  assert.match(model,/row\.kind==='receipt'\?1n:-1n/);
  assert.match(model,/Vínculo recuperado não equivale a conclusão ou autorização/);
  assert.match(model,/INVOICE_JOURNAL_UNVERIFIED/);
  assert.match(model,/BANK_MATCH_UNVERIFIED/);
  assert.match(model,/HISTORICAL_CLIENT/);
  assert.match(model,/truncated: records\.length > 50/);
});
