import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

test('shared enterprise headers keep actions usable on narrow viewports', () => {
  assert.match(css, /\.enterprise-page-header,\.business-object-header/);
  assert.match(css, /\.enterprise-page-actions,\.business-object-actions\{display:flex;flex-wrap:wrap/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /min-height:40px/);
});
