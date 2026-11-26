import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url),'utf8');
const css = readFileSync(new URL('../app/components/enterprise/enterprise-experience.css', import.meta.url),'utf8');

test('enterprise experience is imported after legacy styles on every application route', () => {
  const imports = ['globals.css','enterprise-tokens.css','enterprise-foundation.css','enterprise-experience.css'];
  let prior = -1;
  for (const name of imports) {
    const index = layout.indexOf(name);
    assert.ok(index > prior, name + ' must be imported after existing layers');
    prior = index;
  }
});
test('workspace design maintains a single palette and responsive object layout', () => {
  for (const token of ['--cisne-color-primary','--cisne-color-navigation','--cisne-color-canvas','--cisne-color-text','--cisne-table-row-height'])
    assert.ok(css.includes(token), token + ' must have a normalized enterprise value');
  for (const marker of ['.app .sidebar','.app .topbar','.app .main main','.app .table-wrap','.app .enterprise-object-summary','.app .enterprise-quick-access'])
    assert.ok(css.includes(marker), marker + ' must participate in the global visual contract');
  for (const width of ['1200px','800px','460px']) assert.ok(css.includes('max-width: ' + width));
});
test('density is opt-in and accessible to users choosing comfortable or compact layouts', () => {
  assert.match(css, /\[data-density="compact"\]/);
  assert.match(css, /\[data-density="comfortable"\]/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
test('CSS has balanced braces without unfinished selectors', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g,'');
  const depth = [...withoutComments].reduce((count, char) => {
    const next = count + (char === '{' ? 1 : char === '}' ? -1 : 0);
    assert.ok(next >= 0, 'unexpected closing brace in design system');
    return next;
  }, 0);
  assert.equal(depth, 0);
});


test('object detail workspaces have wide desktop layout, sticky context and mobile full-screen fallbacks', () => {
  assert.match(css, /\.drawer\.enterprise-object-detail/);
  assert.match(css, /width: min\(940px/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /> \.object-anchors/);
  assert.match(css, /aria-current="location"/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /grid-template-columns: 1fr/);
  assert.match(css, /grid-template-columns: repeat\(8,/);
});
