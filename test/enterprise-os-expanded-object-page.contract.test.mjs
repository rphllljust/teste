import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('service orders have an expanded native Object Page and reversible inspector view',()=>{
 const page=read('app/page.tsx');
 assert.match(page,/\[osDetailExpanded,setOsDetailExpanded\]=useState\(true\)/);
 assert.ok(page.includes('context-docked '));
 assert.ok(page.includes('os-detail-expanded'));
 assert.ok(page.includes('className="drawer os-tier1-object-page"'));
 assert.ok(page.includes('aria-modal={!docked||osDetailExpanded}'));
 assert.ok(page.includes('onClick={()=>setOsDetailExpanded(v=>!v)}'));
 assert.ok(page.includes('aria-pressed={osDetailExpanded}'));
 assert.ok(page.includes('Plano, execução e custos'));
 assert.ok(page.includes('EnterpriseServiceOrderControlPanel'));
 assert.ok(page.includes('EnterpriseObjectSectionNavigation'));
});
test('Object Page is responsive and scoped; no global drawer or finance corruption',()=>{
 const style=read('app/components/enterprise/enterprise-os-object-page-tier1.css');
 const layout=read('app/layout.tsx');
 for(const token of ['context-overlay.context-docked.os-detail-expanded',
  '.app[data-navigation="collapsed"]',
  '.order-control-native-object',
  '@media(min-width:801px) and (max-width:1439px)',
  '@media(max-width:800px)',
  '@media(forced-colors:active)',
  '@media(prefers-reduced-motion:reduce)']){
   assert.ok(style.includes(token),'Missing scoped Object Page feature: '+token);
 }
 assert.ok(layout.includes('enterprise-os-object-page-tier1.css'));
 assert.doesNotMatch(style,/(?:^|\n)\.drawer\s*\{/);
 assert.doesNotMatch(style,/\.finance-workspace/);
});
