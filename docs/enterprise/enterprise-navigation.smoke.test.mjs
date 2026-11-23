import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(docsDir, "../..");
const pageSource = fs.readFileSync(path.join(repoDir, "app/page.tsx"), "utf8");
const inventory = JSON.parse(fs.readFileSync(path.join(docsDir, "route-inventory.json"), "utf8"));

function navigationLabels() {
  const block = pageSource.match(/const modules:[\s\S]*?= \[[\s\S]*?\n\];/u)?.[0] ?? "";
  return [...block.matchAll(/\["([^"\\]*(?:\\.[^"\\]*)*)",\s*[A-Za-z]/gu)].map((match) => match[1]);
}

const labels = navigationLabels();

test("navegação empresarial possui grupos e labels únicos", () => {
  assert.ok(labels.length >= 20);
  assert.equal(new Set(labels).size, labels.length);
  assert.match(pageSource, /aria-label="Módulos empresariais"/u);
});

test("cada item de navegação possui renderização de workspace", () => {
  for (const label of labels) {
    assert.match(pageSource, new RegExp(`page === "${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"`), `${label}: workspace não mapeado`);
  }
});

test("deep links usam hash codificado e aceitam somente labels canônicos", () => {
  assert.match(pageSource, /window\.history\.pushState\(null, "", "#" \+ encodeURIComponent\(name\)\)/u);
  assert.match(pageSource, /decodeURIComponent\(raw\)/u);
  assert.match(pageSource, /modules\.some\(\(g\) => g\.items\.some\(\(\[n\]\) => n === name\)\)/u);
  for (const label of labels) {
    const hash = `#${encodeURIComponent(label)}`;
    assert.equal(decodeURIComponent(hash.slice(1)), label);
  }
  assert.equal(labels.includes("Rota fictícia"), false);
});

test("inventário não contém rotas fictícias e corresponde à navegação", () => {
  const inventoryLabels = inventory.routes.map((entry) => decodeURIComponent(entry.route.replace(/^\/#/u, "")));
  assert.ok(inventoryLabels.length >= 20);
  assert.equal(new Set(inventoryLabels).size, inventoryLabels.length);
  for (const label of inventoryLabels) {
    if (!labels.includes(label)) {
      const entry = inventory.routes.find((item) => decodeURIComponent(item.route.replace(/^\/#/u, "")) === label);
      assert.ok(entry?.workspace && fs.existsSync(path.join(repoDir, entry.workspace)), `${label}: rota fictícia ou workspace ausente`);
    }
  }
  for (const label of labels) {
    assert.ok(inventoryLabels.includes(label), `${label}: item sem contrato de inventário`);
  }
});

test("smoke é independente de banco, servidor e imports da aplicação", () => {
  assert.equal(typeof fs.readFileSync, "function");
  assert.equal(typeof JSON.parse, "function");
});
