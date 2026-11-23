import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('deployment policy excludes Vercel and identifies Railway staging',async()=>{
  const packageJson=await readFile(new URL('../package.json',import.meta.url),'utf8');
  const workflow=await readFile(new URL('../.github/workflows/build-and-deploy.yml',import.meta.url),'utf8');
  assert.doesNotMatch(packageJson,/vercel/i);
  assert.doesNotMatch(workflow,/vercel/i);
  assert.match(workflow,/Railway project genuine-renewal/);
  assert.match(workflow,/environment staging/);
});
