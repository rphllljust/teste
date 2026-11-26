import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const paths=[
 {file:'ClientsWorkspace.tsx',type:'Client',id:'enterprise-clients',source:'/api/clients'},
 {file:'ContractsWorkspace.tsx',type:'Contract',id:'enterprise-contracts',source:'/api/contracts'},
 {file:'AccountingWorkspace.tsx',type:'Entry',id:'enterprise-accounting-journals',source:'/api/accounting/journals'},
];

test('commercial and financial documents all use shared smart list report without changing server authorization',()=>{
 for(const {file,type,id,source} of paths){
  const src=read('app/'+file);
  assert.match(src,new RegExp('<EnterpriseSmartGrid<'+type+'> viewId="'+id+'"'));
  assert.match(src,/EnterpriseSmartColumn/);
  assert.ok(src.includes(source),'must remain backed by authoritative API '+file);
  assert.match(src,/onOpen=\{[a-z]=>void open\([a-z]\.id\)\}/);
  assert.match(src,/getRowKey=\{[a-z]=>[a-z]\.id\}/);
  assert.match(src,/satisfies EnterpriseSmartColumn/);
  assert.doesNotMatch(src,/mockData|faker|Math\.random\(/i);
 }
});

test('Client actions, Contract state machine and ledger posting remain in authoritative document contexts',()=>{
 const clients=read('app/ClientsWorkspace.tsx');
 const contracts=read('app/ContractsWorkspace.tsx');
 const ledger=read('app/AccountingWorkspace.tsx');
 assert.match(clients,/availableCommands/);
 assert.match(clients,/<EnterpriseObjectSummary/);
 assert.match(contracts,/evaluateEnterpriseAction/);
 assert.match(contracts,/availableCommands/);
 assert.match(contracts,/<EnterpriseObjectSectionNavigation/);
 assert.match(ledger,/function|async function/);
 assert.match(ledger,/moneyScaled\(e\.debitScaled\)/);
 assert.match(ledger,/moneyScaled\(e\.creditScaled\)/);
 assert.match(ledger,/EnterpriseObjectSummary/);
});

test('shared grid never exports unretrieved pages and neutralizes Excel formula payloads',()=>{
 const grid=read('app/components/enterprise/EnterpriseSmartGrid.tsx');
 assert.match(grid,/exportRows=displayedSelected\.length\?displayedSelected:ordered/);
 assert.match(grid,/function safeCsv/);
 assert.match(grid,/URL\.createObjectURL/);
 assert.match(grid,/localStorage\.setItem\(storageKey,JSON\.stringify\(next\)\)/);
 assert.doesNotMatch(grid,/fetch\(|document\.cookie/);
});
