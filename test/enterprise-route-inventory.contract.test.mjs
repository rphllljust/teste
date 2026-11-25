import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [pageSource, documentSource, catalogSource] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../docs/enterprise-route-inventory.md", import.meta.url), "utf8"),
  readFile(new URL("../lib/navigation/catalog.ts", import.meta.url), "utf8"),
]);

const expectedGroups = [
  ["INÍCIO E OPERAÇÃO", ["Visão operacional", "Field Service Cockpit", "Resource Planning Board", "Ordens de serviço", "Execução", "Medições"]],
  ["COMERCIAL E RELACIONAMENTO", ["CRM e Vendas", "Clientes e propostas", "Propostas e PO"]],
  ["CONTRATOS E SUPRIMENTOS", ["Contratos", "Compras", "Estoque e compras"]],
  ["RECURSOS E LOGÍSTICA", ["Frota e ativos", "Profissionais"]],
  ["FINANCEIRO E CONTROLADORIA", ["Faturamento", "Visão financeira", "Financeiro", "Fluxo de caixa", "Tesouraria", "Contas a pagar", "Caixa e conciliação", "Fiscal e tributos", "Contabilidade", "Razão contábil", "Fechamentos"]],
];

test("typed catalog contains the exact enterprise entries, groups and order without duplicates", () => {
  assert.match(catalogSource, /export type ModuleNavItem/);
  assert.match(catalogSource, /export const moduleGroups/);
  const groups = [...catalogSource.matchAll(/\\{\\s*id:\\s*"([^"]+)",\\s*label:\\s*"([^"]+)",\\s*items:\\s*\\[([\\s\\S]*?)\\]\\s*\\}/g)];
  assert.equal(groups.length, expectedGroups.length, "Unexpected group count in typed navigation");
  const ids = [];
  for (const [index, [, groupId, groupLabel, source]] of groups.entries()) {
    const [expectedLabel, expectedEntries] = expectedGroups[index];
    assert.ok(groupId, "Every group must have an id");
    assert.equal(groupLabel, expectedLabel);
    const entries = [...source.matchAll(/item\\("([^"]+)",\\s*"([^"]+)",\\s*"([^"]+)"\\)/g)];
    assert.deepEqual(entries.map((entry) => entry[2]), expectedEntries, `Navigation entries differ in ${groupLabel}`);
    ids.push(...entries.map((entry) => entry[1]));
  }
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, ids.length, "Module ids must be unique");
  assert.match(catalogSource, /export const moduleItems = moduleGroups\\.flatMap/);
});

test("catalog exposes deep-link helpers", () => {
  assert.match(catalogSource, /export function isModuleLabel/);
  assert.match(catalogSource, /export function moduleHash/);
  assert.match(catalogSource, /encodeURIComponent/);
  assert.match(catalogSource, /export function moduleFromHash/);
});

test("page consumes the typed catalog and keeps hash navigation", () => {
  assert.match(pageSource, /moduleGroups/);
  assert.match(pageSource, /isModuleLabel\(name\)/);
  assert.match(pageSource, /window\.history\.pushState/);
});

test("documentation is synchronized with the shell inventory", () => {
  const rows = documentSource.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Grupo"));
  assert.equal(rows.length, expectedGroups.length);
});
