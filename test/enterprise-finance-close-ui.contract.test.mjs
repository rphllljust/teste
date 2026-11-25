import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [ui,preflight,close]=await Promise.all([
  readFile(new URL('../app/CloseCenterWorkspace.tsx',import.meta.url),'utf8'),
  readFile(new URL('../app/api/finance/periods/preflight/route.ts',import.meta.url),'utf8'),
  readFile(new URL('../app/api/finance/periods/close/route.ts',import.meta.url),'utf8'),
]);
test('finance close requires authenticated preflight, live revalidation and explicit UI approval',()=>{
  assert.match(ui,/\/api\/finance\/periods\/preflight/);
  assert.match(ui,/preflight\.periodStart!==form\.get\('periodStart'\)/);
  assert.match(ui,/preflight\.periodEnd!==form\.get\('periodEnd'\)/);
  assert.match(ui,/!preflight\?\.canClose/);
  assert.match(ui,/Verificar conciliação/);
  assert.match(preflight,/requestContext\(request\)/);
  assert.match(preflight,/advisoryOnly:true/);
  assert.match(close,/assertPeriodReadyToClose/);
  assert.match(close,/lockFinancePeriodScope/);
});
