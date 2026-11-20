import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const areas = [
 'AccountingWorkspace', 'AssetsWorkspace', 'BankReconciliationWorkspace',
 'CashFlowWorkspace', 'CloseCenterWorkspace', 'ExecutionWorkspace',
 'FiscalWorkspace', 'LedgerWorkspace',
];

test('operations, resources and finance use official Fluent DataGrid rows with business keys', async () => {
 for (const workspaceName of areas) {
  const source = await readFile(new URL('../app/'+workspaceName+'.tsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ EnterpriseDataGrid \} from/);
  assert.match(source, /<EnterpriseDataGrid</);
  assert.match(source, /getRowKey=\{\(item\)=>item\.(?:id|date)\}/);
  assert.doesNotMatch(source, /<table\b/);
  assert.match(source, /caption="/);
 }
});

test('finance/fiscal grids preserve exact monetary helpers and authorized contextual actions', async () => {
 const fiscal = await readFile(new URL('../app/FiscalWorkspace.tsx', import.meta.url), 'utf8');
 const ledger = await readFile(new URL('../app/LedgerWorkspace.tsx', import.meta.url), 'utf8');
 const bank = await readFile(new URL('../app/BankReconciliationWorkspace.tsx', import.meta.url), 'utf8');
 const execution = await readFile(new URL('../app/ExecutionWorkspace.tsx', import.meta.url), 'utf8');
 assert.match(fiscal, /money\(item\.grossAmountScaled\)/);
 assert.match(fiscal, /onClick=\{\(\)=>openDetail\(item\)\}/);
 assert.match(ledger, /moneyScaled\(item\.debitScaled\)/);
 assert.match(ledger, /moneyScaled\(item\.creditScaled\)/);
 assert.match(bank, /signedMoney\(item\.amountScaled\)/);
 assert.match(bank, /onClick=\{\(\)=>setLineId\(item\.id\)\}/);
 assert.match(execution, /availableCommands\.some\(command=>command\.id==='void'\)/);
});
