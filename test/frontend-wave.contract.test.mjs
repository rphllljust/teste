import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
const floorplans = await Promise.all([
  'enterprise-floorplans.css', 'resource-floorplans.css', 'commercial-floorplans.css',
  'finance-floorplans.css', 'operations-floorplans.css',
].map(name => readFile(new URL(`../app/${name}`, import.meta.url), 'utf8')));

test('global shell exposes one coordinated enterprise context', () => {
  assert.match(page, /<EnterpriseWorkspaceBar current=\{page\}/);
  assert.match(page, /<EnterpriseErrorBoundary>/);
  assert.match(page, /enterpriseSpecializedWorkspaces as specializedWorkspace/);
  assert.match(page, /setPalette\(true\)/);
});

test('all priority domains are represented by coordinated floorplans', () => {
  for (const domain of ['CRM e Vendas','Clientes e propostas','Propostas e PO','Contratos','Execução','Visão financeira','Contabilidade','Fiscal e tributos','Compras','Estoque e compras']) assert.match(page, new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const sheet of floorplans) assert.match(sheet, /@media\(max-width:700px\)/);
  assert.match(styles, /@import '\.\/enterprise-floorplans\.css'/);
});
