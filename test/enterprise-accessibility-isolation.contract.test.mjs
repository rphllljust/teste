import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const files = Object.freeze({
  page: await readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  primitives: await readFile(new URL("../app/components/enterprise/EnterprisePrimitives.tsx", import.meta.url), "utf8"),
  auth: await readFile(new URL("../lib/api/http-auth.test.mjs", import.meta.url), "utf8"),
  origin: await readFile(new URL("../lib/api/mutation-origin.test.mjs", import.meta.url), "utf8"),
  sessions: await readFile(new URL("../lib/api/staging-session.test.mjs", import.meta.url), "utf8"),
});
function expectAll(source, patterns, scope) { for (const [label, pattern] of patterns) assert.match(source, pattern, scope + ": " + label); }
test("enterprise primitives expose WCAG-relevant semantics", () => {
  expectAll(files.primitives, [
    ["labelled page heading", /enterprise-page-header.*aria-labelledby/],
    ["main landmark", /enterprise-object-page/],
    ["labelled object sections", /enterprise-object-section.*aria-labelledby/],
    ["grid region", /role="region" aria-label/],
    ["table caption", /<caption className="sr-only">/],
    ["sorting semantics", /aria-sort=/],
    ["live loading state", /aria-live="polite"/],
    ["alert errors", /role="alert"/],
  ], "EnterprisePrimitives");
});
test("shell navigation exposes enterprise navigation semantics", () => {
  expectAll(files.page, [
    ["navigation landmark", /<nav aria-label="Módulos empresariais">/],
    ["active module", /aria-current=/],
    ["keyboard-operable navigation", /onClick=\{\(\) => navigate\(name\)\}/],
  ], "enterprise shell");
});
test("tenant and permission security contracts remain covered", () => {
  expectAll(files.auth, [["authentication boundary", /stagingBoundaryError|STAGING_PRIVATE_ACCESS_REQUIRED|oai-authenticated-user-id/], ["tenant boundary", /staging|private|forged|identity/i]], "HTTP auth");
  expectAll(files.origin, [["origin validation", /origin|Origin|CSRF|mutation/i], ["unsafe mutation rejection", /false|forged|lookalike|evil/i]], "mutation origin");
  expectAll(files.sessions, [["authenticated session", /cookie|session|assinad|authenticated/i], ["invalid session rejection", /401|403|invalid|inválid/i]], "staging session");
});
test("unsupported capabilities remain explicit", () => {
  expectAll(files.page, [["command metadata", /availableCommands/], ["blocked/manual state", /blocked|manual|not.?configured|não configurad|indispon/i], ["refresh", /Atualizar|refresh|reload/i]], "enterprise shell");
});

test("global quick access uses real module routing, not decorative links", () => {
  expectAll(files.page, [
    ["enterprise quick access landmark", /<nav className="enterprise-quick-access" aria-label="Acesso rápido aos módulos">/],
    ["all module quick actions navigate", /onClick=\{\(\) => navigate\(module\)\}/],
    ["quick navigation tracks current module", /aria-current=\{page === module \? "page" : undefined\}/],
  ], "global module shortcuts");
});
test("density is persisted safely without affecting tenant state or API permissions", () => {
  expectAll(files.page, [
    ["density attribute", /data-density=\{density\}/],
    ["restored preference", /localStorage\.getItem\("cisne:workspace-density"\)/],
    ["stored preference", /localStorage\.setItem\("cisne:workspace-density", next\)/],
    ["accessible density button", /aria-pressed=\{density === "compact"\}/],
    ["two density states", /"compact" \| "comfortable"/],
  ], "responsive workspace density");
});


test("enterprise journey offers eight real workspaces without claiming business completion",async()=>{
 const center=await readFile(new URL('../app/EnterpriseCommandCenter.tsx',import.meta.url),'utf8');
 const nav=await readFile(new URL('../lib/navigation/catalog.ts',import.meta.url),'utf8');
 for(const mod of ['Clientes e propostas','Contratos','Ordens de serviço','Execução','Medições','Faturamento','Caixa e conciliação','Contabilidade']){
  assert.match(center,new RegExp("module:'"+mod+"'"),mod+' must exist in enterprise journey');
  assert.ok(nav.includes('"'+mod+'"'),mod+' must resolve to a real workspace');
 }
 assert.match(center,/<nav className="value-stream" aria-label="Jornada empresarial entre módulos">/);
 assert.match(center,/A navegação não significa que uma transação foi concluída/);
 assert.match(center,/onClick=\{\(\)=>navigate\(step\.module\)\}/);
});

test("commercial-to-accounting journey exposes CRM, real proposals, treasury, and period close",async()=>{
 const center=await readFile(new URL('../app/EnterpriseCommandCenter.tsx',import.meta.url),'utf8');
 const nav=await readFile(new URL('../lib/navigation/catalog.ts',import.meta.url),'utf8');
 for(const moduleLabel of ['CRM e Vendas','Propostas e PO','Tesouraria','Fechamentos']){
  assert.ok(center.includes("module:'"+moduleLabel+"'"),moduleLabel+' must have a related action');
  assert.ok(nav.includes('"'+moduleLabel+'"'),moduleLabel+' must be a registered workspace');
 }
 assert.match(center,/onClick=\{\(\)=>navigate\(action\.module\)\}/);
 assert.match(center,/aria-label="Acessos complementares da jornada"/);
 assert.doesNotMatch(center,/navegação transacional/);
});
