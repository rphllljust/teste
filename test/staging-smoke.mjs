#!/usr/bin/env node

const baseUrl = process.env.STAGING_BASE_URL || "https://cisne-web-staging-staging.up.railway.app/";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

const requiredMarkers = [
  ["CISNE shell", /CISNE(?:<|\s)/i],
  ["module navigation", /Módulos empresariais|Módulos empresariais/i],
  ["Inicio e Operação", /Início e Operação/i],
  ["Comercial e Relacionamento", /Comercial e Relacionamento/i],
  ["Contratos e Suprimentos", /Contratos e Suprimentos/i],
  ["Recursos e Logística", /Recursos e Logística/i],
  ["Financeiro e Controladoria", /Financeiro e Controladoria/i],
];

const forbiddenInitialErrors = [
  /Internal Server Error/i,
  /Application error/i,
  /Unhandled Runtime Error/i,
  /Cannot read propert(?:y|ies) of undefined/i,
  /This site can't be reached/i,
];

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`);
  process.exitCode = 1;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,application/xhtml+xml" },
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractTitle(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
}

async function main() {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    fail(`STAGING_BASE_URL inválida: ${baseUrl}`);
    return;
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    fail(`STAGING_BASE_URL deve usar HTTP ou HTTPS: ${baseUrl}`);
    return;
  }

  let response;
  try {
    response = await fetchWithTimeout(parsed);
  } catch (error) {
    fail(`não foi possível acessar ${parsed.href}: ${error.name === "AbortError" ? `timeout de ${timeoutMs}ms` : error.message}`);
    return;
  }

  const html = await response.text();
  const title = extractTitle(html);
  console.log(`Smoke target: ${parsed.href}`);
  console.log(`Final URL: ${response.url}`);
  console.log(`HTTP: ${response.status}`);
  console.log(`Title: ${title || "<ausente>"}`);

  if (response.status !== 200) fail(`status HTTP esperado 200, recebido ${response.status}`);
  if (!title || !/Cisne|CISNE/i.test(title)) fail("título CISNE ausente");

  for (const [label, marker] of requiredMarkers) {
    if (!marker.test(html)) fail(`marcador ausente: ${label}`);
    else console.log(`OK: ${label}`);
  }

  for (const errorPattern of forbiddenInitialErrors) {
    if (errorPattern.test(html)) fail(`erro inicial detectado: ${errorPattern}`);
  }

  if (process.exitCode) return;
  console.log("SMOKE PASS: Staging respondeu com shell empresarial e navegação inicial íntegros.");
}

main().catch((error) => fail(error.stack || error.message));
