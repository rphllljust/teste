import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/components/enterprise/EnterprisePrimitives.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

test('enterprise primitives expose the governance component contracts', () => {
  for (const name of [
    'EnterprisePageHeader', 'EnterpriseObjectPage', 'EnterpriseObjectHeader',
    'EnterpriseDataGrid', 'EnterpriseFilterBar', 'EnterpriseWorklist',
    'EnterpriseKpiCard', 'EnterpriseAnalyticalChart', 'EnterpriseErrorBoundary',
  ]) assert.match(source, new RegExp(`(?:export (?:function|class|const) ${name}\\b)`), name);
});

test('data grid contract is accessible and keyboard-operable', () => {
  assert.match(source, /DataGrid as FluentDataGrid/);
  assert.match(source, /<FluentDataGrid\s+className="enterprise-desktop-grid"\s+aria-label=\{caption\}/);
  assert.match(source, /<DataGridHeader>/);
  assert.match(source, /onSortChange=/);
  assert.match(source, /onRowClick\?\.\(item\)/);
  assert.match(source, /getRowId=\{row=>String\(getRowKey\(row\)\)\}/);
  assert.match(source, /<ul className="enterprise-mobile-records"/);
  assert.match(source, /<dt>\{column.headerLabel\?\?column.header\}<\/dt>/);
});

test('operational feedback and filters use live or alert semantics', () => {
  assert.match(source, /<form className="enterprise-filter-bar" aria-label=\{label\}/);
  assert.match(source, /EnterpriseButton type="submit" appearance="subtle"/);
  assert.match(source, /<FluentField label=\{label\}/);
  assert.match(source, /<FluentInput type="search"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-busy="true"/);
  assert.match(source, /type="button" className="secondary"/);
});

test('the shared control layer uses the official Fluent UI components', () => {
  for (const component of ['FluentButton', 'FluentDataGrid', 'FluentField', 'FluentInput', 'FluentDropdown', 'FluentTabList', 'FluentTextarea']) {
    assert.match(source, new RegExp(`\\b${component}\\b`), component);
  }
  assert.match(source, /from '@fluentui\/react-icons'/);
});

test('enterprise layout contracts include narrow-screen behavior', () => {
  assert.match(styles, /\.enterprise-data-grid\{width:100%;overflow-x:auto/);
  assert.match(styles, /\.enterprise-object-tabs\{display:flex;gap:20px;overflow-x:auto/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /\.enterprise-filter-fields\{align-items:stretch;flex-direction:column\}/);
  assert.match(styles, /\.enterprise-kpi-card:focus-visible/);
});

test('Fluent dropdown uses value callbacks and does not fabricate native change events', () => {
  assert.match(source, /onValueChange\?: \(value: string\) => void/);
  assert.match(source, /setUncontrolledValue\(next\)/);
  assert.match(source, /name=\{name\} value=\{selectedValue\} disabled=\{disabled\}/);
  assert.doesNotMatch(source, /as ChangeEvent<HTMLSelectElement>/);
});
