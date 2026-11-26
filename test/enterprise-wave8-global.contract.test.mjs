import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Wave 8 single-header contract prevents two module titles while preserving action toolbar',()=>{
 for(const path of ['CRMWorkspace','ClientsWorkspace','ContractsWorkspace','ProposalsWorkspace']){
  const src=read('app/'+path+'.tsx');
  assert.ok(src.includes('return <'+path+' {...props}/>;'),'one module instance, '+path);
  assert.doesNotMatch(src,/return <><EnterprisePageHeader/,'duplicate header must not remain: '+path);
  assert.match(src,/<h2>/,'actual module heading remains');
 }
 const css=read('app/components/enterprise/enterprise-workbench.css');
 assert.match(css,/Wave 8: one effective document header/);
 assert.match(css,/\.cisne-crm > \.cisne-crm-heading/);
});

test('Wave 8 commercial proposals and purchase orders are the same authorized list report',()=>{
 const src=read('app/ProposalsWorkspace.tsx');
 assert.match(src,/<EnterpriseSmartGrid<Commercial>/);
 assert.match(src,/enterprise-commercial-proposals/);
 assert.match(src,/enterprise-commercial-purchase-orders/);
 assert.match(src,/onOpen=\{r=>void open\(r\.id\)\}/);
 assert.match(src,/rows=\{list\.items\}/);
 assert.match(src,/getRowKey=\{r=>r\.id\}/);
 assert.match(src,/\/api\/'\+kind/);
 assert.match(src,/pageSize:'25'/);
 assert.match(src,/record\.availableCommands\.map/);
 assert.doesNotMatch(src,/mockData|faker|Math\.random\(/i);
});

test('Wave 8 execution workbench starts with authorized server orders, not a blank placeholder',()=>{
 const src=read('app/ExecutionWorkspace.tsx');
 assert.match(src,/\/api\/orders\?/);
 assert.match(src,/orders\.orders\.map\(o=><div/);
 assert.match(src,/onClick=\{\(\)=>choose\(o\.id\)\}/);
 assert.match(src,/onClick=\{\(\)=>onOrder\(o\.id\)\}/);
 assert.match(src,/data\.availableCommands\.some\(c=>c\.id==='report'\)/);
 assert.match(src,/EnterpriseObjectSummary type="Execução da OS"/);
 assert.match(src,/EnterpriseObjectSectionNavigation rootSelector="\.worklist"/);
 assert.doesNotMatch(src,/<a href="#execution-records">/);
 const css=read('app/components/enterprise/enterprise-execution-workbench.css');
 const layout=read('app/layout.tsx');
 assert.match(layout,/enterprise-execution-workbench\.css/);
 assert.match(css,/max-width:700px/);
});
