import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../lib/navigation/catalog.ts', import.meta.url), 'utf8');

test('command palette searches the authoritative typed module catalog with accents ignored', () => {
  assert.match(shell, /moduleGroups\.map/);
  assert.match(shell, /function normalizeEnterpriseSearch\(value: string\)/);
  assert.match(shell, /\.normalize\("NFD"\)/);
  assert.match(shell, /paletteModuleResults = modules\.flatMap/);
  assert.match(shell, /normalizeEnterpriseSearch\(name\)\.includes\(normalizeEnterpriseSearch\(paletteQuery\)\)/);
  assert.match(catalog, /export const moduleGroups:/);
});

test('command palette provides actual keyboard navigation without changing domain commands', () => {
  assert.match(shell, /function handlePaletteKey\(event: React\.KeyboardEvent<HTMLElement>\)/);
  assert.match(shell, /onKeyDown=\{handlePaletteKey\}/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) assert.ok(shell.includes('"' + key + '"'));
  assert.match(shell, /options\[next\]\?\.focus\(\)/);
  assert.match(shell, /options\[0\]\.click\(\)/);
  assert.match(shell, /isSearch && \(event\.key === "Home" \|\| event\.key === "End"\)/);
  assert.match(shell, /data-palette-option="true"/);
  assert.match(shell, /aria-describedby="cisne-palette-help"/);
});

test('search remains tenant-authorized on existing orders API and routes only through navigate', () => {
  assert.match(shell, /"\/api\/orders\?" \+/);
  assert.match(shell, /signal: controller\.signal/);
  assert.match(shell, /onClick=\{\(\) => navigate\(name\)\}/);
  assert.match(shell, /Nenhum módulo corresponde à busca/);
  assert.doesNotMatch(shell, /window\.location\.href\s*=\s*["']\/api/);
});
