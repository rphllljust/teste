import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('app/components/enterprise/EnterpriseSmartGrid.tsx');
const style=read('app/components/enterprise/enterprise-experience.css');
const dossier=read('app/EnterpriseDossierWorkspace.tsx');
const professionals=read('app/ProfessionalsWorkspace.tsx');
const assets=read('app/AssetsWorkspace.tsx');
test('enterprise grid persists only non-sensitive column visibility settings',()=>{
 assert.match(source,/cisne:table:columns:/);
 assert.match(source,/localStorage\.setItem\(storageKey,JSON\.stringify\(next\)\)/);
 assert.match(source,/const requiredKeys=columns\.filter\(column=>column\.required\)/);
 assert.match(source,/columns\.filter\(column=>!hidden\.includes\(column\.key\)\)/);
 assert.match(source,/role="region"/);
 assert.match(source,/aria-sort=/);
 assert.match(source,/Selecionar registros visíveis da página/);
 assert.match(source,/if\(allSelected\)ordered\.forEach/);
 assert.doesNotMatch(source,/localStorage\.setItem\([^\n]*rows/);
});
test('CSV remains scoped to authorized current page and guards against formulas',()=>{
 assert.match(source,/exportRows=displayedSelected\.length\?displayedSelected:ordered/);
 assert.match(source,/function safeCsv/);
 assert.match(source,/\[=\+@-\]/);
 assert.match(source,/currentPageLabel="Página atual"/);
 assert.match(source,/Blob\(\[content\]/);
 assert.match(source,/não alteram permissões/);
});
test('three business modules consume the same configurable list report grid',()=>{
 assert.match(dossier,/<EnterpriseSmartGrid viewId="enterprise-dossiers"/);
 assert.match(professionals,/<EnterpriseSmartGrid<Professional> viewId="enterprise-professionals"/);
 assert.match(assets,/<EnterpriseSmartGrid<Asset> viewId="enterprise-assets"/);
 assert.match(style,/\.app \.enterprise-smart-toolbar/);
 assert.match(style,/\.app \.enterprise-smart-scroll/);
});
