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

test("typed catalog contains all enterprise entries without duplicates", () => {
  assert.match(catalogSource, /export type ModuleNavItem/);
  assert.match(catalogSource, /export const moduleGroups/);
  for (const [group, entries] of expectedGroups) {
    assert.ok(catalogSource.includes('label: "' + group + '"'));
    for (const entry of entries) assert.ok(catalogSource.includes('label: "' + entry + '"'));
  }
  assert.match(catalogSource, /export const moduleItems = moduleGroups\.flatMap/);
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
  const rows = documentSource.split("\\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Grupo"));
  assert.equal(rows.length, expectedGroups.length);
});
