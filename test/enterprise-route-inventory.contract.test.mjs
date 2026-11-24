import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [pageSource, documentSource] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../docs/enterprise-route-inventory.md", import.meta.url), "utf8"),
]);

// Navigation-contract coverage, not an end-to-end test of backend or business workflows.
const expectedGroups = [
  {
    name: "INÍCIO E OPERAÇÃO",
    doc: "Início e operação",
    entries: ["Visão operacional", "Field Service Cockpit", "Resource Planning Board", "Ordens de serviço", "Execução", "Medições"],
  },
  {
    name: "COMERCIAL E RELACIONAMENTO",
    doc: "Comercial e relacionamento",
    entries: ["CRM e Vendas", "Clientes e propostas", "Propostas e PO"],
  },
  {
    name: "CONTRATOS E SUPRIMENTOS",
    doc: "Contratos e suprimentos",
    entries: ["Contratos", "Compras", "Estoque e compras"],
  },
  {
    name: "RECURSOS E LOGÍSTICA",
    doc: "Recursos e logística",
    entries: ["Frota e ativos", "Profissionais"],
  },
  {
    name: "FINANCEIRO E CONTROLADORIA",
    doc: "Financeiro e controladoria",
    entries: ["Faturamento", "Visão financeira", "Financeiro", "Fluxo de caixa", "Tesouraria", "Contas a pagar", "Caixa e conciliação", "Fiscal e tributos", "Contabilidade", "Razão contábil", "Fechamentos"],
  },
];

const directTargets = new Map([
  ["Visão operacional", "EnterpriseCommandCenter"],
  ["Field Service Cockpit", "FieldServiceCockpit"],
  ["Resource Planning Board", "ResourcePlanningBoard"],
  ["Execução", "ExecutionWorkspace"],
  ["CRM e Vendas", "CRMWorkspace"],
  ["Clientes e propostas", "ClientsWorkspace"],
  ["Propostas e PO", "ProposalsWorkspace"],
  ["Contratos", "ContractsWorkspace"],
  ["Compras", "ProcurementWorkspace"],
  ["Estoque e compras", "section"],
  ["Visão financeira", "FinanceOverviewWorkspace"],
  ["Fluxo de caixa", "CashFlowWorkspace"],
  ["Tesouraria", "TreasuryWorkspace"],
  ["Contas a pagar", "PayablesWorkspace"],
  ["Caixa e conciliação", "BankReconciliationWorkspace"],
  ["Fiscal e tributos", "FiscalWorkspace"],
  ["Contabilidade", "AccountingWorkspace"],
  ["Razão contábil", "LedgerWorkspace"],
  ["Fechamentos", "CloseCenterWorkspace"],
]);

function shellGroups() {
  const start = pageSource.indexOf("const modules:");
  const end = pageSource.indexOf("const chain =", start);
  assert.ok(start >= 0 && end > start, "enterprise module registry missing");
  const section = pageSource.slice(start, end);
  const groups = [...section.matchAll(/\{\s*group:\s*"([^"]+)",\s*items:\s*\[([\s\S]*?)\],\s*\}/g)];
  return groups.map((match) => ({
    name: match[1],
    entries: [...match[2].matchAll(/^\s*\["([^"]+)",\s*[A-Z]\w*\],?\s*$/gm)].map((entry) => entry[1]),
  }));
}

test("all 25 enterprise entries are registered in the expected groups, without duplicates", () => {
  const groups = shellGroups();
  assert.deepEqual(groups, expectedGroups.map(({ name, entries }) => ({ name, entries })));
  const labels = groups.flatMap(({ entries }) => entries);
  assert.equal(labels.length, 25);
  assert.equal(new Set(labels).size, labels.length);
});

test("documentation is synchronized with the actual shell inventory", () => {
  const rows = documentSource.split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Grupo"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  assert.deepEqual(rows, expectedGroups.map(({ doc, entries }) => [doc, entries.join("; ")]));
});

test("menu entries navigate by URL hash and router only accepts registered labels", () => {
  assert.match(pageSource, /<nav aria-label="Módulos empresariais">[\s\S]*?\{modules\.map\(\(g\) => \([\s\S]*?\{g\.items\.map\(\(\[name, Icon\]\) => \([\s\S]*?onClick=\{\(\) => navigate\(name\)\}/);
  assert.match(pageSource, /setPage\(name\);\s*window\.history\.pushState\(null, "", "#" \+ encodeURIComponent\(name\)\)/);
  assert.match(pageSource, /modules\.some\(\(g\) => g\.items\.some\(\(\[n\]\) => n === name\)\)/);
});

test("direct menu entries dispatch to actual workspace components rather than fallback", () => {
  for (const [entry, component] of directTargets) {
    const pattern = new RegExp('page\\s*===\\s*"' + entry + '"\\s*\\?\\s*\\(\\s*<' + component + '\\b');
    assert.match(pageSource, pattern, entry + " should dispatch to " + component);
  }
});

test("work orders and linked finance entries use implemented worklists", () => {
  assert.match(pageSource, /const isWork\s*=\s*page === "Ordens de serviço" \|\| page === "Visão operacional";/);
  assert.match(pageSource, /\)\s*:\s*isWork\s*\?\s*\(\s*<>[\s\S]*?<ServiceOperationsAgenda\b/);
  assert.match(pageSource, /const linkedPage\s*=\s*\["Medições", "Faturamento", "Financeiro"\]\.includes\(page\);/);
  assert.match(pageSource, /\)\s*:\s*linkedPage\s*\?\s*\(\s*<section className="worklist"/);
});

test("resource entries dispatch to their workspaces and every menu label has a dispatch path", () => {
  assert.match(pageSource, /page === "Profissionais" \? \(\s*<ProfessionalsWorkspace\s*\/>/);
  assert.match(pageSource, /page === "Frota e ativos" \? \(\s*<AssetsWorkspace\s*\/>/);
  const dispatched = [...directTargets.keys(), "Ordens de serviço", "Medições", "Faturamento", "Financeiro", "Profissionais", "Frota e ativos"];
  assert.deepEqual(new Set(dispatched), new Set(expectedGroups.flatMap(({ entries }) => entries)));
});
