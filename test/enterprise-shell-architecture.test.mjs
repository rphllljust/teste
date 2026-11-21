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

test('enterprise workflow context links every known workspace without inventing destinations', async () => {
  const context = await readFile(new URL('../app/components/enterprise/EnterpriseWorkspaceContext.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  const modulesBlock = page.slice(page.indexOf('const modules:'), page.indexOf('const chain ='));
  const names = [...modulesBlock.matchAll(/^\s*\["([^"]+)",\s*[A-Za-z]+\],?\s*$/gm)].map(match => match[1]);
  const mappings = [...context.matchAll(/^\s*'([^']+)':\s*\[([^\]]+)\],?\s*$/gm)]
    .map(match => ({ name: match[1], targets: [...match[2].matchAll(/'([^']+)'/g)].map(value => value[1]) }));

  assert.equal(names.length, 26, 'the enterprise shell must preserve all 26 known navigation destinations');
  assert.equal(new Set(names).size, 26, 'no duplicate navigation destinations');
  assert.equal(mappings.length, 26, 'every workspace must have real cross-module actions');
  assert.deepEqual(new Set(mappings.map(link => link.name)), new Set(names));
  for (const { name, targets } of mappings) {
    assert.equal(targets.length, 3, name + ' must have three relevant destinations');
    for (const target of targets) {
      assert.ok(names.includes(target), name + ' points to missing workspace ' + target);
      assert.notEqual(target, name, 'self navigation adds no operational value');
    }
  }
  assert.match(page, /<EnterpriseWorkspaceContext activePage=\{page\} onNavigate=\{navigate\}/);
  assert.match(context, /aria-label="Fluxos empresariais relacionados"/);
  assert.match(context, /href=\{'#' \+ encodeURIComponent\(name\)\}/);
  assert.match(context, /event.preventDefault\(\); onNavigate\(name\);/);
  assert.match(css, /\.enterprise-workflow-context-actions/);
});

test('unauthorized operational data cannot appear as confirmed zero', async () => {
  const command = await readFile(new URL('../app/EnterpriseCommandCenter.tsx', import.meta.url), 'utf8');
  assert.match(page, /dataState=\{loading \? "loading" : error \? "unavailable" : "ready"\}/);
  assert.match(command, /dataState==='ready'\?value:'—'/);
  assert.match(command, /dataState==='ready'\?summary.total:'—'/);
  assert.match(command, /Indicadores indisponíveis/);
});

test('service order object evidence is fetched only on demand and remains owner-scoped', async () => {
  const workbench = await readFile(new URL('../app/ServiceOperationsWorkspace.tsx', import.meta.url), 'utf8');
  const evidence = await readFile(new URL('../app/components/enterprise/ServiceOrderEvidence.tsx', import.meta.url), 'utf8');
  const detailRoute = await readFile(new URL('../app/api/orders/[id]/route.ts', import.meta.url), 'utf8');
  assert.match(workbench, /<ServiceOrderEvidence key=\{selected.id\} orderId=\{selected.id\}/);
  assert.match(evidence, /if \(!open\) return;/);
  assert.match(evidence, /fetch\('\/api\/orders\/' \+ encodeURIComponent\(orderId\)/);
  assert.match(evidence, /if \(!response.ok\) throw new Error/);
  assert.match(evidence, /state === 'error'/);
  assert.match(detailRoute, /owner_id=\$2/);
  assert.match(detailRoute, /requestContext\(request\)/);
});

test('business-domain breadcrumbs preserve navigation semantics', async () => {
  const navigation = await readFile(new URL('../app/components/enterprise/EnterpriseAppNavigation.tsx', import.meta.url), 'utf8');
  for (const group of ['OPERAÇÃO', 'PLANEJAMENTO E RECURSOS', 'RELACIONAMENTO', 'FINANÇAS', 'SUPRIMENTOS', 'FISCAL E CONTABILIDADE']) {
    assert.ok(navigation.includes("'" + group + "':"), 'missing localized breadcrumb: ' + group);
  }
  assert.match(navigation, /const groupLabel = groupLabels\[group\] \?\? group/);
});

test('new enterprise components only use official Microsoft Fluent React primitives', async () => {
  const sources = await Promise.all([
    readFile(new URL('../app/components/enterprise/EnterpriseWorkspaceContext.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/components/enterprise/ServiceOrderEvidence.tsx', import.meta.url), 'utf8'),
  ]);
  for (const source of sources) {
    assert.match(source, /from '@fluentui\/react-icons'/);
    assert.doesNotMatch(source, /from ['"](?:lucide-react|@shadcn|@mui|@radix-ui|antd)['"]/);
  }
  assert.match(sources[0], /from '@fluentui\/react-components'/);
  const contract = await readFile(new URL('../docs/enterprise-tier1-execution-contract.md', import.meta.url), 'utf8');
  assert.match(contract, /www\.sap\.com\/design-system\/fiori-design-web/);
  assert.match(contract, /fluent2\.microsoft\.design/);
  assert.match(contract, /docs\.oracle\.com\/en\/middleware\/developer-tools\/jet/);
  assert.match(contract, /não copiar o CSS Oracle JET/i);
});
