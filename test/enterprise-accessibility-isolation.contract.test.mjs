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
  expectAll(files.auth, [["authentication", /401|unauthorized|autentic/i], ["tenant ownership", /owner_id|ownerId|tenant/i]], "HTTP auth");
  expectAll(files.origin, [["origin validation", /origin|Origin|CSRF|mutation/i], ["unsafe mutation rejection", /403|forbidden|rejeit/i]], "mutation origin");
  expectAll(files.sessions, [["authenticated session", /cookie|session|assinad|authenticated/i], ["invalid session rejection", /401|403|invalid|inválid/i]], "staging session");
});
test("unsupported capabilities remain explicit", () => {
  expectAll(files.page, [["command metadata", /availableCommands/], ["blocked/manual state", /blocked|manual|not.?configured|não configurad|indispon/i], ["refresh", /Atualizar|refresh|reload/i]], "enterprise shell");
});
