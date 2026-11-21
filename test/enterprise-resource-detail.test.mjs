import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('payables, professionals and treasury render official Fluent grids', async () => {
 for(const workspaceName of ['PayablesWorkspace','ProfessionalsWorkspace','TreasuryWorkspace']){
  const source=await readFile(new URL('../app/'+workspaceName+'.tsx',import.meta.url),'utf8');
  assert.match(source, /<EnterpriseDataGrid</);
  assert.doesNotMatch(source, /<table\b/);
 }
});

test('professional Object Page has real accessible tabs and permission-bounded actions',async()=>{
 const source=await readFile(new URL('../app/ProfessionalsWorkspace.tsx',import.meta.url),'utf8');
 assert.match(source, /FluentTabList/);
 assert.match(source, /role="tabpanel"/);
 assert.match(source, /detailTab==='summary'/);
 assert.match(source, /data\.value==='history'\?'history':'summary'/);
 assert.match(source, /context\.availableCommands\[0\]&&<EnterpriseButton/);
 assert.match(source, /if\(!c\)return;setSaving\(true\)/);
 assert.doesNotMatch(source, />Alocações<\/EnterpriseButton>/);
});
