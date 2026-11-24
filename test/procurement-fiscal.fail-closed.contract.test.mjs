import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url).pathname;
const read = (file) => fs.readFileSync(`${root}${file}`, 'utf8');

test('OFBiz exige os dois segredos e falha fechado antes do fetch', () => {
  const adapter = read('lib/integrations/ofbiz.ts');
  assert.match(adapter, /process\.env\.OFBIZ_BASE_URL/);
  assert.match(adapter, /process\.env\.OFBIZ_SERVICE_TOKEN/);
  assert.match(adapter, /if \(!config\.success\) throw new OfbizUnavailable/);
  assert.match(adapter, /não configurada no ambiente/);
});

test('O endpoint OFBiz expõe somente recursos explicitamente permitidos', () => {
  const route = read('app/api/erp/ofbiz/route.ts');
  assert.match(route, /z\.enum\(\['health', 'suppliers', 'products', 'purchase-orders', 'inventory'\]\)/);
  assert.match(route, /connected: true/);
  assert.match(route, /ofbizRequest/);
});

test('fiscal manual mantém transmissão externa explicitamente desabilitada', () => {
  const domain = read('lib/domain/fiscal.ts');
  const route = read('app/api/fiscal/documents/route.ts');
  const detail = read('app/api/fiscal/documents/[id]/route.ts');
  const workspace = read('app/FiscalWorkspace.tsx');
  assert.match(domain, /NÃO TRANSMITIDO À SEFAZ OU À PREFEITURA/);
  assert.match(detail, /NÃO TRANSMITIDO À SEFAZ OU À PREFEITURA|Nenhuma transmissão para SEFAZ ou prefeitura/);
  assert.match(workspace, /FISCAL_MANUAL_NOTICE/);
  assert.match(route, /FISCAL_MANUAL_NOTICE/);
  assert.doesNotMatch(route, /fetch\s*\(/);
  assert.doesNotMatch(detail, /fetch\s*\(/);
});

test('contratos fiscais preservam auditoria e cancelamento manual controlado', () => {
  const route = read('app/api/fiscal/documents/route.ts');
  const detail = read('app/api/fiscal/documents/[id]/route.ts');
  assert.match(route, /fiscal_document_events/);
  assert.match(route, /integration_provider/);
  assert.match(detail, /document\.integrationProvider !== 'manual'/);
  assert.match(detail, /assertFinancePeriodOpen/);
  assert.match(detail, /command: z\.literal\('cancel'\)/);
});
