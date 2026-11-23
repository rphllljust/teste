import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/components/enterprise/EnterpriseFoundation.tsx', import.meta.url), 'utf8');
const tokens = await readFile(new URL('../app/components/enterprise/enterprise-tokens.css', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app/components/enterprise/enterprise-foundation.css', import.meta.url), 'utf8');

test('exposes the isolated CISNE Enterprise foundation contracts', () => {
  for (const name of ['EnterpriseAppShell', 'EnterprisePageLayout', 'EnterpriseFilterBar', 'EnterpriseActionBar', 'EnterpriseStatusBadge', 'EnterpriseSectionNavigation', 'EnterpriseDataGrid']) assert.match(source, new RegExp(`export function ${name}\\b`), name);
});

test('tokens contain the prescribed visual language and grid accessibility contracts', () => {
  for (const token of ['--cisne-color-canvas', '--cisne-color-navigation', '--cisne-color-primary', '--cisne-color-success', '--cisne-space-4']) assert.match(tokens, new RegExp(token));
  assert.match(source, /<caption className="enterprise-visually-hidden">\{caption\}<\/caption>/);
  assert.match(source, /scope="col"/);
  assert.match(source, /aria-sort=/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(styles, /@media \(max-width: 767px\)/);
});
