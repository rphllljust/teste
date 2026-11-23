import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(docsDir, "../..");
const inventory = JSON.parse(fs.readFileSync(path.join(docsDir, "route-inventory.json"), "utf8"));

test("inventário possui esquema e rotas únicas", () => {
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.generatedFrom.canonicalBase, "/");
  assert.ok(inventory.routes.length >= 20);
  const routes = inventory.routes.map((entry) => entry.route);
  assert.equal(new Set(routes).size, routes.length);
});

test("cada contrato aponta para workspace existente e estado permitido", () => {
  const states = new Set(["migrated-and-tested", "in-transformation", "blocked-by-dependency", "justified-out-of-scope"]);
  for (const entry of inventory.routes) {
    assert.match(entry.route, /^\/#/);
    assert.ok(entry.domain);
    assert.ok(entry.workspace);
    assert.ok(entry.api.length > 0);
    assert.ok(states.has(entry.migration), `${entry.route}: estado inválido`);
    assert.equal(fs.existsSync(path.join(repoDir, entry.workspace)), true, `${entry.route}: workspace ausente`);
  }
});

test("contratos de API documentados aparecem no workspace correspondente", () => {
  for (const entry of inventory.routes) {
    const delegatedSource = entry.api.find((endpoint) => endpoint.startsWith("delegated:"))?.match(/\(([^)]+)\)/)?.[1];
    const source = fs.readFileSync(path.join(repoDir, delegatedSource ?? entry.workspace), "utf8");
    const apiEndpoints = entry.api
      .map((endpoint) => endpoint.match(/\/api\/[^ ]+/)?.[0] ?? "")
      .filter((endpoint) => endpoint && !endpoint.includes("/["));
    for (const endpoint of apiEndpoints) {
      assert.ok(source.includes(endpoint), `${entry.workspace}: endpoint não encontrado: ${endpoint}`);
    }
  }
});

test("teste é isolado e não importa aplicação", () => {
  const source = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.match(source, /node:test/);
  assert.doesNotMatch(source, /from ["'][^.]?\/?app\//);
  assert.ok(fs.existsSync(path.join(docsDir, "route-inventory.md")));
});
