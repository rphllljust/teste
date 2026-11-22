import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('global process strip belongs to the operational overview, not every module', () => {
  assert.match(source, /page === "Visão operacional" && !creating && !action && \(/);
  assert.doesNotMatch(source, /"Fiscal e tributos",\s*"Contabilidade",\s*\]\.includes\(page\) && \(/);
});

test('workspaces with dedicated enterprise headers do not receive another shell heading', () => {
  const shellHeading = source.slice(source.indexOf('          {!creating &&'), source.indexOf('              <div className="heading">'));
  for (const page of ['Compras', 'Visão financeira', 'CRM e Vendas', 'Field Service Cockpit', 'Resource Planning Board']) {
    assert.ok(shellHeading.includes(`"${page}"`), `Missing heading exclusion: ${page}`);
  }
});

test('all enterprise destinations are grouped once across six business domains', () => {
  const block = source.slice(source.indexOf('const modules:'), source.indexOf('const chain = ['));
  const groups = [...block.matchAll(/group: "([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(groups, [
    'OPERAÇÃO',
    'COMERCIAL E CONTRATOS',
    'RECURSOS E PLANEJAMENTO',
    'SUPRIMENTOS',
    'FINANCEIRO',
    'FISCAL E CONTABILIDADE',
  ]);
  const destinations = [...block.matchAll(/^\s*\["([^"]+)",\s*[A-Za-z]+\],?$/gm)].map(match => match[1]);
  assert.equal(destinations.length, 25);
  assert.equal(new Set(destinations).size, destinations.length, 'Each destination must appear exactly once');
});
