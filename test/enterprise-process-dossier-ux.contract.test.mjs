import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('app/page.tsx');
const nav=read('lib/navigation/catalog.ts');
const cockpit=read('app/EnterpriseCommandCenter.tsx');
const workspace=read('app/EnterpriseDossierWorkspace.tsx');
const css=read('app/components/enterprise/enterprise-dossier.css');
const layout=read('app/layout.tsx');

test('the process dossier is a real globally navigable ERP workspace',()=>{
  assert.match(nav,/item\("enterprise-dossiers","Dossiês empresariais","file"\)/);
  assert.match(shell,/import EnterpriseDossierWorkspace from "\.\/EnterpriseDossierWorkspace"/);
  assert.match(shell,/page === "Dossiês empresariais"/);
  assert.match(shell,/<EnterpriseDossierWorkspace key=\{businessOrder\|\|'dossier-list'\} navigate=\{navigate\}/);
  assert.match(shell,/initialOrderId=\{businessOrder\|\|null\}/);
  assert.match(cockpit,/module:'Dossiês empresariais'/);
  assert.match(layout,/enterprise-dossier\.css/);
});

test('the workspace reads trusted persisted facts rather than simulating business progress',()=>{
  assert.match(workspace,/fetch\('\/api\/enterprise\/journeys\?'\+params/);
  assert.match(workspace,/fetch\('\/api\/enterprise\/journeys\/'\+encodeURIComponent\(selectedId\)/);
  assert.match(workspace,/cache:'no-store',credentials:'same-origin'/);
  assert.match(workspace,/detail\.provenance\.warning/);
  assert.match(workspace,/Etapas com registros não representam processos concluídos/);
  assert.match(workspace,/Não equivale ao saldo contábil global do cliente/);
  assert.match(workspace,/detail\.stages\.map/);
  assert.match(workspace,/detail\.financials\.outstandingScaled/);
  assert.doesNotMatch(workspace,/Math\.random|faker|mockData|mockOrders/i);
});

test('business drawer and worklist are keyboard-operable and responsive across devices',()=>{
  assert.match(workspace,/<EnterpriseSmartGrid viewId="enterprise-dossiers"/);
  assert.match(read('app/components/enterprise/EnterpriseSmartGrid.tsx'),/role="region"/);
  assert.match(workspace,/role="dialog" aria-modal="true"/);
  assert.match(workspace,/event\.key==='Escape'/);
  assert.match(workspace,/event\.key!=='Tab'/);
  assert.match(workspace,/openLabel=\{item=>'Abrir dossiê da OS '/);
  assert.match(workspace,/if\(!abort\.signal\.aborted\)/);
  assert.match(css,/\.enterprise-dossier-drawer/);
  assert.match(css,/@media \(max-width:700px\)/);
  assert.match(css,/@media \(forced-colors:active\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('scaled money uses BigInt to avoid rounding persisted financial facts',()=>{
  assert.match(workspace,/BigInt\(raw\)/);
  assert.match(workspace,/toString\(\)\.padStart\(5, '0'\)/);
  assert.doesNotMatch(workspace,/Number\(raw\)\s*\/\s*10000/);
});

test('dossier provides secure signed-session HML login only when the API requires it',()=>{
  assert.match(workspace,/response\.status === 403 && value\.code === 'STAGING_PRIVATE_ACCESS_REQUIRED'/);
  assert.match(workspace,/throw new HmlSessionRequired/);
  assert.match(workspace,/if\(cause instanceof HmlSessionRequired\)setNeedsAuth\(true\)/);
  assert.match(workspace,/needsAuth&&<section className="enterprise-dossier-auth"/);
  assert.match(workspace,/id="enterprise-dossier-auth-title"/);
  assert.match(workspace,/name="passphrase" type="password" minLength=\{24\} maxLength=\{160\}/);
  assert.match(workspace,/fetch\('\/api\/auth\/staging-login',\{/);
  assert.match(workspace,/method:'POST',credentials:'same-origin'/);
  assert.match(workspace,/result\.authenticated!==true/);
  assert.match(workspace,/setRevision\(previous=>previous\+1\)/);
  assert.match(workspace,/form\.reset\(\)/);
  assert.doesNotMatch(workspace,/localStorage|sessionStorage|console\.log\(passphrase\)/);
  assert.match(css,/\.enterprise-dossier-auth/);
  assert.match(css,/\.enterprise-dossier-auth input:focus-visible/);
});
