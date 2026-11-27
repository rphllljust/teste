import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('manual bank statements parse scaled amounts exactly and enforce PostgreSQL integer capacity', () => {
  const source = read('app/api/bank/statements/route.ts');
  assert.match(source, /BigInt\(whole\)\s*\*\s*10000n/);
  assert.match(source, /postgresIntegerMin\s*=\s*-2147483648n/);
  assert.match(source, /postgresIntegerMax\s*=\s*2147483647n/);
  assert.match(source, /BigInt\(data\.openingBalance\)\s*\+\s*movementTotal\s*!==\s*BigInt\(data\.closingBalance\)/);
  assert.doesNotMatch(source, /Number\(whole\)\s*\*\s*10000/);
});

test('manual bank reconciliation uses an exact nonzero signed amount and exact absolute comparison', () => {
  const source = read('app/api/bank/commands/route.ts');
  assert.match(source, /const lineAmount\s*=\s*BigInt\(String\(line\.rows\[0\]\.amount\)\)/);
  assert.match(source, /lineAmount\s*===\s*0n/);
  assert.match(source, /lineAmount\s*>\s*0n\s*\?\s*'receipt'\s*:\s*'payment'/);
  assert.match(source, /absoluteLineAmount\s*!==\s*BigInt\(String\(target\.rows\[0\]\.amount\)\)/);
  assert.doesNotMatch(source, /Number\(line\.rows\[0\]\.amount\)/);
});
