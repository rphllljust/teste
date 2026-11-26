import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const api=read('app/api/enterprise/operations/route.ts');
const workbench=read('app/EnterpriseOperationsWorkbench.tsx');
const command=read('app/EnterpriseCommandCenter.tsx');
const field=read('app/FieldServiceCockpit.tsx');
const page=read('app/page.tsx');
const css=read('app/components/enterprise/enterprise-operations-workbench.css');
const layout=read('app/layout.tsx');

test('operational API denies unowned objects and uses a repeatable-read snapshot',()=>{
 assert.match(api,/context=requestContext\(request\)/);
 assert.match(api,/o\.owner_id=\$1/);
 assert.doesNotMatch(api,/owner_id IS NULL OR/);
 assert.match(api,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(api,/await client\.query\('COMMIT'\)/);
 assert.match(api,/client\?\.release\(\)/);
 assert.match(api,/max\(50\)/);
 assert.match(api,/pageSize<total/);
 assert.match(api,/postgres_owner_scoped_operations/);
 assert.match(api,/COUNT\(\*\) FILTER\(WHERE/);
 assert.match(api,/EXISTS \(SELECT 1 FROM measurements done/);
 assert.match(api,/COUNT\(\*\)::int AS total/);
 assert.match(api,/to_char\(CURRENT_DATE,'YYYY-MM-DD'\)/);
});

test('center of operations is a real List Report with filtered/total distinction',()=>{
 assert.match(workbench,/fetch\('\/api\/enterprise\/operations\?'\+params/);
 assert.match(workbench,/cache:'no-store',credentials:'same-origin'/);
 assert.match(workbench,/queue:'attention'|mode==='field'\?'executing':'attention'/);
 assert.match(workbench,/<EnterpriseSmartGrid viewId=\{'operations-'\+mode\}/);
 assert.match(workbench,/data\.pageInfo\.total/);
 assert.match(workbench,/summary\?\.total/);
 assert.match(workbench,/summary\?\.overdue/);
 assert.match(workbench,/summary\?\.unmeasured/);
 assert.match(workbench,/summary\?\.draft/);
 assert.match(workbench,/onClick=\{\(\)=>selectQueue\(item\.key\)\}/);
 assert.match(workbench,/aria-pressed=\{queue===item\.key\}/);
 assert.match(workbench,/Não existe|Nenhum comando de transição disponível/);
 assert.doesNotMatch(workbench,/faker|mockOrders|Math\.random\(/i);
});

test('Object Page fetches owner-scoped detail and exposes only real allowed commands',()=>{
 assert.match(workbench,/fetch\('\/api\/orders\/'\+encodeURIComponent\(selectedId\)/);
 assert.match(workbench,/<EnterpriseObjectSummary type="Ordem de serviço"/);
 assert.match(workbench,/detail\.order\.availableCommands/);
 assert.match(workbench,/onClick=\{\(\)=>onOpenOrder\(selected\.id\)\}/);
 assert.match(workbench,/navigate\('Dossiês empresariais'\)/);
 assert.match(workbench,/navigate\('Resource Planning Board'\)/);
 assert.match(workbench,/detail\.order\.sublists\?\.history/);
 assert.doesNotMatch(workbench,/fetch\('\/api\/commands'\)|method:'POST'/);
});

test('Visão operacional and Field Service share enterprise source, without double chain on dashboard',()=>{
 assert.match(command,/<EnterpriseOperationsWorkbench navigate=\{navigate\}/);
 assert.match(field,/<EnterpriseOperationsWorkbench mode="field"/);
 assert.match(command,/showMap&&<div className="enterprise-command-navigation-content"/);
 assert.match(command,/<nav className="value-stream" aria-label="Jornada empresarial entre módulos">/);
 assert.match(page,/"Dossiês empresariais",\s*"Visão operacional",\s*\]\.includes\(page\)/);
 assert.match(page,/\[\s*"Ordens de serviço",\s*"Execução",\s*"Medições"/);
 assert.ok(layout.includes('enterprise-operations-workbench.css'));
 assert.match(css,/\.enterprise-operations-body/);
 assert.match(css,/@media\(max-width:720px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/forced-colors:active/);
});
