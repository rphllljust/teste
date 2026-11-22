import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
test('enterprise modules expose contextual descriptions', () => {
  const section = source.split('const moduleDescription: Record<string, string> = {')[1]?.split('\n  };')[0];
  assert.ok(section, 'module description map exists');
  for (const module of ['Ordens de serviço','Execução','Contratos','Tesouraria','Contas a pagar','Razão contábil','Fechamentos']) {
    assert.ok(section.includes(module), module + ' is described');
  }
});
