import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('new maturity analytics are part of financial workspace and linked to authenticated title filters',()=>{
 const cockpit=read('app/FinanceOverviewWorkspace.tsx');
 const board=read('app/FinancialAgingBoard.tsx');
 const css=read('app/components/enterprise/enterprise-finance-tier1.css');
 assert.ok(cockpit.includes('<FinancialAgingBoard'));
 for(const marker of ['/api/finance/aging','credentials:','cache:','receivables','payables',
 'overdue_1_30','overdue_31_60','overdue_61_90','overdue_91_plus','onDrilldown({',
 'settlementState:',"state:'outstanding'",'data.bankCoverage.pendingLines','reportedBalanceScaled'])
 assert.ok(board.includes(marker),marker);
 for(const selector of ['.finance-tier1-aging-columns','.finance-tier1-aging-bank','.finance-tier1-aging-bars',
 '@media(max-width:1150px)','@media(max-width:750px)'])
 assert.ok(css.includes(selector),selector);
 assert.ok(!board.includes('Math.random'));
});
