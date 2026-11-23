import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const component = await readFile(new URL('../app/components/enterprise/EnterpriseFoundation.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../app/components/enterprise/enterprise-foundation.css', import.meta.url), 'utf8');

test('enterprise navigation keeps disabled items out of keyboard activation', () => {
  assert.match(component, /aria-disabled=\{item\.disabled \|\| undefined\}/);
  assert.match(component, /tabIndex=\{item\.disabled \? -1 : undefined\}/);
  assert.match(component, /if \(item\.disabled\) event\.preventDefault\(\)/);
});

test('enterprise icons are hidden from assistive technology when labels are present', () => {
  assert.match(component, /item\.icon && <span aria-hidden="true">\{item\.icon\}<\/span>/);
});

test('enterprise grids and section navigation support constrained horizontal layouts', () => {
  assert.match(css, /\.enterprise-foundation-grid\s*\{[^}]*max-width: 100%/s);
  assert.match(css, /\.enterprise-foundation-grid\s*\{[^}]*overscroll-behavior-inline: contain/s);
  assert.match(css, /\.enterprise-foundation-grid th\s*\{[^}]*position: sticky/s);
  assert.match(css, /\.enterprise-section-navigation\s*\{[^}]*overscroll-behavior-inline: contain/s);
});

test('enterprise foundation honors reduced-motion preferences', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /scroll-behavior: auto !important/);
});
