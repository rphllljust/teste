import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const primitive = fs.readFileSync("app/components/enterprise/EnterprisePrimitives.tsx", "utf8");
const assets = fs.readFileSync("app/AssetsWorkspace.tsx", "utf8");
const professionals = fs.readFileSync("app/ProfessionalsWorkspace.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("canonical enterprise data states expose the required business distinctions", () => {
  for (const kind of ["error", "blocked", "manual", "not_configured", "unavailable"]) {
    assert.match(primitive, new RegExp("'" + kind + "'"));
    assert.match(css, new RegExp(`enterprise-data-state-${kind}`));
  }
});

test("safe resource workspaces use the canonical state component without synthetic data", () => {
  assert.match(assets, /EnterpriseDataState/);
  assert.match(assets, /kind="error"/);
  assert.match(assets, /kind="not_configured"/);
  assert.match(professionals, /EnterpriseDataState/);
  assert.match(professionals, /kind="error"/);
  assert.match(professionals, /kind="not_configured"/);
  assert.doesNotMatch(assets, /mock|fake|synthetic/i);
  assert.doesNotMatch(professionals, /mock|fake|synthetic/i);
});
