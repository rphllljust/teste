import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const css=await readFile(new URL('../app/accessibility-floorplans.css',import.meta.url),'utf8');
test('enterprise floorplans preserve keyboard and user motion preferences',()=>{assert.match(css,/focus-visible/);assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/forced-colors:active/);assert.match(css,/\.sr-only/);});
