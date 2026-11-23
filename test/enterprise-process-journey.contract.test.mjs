import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const stages = [
  {
    name: 'Cliente',
    workspace: 'app/ClientsWorkspace.tsx',
    listApi: 'app/api/clients/route.ts',
    detailApi: 'app/api/clients/[id]/route.ts',
    commandApi: 'app/api/clients/[id]/commands/route.ts',
    endpoints: ['/api/clients', '/api/clients/'],
    commands: ['revise', 'activate', 'deactivate'],
  },
  {
    name: 'Proposta',
    workspace: 'app/ProposalsWorkspace.tsx',
    listApi: 'app/api/proposals/route.ts',
    detailApi: 'app/api/proposals/[id]/route.ts',
    commandApi: 'app/api/proposals/[id]/commands/route.ts',
    endpoints: ['/api/proposals'],
    commands: ['issue', 'accept', 'reject', 'revise'],
  },
  {
    name: 'Contrato',
    workspace: 'app/ContractsWorkspace.tsx',
    listApi: 'app/api/contracts/route.ts',
    detailApi: 'app/api/contracts/[id]/route.ts',
    commandApi: 'app/api/contracts/[id]/commands/route.ts',
    endpoints: ['/api/contracts', '/api/contracts/'],
    commands: ['activate', 'close', 'revise'],
  },
  {
    name: 'Ordem de serviço',
    workspace: 'app/ExecutionWorkspace.tsx',
    listApi: 'app/api/orders/route.ts',
    detailApi: 'app/api/orders/[id]/route.ts',
    commandApi: 'app/api/orders/[id]/execution/route.ts',
    endpoints: ['/api/orders', '/api/orders/'],
    commands: ['report', 'void'],
  },
  {
    name: 'Medição',
    workspace: 'app/MeasurementPreparation.tsx',
    listApi: 'app/api/orders/[id]/measurements/route.ts',
    detailApi: 'app/api/operation/[kind]/[id]/route.ts',
    commandApi: 'app/api/orders/[id]/measurements/[measurementId]/commands/route.ts',
    endpoints: ['/api/orders/', '/api/operation/measurements/', '/api/commands'],
    commands: ['submit'],
  },
  {
    name: 'Faturamento',
    workspace: 'app/BillingPreparation.tsx',
    listApi: 'app/api/finance/billing/route.ts',
    detailApi: 'app/api/operation/[kind]/[id]/route.ts',
    commandApi: 'app/api/commands/route.ts',
    endpoints: ['/api/operation/measurements/', '/api/commands', '/api/operation/invoices/'],
    commands: ['invoice'],
  },
];

test('enterprise journey has a real workspace and real API surface for every stage', () => {
  for (const stage of stages) {
    assert.ok(exists(stage.workspace), `${stage.name}: workspace is missing`);
    assert.ok(exists(stage.listApi), `${stage.name}: list API is missing`);
    assert.ok(exists(stage.detailApi), `${stage.name}: detail API is missing`);
    assert.ok(exists(stage.commandApi), `${stage.name}: command API is missing`);

    const workspace = read(stage.workspace);
    for (const endpoint of stage.endpoints) {
      assert.match(workspace, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `${stage.name}: workspace is not mapped to ${endpoint}`);
    }
    const apiSources = [stage.listApi, stage.detailApi, stage.commandApi].map(read).join('\n');
    for (const command of stage.commands) {
      assert.match(apiSources, new RegExp(`['\"]${command}['\"]|\\b${command}\\b`),
        `${stage.name}: command ${command} is not present in a real handler`);
    }
  }
});

test('journey edges are represented by persisted identifiers, not UI-only names', () => {
  const sources = stages.map((stage) => read(stage.workspace)).join('\n');
  const apiSources = stages.flatMap((stage) => [stage.listApi, stage.detailApi, stage.commandApi])
    .filter((file, index, files) => files.indexOf(file) === index).map(read).join('\n');

  for (const identifier of ['clientId', 'proposalId', 'contractId', 'orderId', 'measurementId']) {
    assert.match(`${sources}\n${apiSources}`, new RegExp(`\\b${identifier}\\b`),
      `journey edge ${identifier} is not represented in workspace/API contracts`);
  }
  assert.match(`${sources}\n${apiSources}`, /executionId|execution_entry_id/,
    'measurement must be linked to persisted execution evidence');
  assert.match(`${sources}\n${apiSources}`, /invoiceId|invoice_id|receivableId/,
    'billing must expose persisted invoice/receivable identity');
});

test('static contract does not authorize fictitious transitions', () => {
  const sources = stages.map((stage) => read(stage.workspace)).join('\n');
  const forbidden = ['fake', 'mock', 'demo'];
  for (const token of forbidden) {
    assert.doesNotMatch(sources, new RegExp(`\\b${token}\\b`, 'i'),
      `journey workspaces must not contain UI-only transition marker ${token}`);
  }
  assert.match(sources, /availableCommands|expectedVersion|rowVersion/,
    'journey actions must be driven by backend capabilities/version data');
  assert.match(sources, /fetch\(['\"]\/api\//,
    'journey workspaces must call real API routes');
});

test('journey order is explicit and has database-backed integration coverage', () => {
  assert.deepEqual(stages.map(({ name }) => name), [
    'Cliente', 'Proposta', 'Contrato', 'Ordem de serviço', 'Medição', 'Faturamento',
  ]);
  for (const file of [
    'test/integration/contracts.test.ts',
    'test/integration/field-service-measurements.test.ts',
    'test/integration/billing-receivables.test.ts',
  ]) assert.ok(exists(file), `missing database integration coverage: ${file}`);
});
