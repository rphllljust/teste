import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

const entries = [
  "Visão operacional", "Field Service Cockpit", "Resource Planning Board",
  "Ordens de serviço", "Execução", "Medições", "CRM e Vendas",
  "Clientes e propostas", "Propostas e PO", "Contratos", "Compras",
  "Estoque e compras", "Frota e ativos", "Profissionais", "Faturamento",
  "Visão financeira", "Financeiro", "Fluxo de caixa", "Tesouraria",
  "Contas a pagar", "Caixa e conciliação", "Fiscal e tributos",
  "Contabilidade", "Razão contábil", "Fechamentos",
];

test("enterprise route inventory remains represented by the current shell", () => {
  for (const entry of entries) assert.ok(pageSource.includes(`["${entry}"`), `missing shell entry: ${entry}`);
});

test("enterprise route inventory is dispatched by the existing page", () => {
  for (const entry of entries) assert.ok(pageSource.includes(`page === "${entry}"`), `entry is not dispatched: ${entry}`);
});

test("enterprise route inventory has unique labels", () => {
  const labels = entries;
  assert.equal(new Set(labels).size, labels.length);
});
