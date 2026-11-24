import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/components/enterprise/EnterprisePrimitives.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
const shell = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('enterprise primitives expose the governance component contracts', () => {
  for (const name of [
    'EnterprisePageHeader', 'EnterpriseObjectPage', 'EnterpriseObjectHeader',
    'EnterpriseDataGrid', 'EnterpriseFilterBar', 'EnterpriseWorklist',
    'EnterpriseKpiCard', 'EnterpriseAnalyticalChart', 'EnterpriseErrorBoundary',
  ]) assert.match(source, new RegExp(`(?:export (?:function|class|const) ${name}\\b)`), name);
});

test('data grid contract is accessible and keyboard-operable', () => {
  assert.match(source, /<caption className="sr-only">\{caption\}<\/caption>/);
  assert.match(source, /scope="col"/);
  assert.match(source, /aria-sort=/);
  assert.match(source, /tabIndex=\{onRowClick \? 0 : undefined\}/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(source, /aria-label=\{`Ordenar por/);
});

test('operational feedback and filters use live or alert semantics', () => {
  assert.match(source, /<form className="enterprise-filter-bar" aria-label=\{label\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-busy="true"/);
  assert.match(source, /type="button" className="secondary"/);
});

test('enterprise layout contracts include narrow-screen behavior', () => {
  assert.match(styles, /\.enterprise-data-grid\{width:100%;overflow-x:auto/);
  assert.match(styles, /\.enterprise-object-tabs\{display:flex;gap:20px;overflow-x:auto/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /\.enterprise-filter-fields\{align-items:stretch;flex-direction:column\}/);
  assert.match(styles, /\.enterprise-kpi-card:focus-visible/);
});

test('operational shell does not render the retired duplicate heading', () => {
  assert.doesNotMatch(shell, /heading-legacy-notice/);
  assert.match(shell, /<EnterprisePageHeader[\s\S]*?\{viewNotice && !savingView/);
});
