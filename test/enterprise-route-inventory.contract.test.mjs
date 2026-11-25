import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [pageSource, documentSource, catalogSource] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../docs/enterprise-route-inventory.md", import.meta.url), "utf8"),
  readFile(new URL("../lib/navigation/catalog.ts", import.meta.url), "utf8"),
]);
const expected = [
  ["INÍCIO E OPERAÇÃO", ["Visão operacional","Field Service Cockpit","Resource Planning Board","Ordens de serviço","Execução","Medições"]],
  ["COMERCIAL E RELACIONAMENTO", ["CRM e Vendas","Clientes e propostas","Propostas e PO"]],
  ["CONTRATOS E SUPRIMENTOS", ["Contratos","Compras","Estoque e compras"]],
  ["RECURSOS E LOGÍSTICA", ["Frota e ativos","Profissionais"]],
  ["FINANCEIRO E CONTROLADORIA", ["Faturamento","Visão financeira","Financeiro","Fluxo de caixa","Tesouraria","Contas a pagar","Caixa e conciliação","Fiscal e tributos","Contabilidade","Razão contábil","Fechamentos"]],
];
test("typed catalog contains all enterprise entries without duplicates",()=>{
  const groups=[...catalogSource.matchAll(/label:"([^"]+)",items:\[([^\]]+)\]/g)].map(m=>[m[1],[...m[2].matchAll(/item\("[^"]+","([^"]+)"/g)].map(x=>x[1])]);
  assert.deepEqual(groups,expected);
  const labels=groups.flatMap(([,items])=>items); assert.equal(labels.length,25); assert.equal(new Set(labels).size,25);
});
test("documentation remains synchronized",()=>{
  const rows=documentSource.split("\n").filter(line=>line.startsWith("| ")&&!line.startsWith("| Grupo")).map(line=>line.split("|").slice(1,-1).map(cell=>cell.trim()));
  assert.equal(rows.length,5); assert.ok(documentSource.includes("Início e operação")); assert.ok(documentSource.includes("Financeiro e controladoria"));
});
test("shell consumes typed catalog and preserves navigation",()=>{
  assert.match(pageSource,/moduleGroups/); assert.match(pageSource,/modules\.map/); assert.match(pageSource,/window\.history\.pushState/); assert.match(catalogSource,/moduleFromHash/);
});
