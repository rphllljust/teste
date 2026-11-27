import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('OS creation maintains one accessible wizard navigation without duplicate global anchors',()=>{
 const s=read('app/OrderPreparation.tsx');
 assert.ok(s.includes('className="preparation-progress"'));
 assert.ok(s.includes("aria-current={step===s?'step':undefined}"));
 assert.ok(!s.includes('className="object-anchors"'));
 assert.ok(s.includes("if(step!=='review')"));
 assert.ok(s.includes('className="preparation-readiness"'));
 assert.ok(s.includes("ready:!!selectedClient?.id"));
 assert.ok(s.includes('ready:validOperation()'));
 assert.ok(s.includes('ready:!!command&&!!definition'));
 assert.ok(s.includes("check.optional?'Opcional':'Pendente'"));
 assert.equal((s.match(/type="submit"/g)??[]).length,1,'Single explicit creation command in review');
});
test('wizard still uses real client and contract records and fail-closed server authorization',()=>{
 const s=read('app/OrderPreparation.tsx');
 assert.ok(s.includes("status:'active',page:String(clientPage)"));
 assert.ok(s.includes("status:'active',q:contractSearch"));
 assert.ok(s.includes('expectedClientVersion'));
 assert.ok(s.includes('expectedContractVersion'));
 assert.ok(s.includes('key.current??=crypto.randomUUID()'));
 assert.ok(s.includes('verifyResult()'));
 assert.ok(!s.includes('faker.'));
});
test('responsive wizard limits client result height without dropping pagination and context',()=>{
 const css=read('app/components/enterprise/enterprise-os-wizard-tier1.css');
 const layout=read('app/layout.tsx');
 assert.ok(css.includes('.preparation-candidates{max-height:255px;overflow-y:auto'));
 assert.ok(css.includes('.preparation-business-context{position:sticky'));
 assert.ok(css.includes('@media(max-width:850px)'));
 assert.ok(css.includes('@media(forced-colors:active)'));
 assert.ok(layout.includes('enterprise-os-wizard-tier1.css'));
});
