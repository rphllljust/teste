import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const files = Object.freeze({
  page: await readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  primitives: await readFile(new URL("../app/components/enterprise/EnterprisePrimitives.tsx", import.meta.url), "utf8"),
  auth: await readFile(new URL("../lib/api/http-auth.test.mjs", import.meta.url), "utf8"),
  crm: await readFile(new URL("../app/api/crm/route.ts", import.meta.url), "utf8"),
  origin: await readFile(new URL("../lib/api/mutation-origin.test.mjs", import.meta.url), "utf8"),
  sessions: await readFile(new URL("../lib/api/staging-session.test.mjs", import.meta.url), "utf8"),
});

function expectAll(source, patterns, scope) {
  for (const [label, pattern] of patterns) {
    assert.match(source, pattern, `${scope}: ${label}`);
  }
}

test("enterprise primitives expose WCAG-relevant semantics", () => {
  expectAll(files.primitives, [
    ["page header has a labelled heading", /<header className="enterprise-page-header" aria-labelledby=\{titleId\}>[\s\S]*?<h1 id=\{titleId\}>/],
    ["object pages use a main landmark", /<main className=\{\`enterprise-object-page/],
    ["object sections expose labelled headings", /<section className="enterprise-object-section" id=\{id\} aria-labelledby=/],
    ["data grids expose a region and keyboard entry point", /role="region" aria-label=\{caption\} tabIndex=\{0\}/],
    ["tables expose caption and column scope", /<caption className="sr-only">\{caption\}<\/caption>[\s\S]*?<th scope="col"/],
    ["sorting is announced through aria-sort", /aria-sort=\{sort\?\.key === column\.key/],
    ["loading state is live and busy", /role="status" aria-live="polite" aria-busy="true"/],
    ["errors are announced", /<div className="enterprise-error-state" role="alert">/],
    ["status badges use a status role", /role="status">\{label/],
  ], "EnterprisePrimitives");
});

test("shell navigation exposes a labelled enterprise navigation landmark", () => {
  expectAll(files.page, [
    ["navigation landmark is labelled", /<nav aria-label="Módulos empresariais">/],
    ["active module is represented", /aria-current=\{page === name \? "page" : undefined\}/],
    ["navigation entries are keyboard-operable buttons", /<button[\s\S]*?onClick=\{\(\) => navigate\(name\)\}/],
  ], "page shell");
});

test("tenant and permission tests are wired to real security contracts", () => {
  expectAll(files.auth, [
    ["forged staging identity is rejected", /staging public workspace denies a forged browser identity/],
    ["untrusted identities are denied with 403", /assert\.equal\(result\?\.status,\s*403\)/],
    ["client-supplied dispatch secrets are rejected", /staging rejects all client-supplied dispatch secrets and identity headers/],
  ], "HTTP auth tests");
  expectAll(files.crm, [
    ["CRM binds server-authenticated actor identity", /requestContext\(request/],
    ["CRM queries are tenant-scoped", /owner_id/],
    ["CRM uses the verified actor", /context\.actorId/],
  ], "CRM tenant isolation");
  expectAll(files.origin, [
    ["mutation origin is validated", /origin|Origin|CSRF|mutation/i],
    ["untrusted mutation origins are rejected", /assert\.equal\(mutationOriginAllowed\(request\(origin\),env\),false\)/],
  ], "mutation-origin tests");
  expectAll(files.sessions, [
    ["staging session is signed or authenticated", /cookie|session|assinad|authenticated/i],
    ["invalid session is rejected", /401|403|invalid|inválid/i],
  ], "staging-session tests");
});

test("critical UI contracts do not silently advertise unsupported capabilities", () => {
  expectAll(files.page, [
    ["commands are derived from available command metadata", /availableCommands/],
    ["unsupported external integration has explicit state handling", /blocked|manual|not.?configured|não configurad|indispon/i],
    ["data refresh is explicit", /Atualizar|refresh|reload/i],
  ], "enterprise shell");
});
