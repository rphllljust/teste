import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as aging} from '../../app/api/finance/aging/route';
import {GET as ledger} from '../../app/api/accounting/ledger/route';
import {GET as cashFlow} from '../../app/api/finance/cash-flow/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('NO-GO: isolated PostgreSQL is required for controller integration');
const target=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
   !['/cisne_ci','/cisne_test'].includes(target.pathname))
 throw Error('NO-GO: controller fixtures must never run against remote PostgreSQL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owners=[randomUUID(),randomUUID()];
const orders=[randomUUID(),randomUUID()],measurements=[randomUUID(),randomUUID()];
const invoices=[randomUUID(),randomUUID()],receivables=[randomUUID(),randomUUID()];
const payables=[randomUUID(),randomUUID()];
const asset=randomUUID(),revenue=randomUUID();
const journals=[randomUUID(),randomUUID()];
const lineIds=Array.from({length:4},()=>randomUUID());
const now=new Date().toISOString();
const r=(owner:string,path:string)=>setTestIdentity(new Request('http://localhost'+path),owner);
type Bucket={bucket:string;count:number;valueScaled:string};
type ControllerBody={
 receivables:{buckets:Bucket[]};payables:{buckets:Bucket[]};
 bankCoverage:{accountCount:number;reportedBalanceScaled:string|null;availableCashScaled:null};
 totals:{openingScaled:string;debitScaled:string;creditScaled:string;closingScaled:string;normalSide:string};
 pageInfo:{total:number};
 summary:{projectedIn:string;projectedOut:string;realizedIn:string};
 openingBankBalanceScaled:string|null;
};
const data=async(response:Response)=>response.json() as Promise<ControllerBody>;
before(async()=>{
 for(let i=0;i<2;i++){
  await pool.query('INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [orders[i],owners[i],'CI Controller order','CI Client','Services','Controller test',now]);
  await pool.query('INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',
   [measurements[i],orders[i],'CI approved measure',i?91000:125000,'approved',now]);
  await pool.query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
   [invoices[i],measurements[i],orders[i],i?91000:125000,i?'2026-08-01':'2026-11-01',now]);
  await pool.query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
   [receivables[i],invoices[i],i?91000:125000,i?'2026-08-01':'2026-11-01',now]);
  await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [payables[i],'CI supplier','CI SOURCE','Owner scoped obligation',i?91000:75000,i?'2026-11-15':'2026-09-15',now,owners[i],'test','controller']);
 }
 await pool.query("INSERT INTO chart_accounts(id,code,name,type,created_at,actor_id,request_hash) VALUES($1,$1,'Controller cash','asset',$3,$2,'test'),($4,$4,'Controller revenue','revenue',$3,$2,'test')",
  [asset,owners[0],now,revenue]);
 for(let i=0;i<2;i++){
  await pool.query("INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,'Controller posted','posted',2,$4,$5,'test','controller')",
   [journals[i],i?'2026-11-20':'2026-10-15',i?'CI POST NOV':'CI POST OCT',now,owners[0]]);
  await pool.query('INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,0),($5,$2,$6,0,$4)',
   [lineIds[i*2],journals[i],asset,i?50000:100000,lineIds[i*2+1],revenue]);
 }
});
after(async()=>{
 const target=new URL(process.env.DATABASE_URL!);
 if(!['localhost','127.0.0.1'].includes(target.hostname))throw Error('Refuse to clean remote DB');
 await pool.query('DELETE FROM journal_lines WHERE entry_id=ANY($1::text[])',[journals]);
 await pool.query('DELETE FROM journal_entries WHERE id=ANY($1::text[])',[journals]);
 await pool.query('DELETE FROM chart_accounts WHERE id=ANY($1::text[])',[[asset,revenue]]);
 await pool.query('DELETE FROM payables WHERE id=ANY($1::text[])',[payables]);
 await pool.query('DELETE FROM receivables WHERE id=ANY($1::text[])',[receivables]);
 await pool.query('DELETE FROM invoices WHERE id=ANY($1::text[])',[invoices]);
 await pool.query('DELETE FROM measurements WHERE id=ANY($1::text[])',[measurements]);
 await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[orders]);
 await closeDatabase();await pool.end();
});
test('portfolio is protected, owner isolated and uses actual unpaid amounts',async()=>{
 assert.equal((await aging(new Request('http://localhost/api/finance/aging'))).status,401);
 assert.equal((await aging(new Request('http://localhost/api/finance/aging',{headers:{'oai-authenticated-user-id':owners[0]}}))).status,401);
 assert.equal((await aging(r(owners[0],'/api/finance/aging?asOf=2026-11-31'))).status,400);
 const result=await aging(r(owners[0],'/api/finance/aging?asOf=2026-11-26'));
 assert.equal(result.status,200,JSON.stringify(await data(result.clone())));
 const owner=await data(result);
 assert.equal(owner.receivables.buckets.find((b)=>b.bucket==='overdue_1_30').valueScaled,'125000');
 assert.equal(owner.payables.buckets.find((b)=>b.bucket==='overdue_61_90').valueScaled,'75000');
 assert.equal(owner.bankCoverage.accountCount,0);
 assert.equal(owner.bankCoverage.reportedBalanceScaled,null);
 assert.equal(owner.bankCoverage.availableCashScaled,null);
 const foreign=await data(await aging(r(owners[1],'/api/finance/aging?asOf=2026-11-26')));
 assert.equal(foreign.receivables.buckets.find((b)=>b.bucket==='overdue_91_plus').valueScaled,'91000');
 assert.equal(foreign.receivables.buckets.find((b)=>b.bucket==='overdue_1_30').count,0);
});
test('ledger computes true opening and period movement for debit and credit-normal accounts',async()=>{
 for(const [id,type] of [[asset,'asset'],[revenue,'revenue']] as const){
  const result=await ledger(r(owners[0],'/api/accounting/ledger?accountId='+id+'&from=2026-11-01&to=2026-11-30'));
  assert.equal(result.status,200,JSON.stringify(await data(result.clone())));
  const body=await data(result);
  assert.equal(body.totals.openingScaled,'100000');
  assert.equal(body.totals.closingScaled,'150000');
  assert.equal(body.totals.debitScaled,type==='asset'?'50000':'0');
  assert.equal(body.totals.creditScaled,type==='asset'?'0':'50000');
  assert.equal(body.totals.normalSide,type==='asset'?'debit':'credit');
  assert.equal(body.pageInfo.total,1);
 }
 const invisible=await data(await ledger(r(owners[1],'/api/accounting/ledger?accountId='+asset)));
 assert.equal(invisible.pageInfo.total,0);
 const invalid=await ledger(r(owners[0],'/api/accounting/ledger?accountId='+asset+'&from=2026-12-30&to=2026-11-01'));
 assert.equal(invalid.status,400);
});
test('cash-flow uses current owner balance, does not invent a bank amount and returns scaled strings',async()=>{
 const response=await cashFlow(r(owners[0],'/api/finance/cash-flow?asOf=2026-11-01&from=2026-11-01&to=2026-11-30'));
 assert.equal(response.status,200,JSON.stringify(await data(response.clone())));
 const body=await data(response);
 assert.equal(body.summary.projectedIn,'125000');
 assert.equal(body.summary.projectedOut,'0');
 assert.equal(body.summary.realizedIn,'0');
 assert.equal(body.openingBankBalanceScaled,null);
 const foreign=await data(await cashFlow(r(owners[1],'/api/finance/cash-flow?from=2026-11-01&to=2026-11-30')));
 assert.equal(foreign.summary.projectedIn,'0');
});
