#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const cssFiles = [
  "app/components/enterprise/enterprise-foundation.css",
  "app/components/enterprise/enterprise-tokens.css",
];
const pageFile = "app/page.tsx";
const widths = [390, 768, 1024, 1440];
const criticalRoutes = [
  "Visão operacional", "CRM e Vendas", "Clientes e propostas", "Contratos",
  "Compras", "Execução", "Faturamento", "Financeiro", "Contabilidade",
];

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

async function read(relative) {
  return readFile(resolve(root, relative), "utf8");
}

function report(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
}

async function staticContracts() {
  const css = await Promise.all(cssFiles.map(read));
  const foundation = css[0];
  const tokens = css[1];
  const page = await read(pageFile);

  const requiredCssContracts = [
    ["enterprise shell grid", /\.enterprise-app-shell\s*\{/],
    ["desktop shell columns", /grid-template:\s*56px\s+1fr\s*\/\s*248px\s+1fr/],
    ["tablet breakpoint", /@media\s*\(max-width:\s*1279px\)/],
    ["mobile breakpoint", /@media\s*\(max-width:\s*767px\)/],
    ["mobile drawer behavior", /\.enterprise-sidebar\s*\{\s*display:\s*none/],
    ["grid horizontal overflow", /\.enterprise-foundation-grid\s*\{[^}]*overflow-x:\s*auto/],
    ["sticky table header", /\.enterprise-foundation-grid th\s*\{[^}]*position:\s*sticky/],
    ["section navigation overflow", /\.enterprise-section-navigation\s*\{[^}]*overflow-x:\s*auto/],
    ["reduced motion", /prefers-reduced-motion/],
    ["focus-visible", /focus-visible/],
  ];
  for (const [label, pattern] of requiredCssContracts) {
    const ok = pattern.test(foundation);
    report(`CSS ${label}`, ok);
    check(ok, `CSS contract ausente: ${label}`);
  }

  for (const width of widths) {
    const ok = width === 390 ? /max-width:\s*767px/.test(foundation)
      : width === 768 || width === 1024 ? /max-width:\s*1279px/.test(foundation)
      : /grid-template:\s*56px\s+1fr\s*\/\s*248px\s+1fr/.test(foundation);
    report(`breakpoint ${width}px`, ok);
    check(ok, `breakpoint sem contrato: ${width}px`);
  }

  for (const label of criticalRoutes) {
    const ok = page.includes(label) && /encodeURIComponent\(name\)/.test(page);
    report(`rota crítica ${label}`, ok);
    check(ok, `rota crítica não encontrada no contrato: ${label}`);
  }

  for (const marker of ["enterprise-app-shell", "enterprise-page-layout", "enterprise-foundation-grid", "enterprise-foundation-filter-bar"]) {
    const ok = foundation.includes(marker);
    report(`shell/componente CSS ${marker}`, ok);
    check(ok, `contrato CSS empresarial ausente: ${marker}`);
  }
  check(tokens.includes("--cisne-color-canvas"), "tokens CISNE ausentes");
}

async function httpContracts() {
  const configured = process.env.STAGING_BASE_URL;
  if (!configured) {
    console.log("SKIP HTTP Staging: STAGING_BASE_URL não configurada");
    return;
  }
  const base = new URL(configured);
  const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
  for (const label of criticalRoutes) {
    const url = new URL(`${base.pathname.replace(/\/$/, "")}/#${encodeURIComponent(label)}`, base);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
      const ok = response.status >= 200 && response.status < 400;
      report(`HTTP ${label} (${response.status})`, ok);
      check(ok, `HTTP inválido em ${label}: ${response.status}`);
    } catch (error) {
      report(`HTTP ${label}`, false);
      check(false, `falha HTTP em ${label}: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

await staticContracts();
await httpContracts();
if (failures.length) {
  console.error(`\nREGRESSION FAIL: ${failures.length} falha(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nREGRESSION PASS: contratos estáticos e HTTP configurado aprovados.");
}
