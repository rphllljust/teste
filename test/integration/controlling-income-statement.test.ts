import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET} from '../../app/api/controlling/income-statement/route';
const url=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!url)throw Error('Isolated PostgreSQL required');
const target=new URL(url);
if(!['localhost','127.0.0.1'].includes(target.hostname)||!['/cisne_ci','/cisne_test'].includes(target.pathname))
 throw Error('NO-GO: financial fixtures must use disposable localhost database');
const pool=new Pool({connectionString:url,max:2});
const owner=randomUUID(),foreign=randomUUID(),n=new Date().toISOString();
const accounts={cash:randomUUID(),revenue:randomUUID(),expense:randomUUID(),foreignRevenue:randomUUID(),foreignCash:randomUUID()};
const allAccounts=Object.values(accounts);
const journals=Array.from({length:6},()=>randomUUID()),lines=Array.from({length:12},()=>randomUUID());
const request=(actor:string,month:string)=>setTestIdentity(new Request('http://localhost/api/controlling/income-statement?periodMonth='+month),actor);
type Report={totals:{revenueScaled:string;expenseScaled:string;netScaled:string;priorRevenueScaled:string;priorNetScaled:string;currentLineCount:number};accounts:Array<{type:string;id:string}>;emptyState:string|null};
before(async()=>{
 for(const [type,id,ownerId] of [['asset',accounts.cash,owner],['revenue',accounts.revenue,owner],
   ['expense',accounts.expense,owner],['revenue',accounts.foreignRevenue,foreign],['asset',accounts.foreignCash,foreign]]){
  await pool.query('INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,$3,$4,1,$5,$6,$7)',
   [id,'CI-'+id.slice(0,8),'CI P&L '+type,type,n,ownerId,'fixture']);
 }
 const rows=[
  {date:'2026-10-15',debit:accounts.cash,credit:accounts.revenue,amount:100000,ownerId:owner,status:'posted',reverse:null},
  {date:'2026-11-15',debit:accounts.cash,credit:accounts.revenue,amount:300000,ownerId:owner,status:'posted',reverse:null},
  {date:'2026-11-16',debit:accounts.expense,credit:accounts.cash,amount:90000,ownerId:owner,status:'posted',reverse:null},
  {date:'2026-11-17',debit:accounts.revenue,credit:accounts.cash,amount:50000,ownerId:owner,status:'posted',reverse:journals[1]},
  {date:'2026-11-20',debit:accounts.cash,credit:accounts.revenue,amount:70000,ownerId:owner,status:'draft',reverse:null},
  {date:'2026-11-21',debit:accounts.foreignCash,credit:accounts.foreignRevenue,amount:999000,ownerId:foreign,status:'posted',reverse:null},
 ];
 for(let i=0;i<rows.length;i++){
  const r=rows[i];
  await pool.query('INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id,reversal_of) VALUES($1,$2,$3,$4,$5,2,$6,$7,$8,$9,$10)',
   [journals[i],r.date,'CI-PNL-'+i,'Fixture P&L',r.status,n,r.ownerId,'fixture','ci',r.reverse]);
  await pool.query('INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,0),($5,$2,$6,0,$4)',
   [lines[i*2],journals[i],r.debit,r.amount,lines[i*2+1],r.credit]);
 }
});
after(async()=>{
 try{
  await pool.query('DELETE FROM journal_lines WHERE entry_id=ANY($1::text[])',[journals]);
  await pool.query('DELETE FROM journal_entries WHERE id=ANY($1::text[])',[journals]);
  await pool.query('DELETE FROM chart_accounts WHERE id=ANY($1::text[])',[allAccounts]);
 }finally{await closeDatabase();await pool.end();}
});
test('managerial statement is based solely on posted journals with reversal and owner isolation',async()=>{
 const res=await GET(request(owner,'2026-11'));
 assert.equal(res.status,200);
 const r=await res.json() as Report;
 assert.equal(r.totals.revenueScaled,'250000');
 assert.equal(r.totals.expenseScaled,'90000');
 assert.equal(r.totals.netScaled,'160000');
 assert.equal(r.totals.priorRevenueScaled,'100000');
 assert.equal(r.totals.priorNetScaled,'100000');
 assert.equal(r.totals.currentLineCount,6);
 assert.equal(r.accounts.length,2);
 assert.ok(r.accounts.every(a=>a.id!==accounts.foreignRevenue));
 const other=await (await GET(request(foreign,'2026-11'))).json() as Report;
 assert.equal(other.totals.revenueScaled,'999000');
 assert.equal(other.accounts.length,1);
});
test('unknown owner and invalid period fail without exposing other companies',async()=>{
 assert.equal((await GET(request(owner,'2026-13'))).status,400);
 assert.equal((await GET(request(owner,'garbage'))).status,400);
 const empty=await (await GET(request(randomUUID(),'2026-11'))).json() as Report;
 assert.equal(empty.emptyState,'no_classified_accounts');
 assert.equal(empty.accounts.length,0);
});
