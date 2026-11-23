import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const edges = [
  { name: 'cliente → proposta', sources: ['app/ClientsWorkspace.tsx', 'app/ProposalsWorkspace.tsx'], ids: ['clientId'], routes: ['/api/clients', '/api/proposals'], relation: /propos|clientId/i },
  { name: 'proposta → contrato', sources: ['app/ProposalsWorkspace.tsx', 'app/ContractsWorkspace.tsx'], ids: ['proposalId'], routes: ['/api/proposals', '/api/contracts'], relation: /proposalId|proposta de origem|origem/i },
  { name: 'contrato → ordem', sources: ['app/ContractsWorkspace.tsx', 'app/ExecutionWorkspace.tsx'], ids: ['contractId'], routes: ['/api/contracts', '/api/orders'], relation: /contractId|onCreateOrder|ordens vinculadas/i },
  { name: 'ordem → medição', sources: ['app/ExecutionWorkspace.tsx', 'app/MeasurementPreparation.tsx'], ids: ['orderId', 'executionId'], routes: ['/api/orders', '/api/operation'], relation: /orderId|executionId|measurement/i },
  { name: 'medição → faturamento', sources: ['app/MeasurementPreparation.tsx', 'app/BillingPreparation.tsx'], ids: ['measurementId', 'invoiceId'], routes: ['/api/orders', '/api/operation', '/api/commands'], relation: /measurementId|invoiceId|faturamento|billing/i },
  { name: 'proposta → pedido de compra', sources: ['app/ProposalsWorkspace.tsx'], ids: ['proposalId'], routes: ['/api/proposals', '/api/purchase-orders'], relation: /purchase-orders|proposalId|Pedidos \/ PO/i },
];

test('every supported intermodal edge has real source files and API route surfaces', () => {
  for (const edge of edges) {
    for (const source of edge.sources) assert.ok(exists(source), `${edge.name}: missing ${source}`);
    const source = edge.sources.map(read).join('\n');
    for (const id of edge.ids) assert.match(source, new RegExp('\\b' + id + '\\b'), `${edge.name}: persisted identifier ${id} missing`);
    for (const route of edge.routes) assert.ok(source.includes(route), `${edge.name}: route ${route} missing`);
    assert.match(source, edge.relation, `${edge.name}: relationship is not represented`);
  }
});

test('related-object links are rendered from persisted projection fields', () => {
  const source = ['app/ClientsWorkspace.tsx', 'app/ProposalsWorkspace.tsx', 'app/ContractsWorkspace.tsx', 'app/ExecutionWorkspace.tsx', 'app/MeasurementPreparation.tsx', 'app/BillingPreparation.tsx'].map(read).join('\n');
  assert.match(source, /related|proposalId|contractId|orderId|measurementId|invoiceId/);
  assert.match(source, /fetch\(['"]\/api\//);
  assert.doesNotMatch(source, /mock|fake|demo|fixture/i);
});

test('journey contract does not invent unsupported navigation or transition endpoints', () => {
  const source = edges.flatMap((edge) => edge.sources).filter((file, i, files) => files.indexOf(file) === i).map(read).join('\n');
  assert.doesNotMatch(source, /\/api\/(?:enterprise|journey|relationship|navigation)(?:\/|['"])/i);
  assert.doesNotMatch(source, /setTimeout\([^)]*set(?:State|Status)/i);
});