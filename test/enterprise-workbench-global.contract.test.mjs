import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('app/page.tsx'),css=read('app/components/enterprise/enterprise-workbench.css');
const layout=read('app/layout.tsx');
test('enterprise shell removes duplicate always-visible navigation with a real collapsible global module menu',()=>{
 assert.match(shell,/data-navigation=\{navigationCollapsed \? "collapsed" : "expanded"\}/);
 assert.match(shell,/window\.localStorage\.setItem\("cisne:workbench-navigation"/);
 assert.match(shell,/aria-label=\{navigationCollapsed \? "Expandir navegação lateral"/);
 assert.match(shell,/aria-expanded=\{shortcutsOpen\}/);
 assert.match(shell,/aria-controls="cisne-workbench-shortcuts"/);
 assert.match(shell,/shortcutsOpen && <nav id="cisne-workbench-shortcuts"/);
 assert.match(shell,/setShortcutsOpen\(false\); navigate\(module\)/);
 assert.match(shell,/aria-current=\{page === name \? "page"/);
 assert.ok(layout.includes('enterprise-workbench.css'));
});
test('navigation is accessible on desktop and remains mobile-first with document density',()=>{
 assert.match(css,/data-navigation="collapsed"/);
 assert.match(css,/min-width:801px/);
 assert.match(css,/max-width:800px/);
 assert.match(css,/max-width:480px/);
 assert.match(css,/\.app \.main \.enterprise-breadcrumb \{ display:none/);
 assert.match(css,/\.app \.enterprise-quick-access/);
 assert.match(css,/\.app \.main main \{ width:auto;max-width:1920px/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/forced-colors:active/);
 assert.doesNotMatch(shell,/Math\.random\(\)/);
});
