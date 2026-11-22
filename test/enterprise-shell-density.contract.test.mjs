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
