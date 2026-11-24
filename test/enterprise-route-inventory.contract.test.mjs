import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { moduleGroups, moduleItems, isModuleLabel, moduleHash, moduleFromHash } from "../lib/navigation/catalog.ts";

const [pageSource, documentSource] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../docs/enterprise-route-inventory.md", import.meta.url), "utf8"),
]);

const expectedGroups = [
  ["INÍCIO E OPERAÇÃO", ["Visão operacional", "Field Service Cockpit", "Resource Planning Board", "Ordens de serviço", "Execução", "Medições"]],
  ["COMERCIAL E RELACIONAMENTO", ["CRM e Vendas", "Clientes e propostas", "Propostas e PO"]],
  ["CONTRATOS E SUPRIMENTOS", ["Contratos", "Compras", "Estoque e compras"]],
  ["RECURSOS E LOGÍSTICA", ["Frota e ativos", "Profissionais"]],
  ["FINANCEIRO E CONTROLADORIA", ["Faturamento", "Visão financeira", "Financeiro", "Fluxo de caixa", "Tesouraria", "Contas a pagar", "Caixa e conciliação", "Fiscal e tributos", "Contabilidade", "Razão contábil", "Fechamentos"]],
];

test("typed catalog contains all enterprise entries without duplicates", () => {
  assert.deepEqual(moduleGroups.map((g) => [g.label, g.items.map((i) => i.label)]), expectedGroups);
  assert.equal(moduleItems.length, 25);
  assert.equal(new Set(moduleItems.map((i) => i.label)).size, 25);
  assert.equal(new Set(moduleItems.map((i) => i.id)).size, 25);
});

test("catalog preserves deep-link hashes and rejects unknown routes", () => {
  for (const label of moduleItems.map((i) => i.label)) {
    assert.equal(moduleFromHash(moduleHash(label)), label);
    assert.equal(isModuleLabel(label), true);
  }
  assert.equal(moduleFromHash("#not-a-module"), "Visão operacional");
});

test("page consumes the typed catalog and keeps the hash navigation contract", () => {
  assert.match(pageSource, /moduleGroups/);
  assert.match(pageSource, /isModuleLabel\(name\)/);
  assert.match(pageSource, /window\.history\.pushState\(null, "", moduleHash\(name\)\)/);
});

test("documentation is synchronized with the actual shell inventory", () => {
  const rows = documentSource.split("\\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Grupo"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  const docs = ["Início e operação", "Comercial e relacionamento", "Contratos e suprimentos", "Recursos e logística", "Financeiro e controladoria"];
  assert.deepEqual(rows, expectedGroups.map(([_, entries], i) => [docs[i], entries.join("; ")]));
});
