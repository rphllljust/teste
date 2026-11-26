import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const primitives=read('app/components/enterprise/EnterprisePrimitives.tsx');
const dossier=read('app/EnterpriseDossierWorkspace.tsx');
const orders=read('app/page.tsx');
const css=read('app/components/enterprise/enterprise-dossier.css');

test('shared Object Page navigation can target the correct scrolled business document without changing hash',()=>{
 assert.match(primitives,/export function EnterpriseObjectSectionNavigation/);
 assert.match(primitives,/rootSelector = '\.drawer'/);
 assert.match(primitives,/navRef\.current\?\.closest\(rootSelector\)/);
 assert.match(primitives,/event\.preventDefault\(\); \/\/ Do not change the host application's URL hash/);
 assert.match(primitives,/target\.scrollIntoView/);
 assert.match(primitives,/target\.focus\(\{ preventScroll: true \}\)/);
 assert.match(primitives,/aria-current=\{active === section\.id \? 'location'/);
 for(const key of ['ArrowRight','ArrowLeft','Home','End'])
  assert.ok(primitives.includes("event.key === '"+key+"'"));
});

test('financial dossier renders factual 14-step stages under scoped sticky anchors',()=>{
 assert.match(dossier,/EnterpriseObjectSectionNavigation rootSelector="\.enterprise-dossier-drawer"/);
 assert.match(dossier,/label="Navegação pelas seções da cadeia empresarial"/);
 assert.match(dossier,/\.\.\.detail\.stages\.map\(stage=>\(\{id:'dossier-'\+stage\.key/);
 assert.match(dossier,/id=\{'dossier-'\+stage\.key\}/);
 assert.match(dossier,/id="dossier-financials"/);
 assert.match(dossier,/id="dossier-history"/);
 assert.match(css,/\.enterprise-dossier-drawer > \.object-anchors/);
 assert.match(css,/position:sticky/);
 assert.match(css,/aria-current="location"/);
 assert.match(css,/scroll-margin-top:145px/);
});

test('owned service order detail has global Object Page summary and actual scoped anchors',()=>{
 assert.match(orders,/<EnterpriseObjectSummary\s+type="Ordem de serviço"/);
 assert.match(orders,/<EnterpriseObjectSectionNavigation label="Seções da ordem de serviço"/);
 for(const id of ['order-scope','order-next','order-commercial','order-related','order-history'])
  assert.ok(orders.includes('id="'+id+'"'),'Missing actual document section '+id);
 assert.match(orders,/onClick=\{\(\) => command\(c\.id, selected\)\}/);
 assert.match(orders,/selected\.availableCommands\?\.map/);
 assert.match(css,/\.app \.drawer > \.object-anchors/);
 assert.doesNotMatch(dossier,/window\.location\.hash/);
});
