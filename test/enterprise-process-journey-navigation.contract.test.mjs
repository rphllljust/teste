import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
test('all seven process journey stages have a valid navigation target', () => {
  const handler = source.split('onStageSelect={(index) => {')[1]?.split('if (index === 0 || index === 1)')[0];
  assert.ok(handler, 'process journey stage selection exists');
  const targets = [...handler.matchAll(/^\s+"([^"]+)",?$/gm)].map(match => match[1]);
  assert.deepEqual(targets, ['Ordens de serviço','Execução','Medições','Faturamento','Financeiro','Fiscal e tributos','Contabilidade']);
  assert.match(handler, /if \(!destination\) return/);
  assert.match(handler, /navigate\(destination\)/);
});
