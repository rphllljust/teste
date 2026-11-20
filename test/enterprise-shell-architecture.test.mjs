import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const sidebar = await readFile(new URL('../app/components/enterprise/EnterpriseAppNavigation.tsx', import.meta.url), 'utf8');
const journey = await readFile(new URL('../app/components/enterprise/EnterpriseProcessJourney.tsx', import.meta.url), 'utf8');

test('every existing workspace renders inside the shared enterprise shell', () => {
  assert.match(page, /<EnterpriseSidebar\s+groups=\{modules\}/);
  assert.match(page, /<EnterpriseTopbar\s+activePage=\{page\}/);
  assert.match(page, /id="cisne-workspace-content"/);
  assert.match(page, /<EnterpriseProcessJourney/);
  assert.match(sidebar, /from '\.\/EnterprisePrimitives'/);
  assert.match(sidebar, /aria-current=\{activePage === name \? 'page' : undefined\}/);
});

test('the navigation has functional accordion and accessible semantic landmarks', () => {
  assert.match(sidebar, /aria-label="Módulos empresariais"/);
  assert.match(sidebar, /aria-expanded=\{expanded\}/);
  assert.match(sidebar, /setCollapsed\(previous =>/);
  assert.match(sidebar, /onClick=\{\(\) => onNavigate\(name\)\}/);
  assert.match(sidebar, /aria-label="Localização no CISNE"/);
  assert.match(sidebar, /onClick=\{onSearch\}/);
});

test('process navigation retains real callbacks and does not invent later transitions', () => {
  assert.match(journey, /onStageSelect\(index\)/);
  assert.match(journey, /aria-disabled="true"/);
  assert.match(journey, /onViewportKeyDown/);
  assert.doesNotMatch(journey, /fetch\(/);
});

test('legacy service operations cockpit is mounted as an actionable workspace', () => {
  assert.match(page, /import ServiceOperationsWorkspace from/);
  assert.match(page, /\["Centro de operações", Activity\]/);
  assert.match(page, /page === "Centro de operações" \? \(/);
  assert.match(page, /onOpen=\{\(id\) =>/);
});
