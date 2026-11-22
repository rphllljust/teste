import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
const source = await readFile(new URL('../app/components/enterprise/EnterprisePrimitives.tsx', import.meta.url), 'utf8');
test('enterprise header IDs are unique per instance and retain explicit overrides', () => {
  assert.match(source, /const generatedId = useId\(\)/);
  assert.match(source, /const titleId = id \?\?/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /<h1 id=\{titleId\}>/);
});
