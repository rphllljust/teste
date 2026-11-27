import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET} from '../../app/api/enterprise/exceptions/route';
const conn=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!conn)throw Error('NO-GO: disposable PostgreSQL required');
const uri=new URL(conn);
if(!['localhost','127.0.0.1'].includes(uri.hostname)||!['/cisne_ci','/cisne_test'].includes(uri.pathname))
 throw Error('NO-GO: cross-domain fixtures must not touch shared data');
const pool=new Pool({connectionString:conn,max:3});
const owner=randomUUID(),outsider=randomUUID(),anonymous=randomUUID();
const ids={completed:randomUUID(),billed:randomUUID(),foreignOrder:randomUUID(),
 pendingMeasure:randomUUID(),invoiceMeasure:randomUUID(),invoice:randomUUID(),ar:randomUUID(),
 payable:randomUUID(),foreignPayable:randomUUID(),stmt:randomUUID(),line:randomUUID()};
const now=new Date().toISOString();
const read=(who:string,category='all',asOf='2028-01-01')=>GET(setTestIdentity(new Request(
 'http://localhost/api/enterprise/exceptions?'+new URLSearchParams({category,asOf,page:'1'})),who));
type Result={items:Array<{id:string;code:string;category:string;orderId:string|null}>;
 summary:{allOpen:number;total:number;byCategory:Array<{category:string;total:number}>};pageInfo:{hasMore:boolean};error?:string};
const json=async(res:Response)=>res.json() as Promise<Result>;
before(async()=>{
 for(const [id,actor,status] of [[ids.completed,owner,'completed'],[ids.billed,owner,'authorized'],
   [ids.foreignOrder,outsider,'completed']]){
  await pool.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at,status) VALUES($1,$2,'CI exception order','CI client','Serviços','CI', $3,$4)",
   [id,actor,now,status]);
 }
 await pool.query("INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,'Pending CI measurement',20000,'approved',$3)",
  [ids.pendingMeasure,ids.billed,now]);
 await pool.query("INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,'Billed CI measurement',55000,'billed',$3)",
  [ids.invoiceMeasure,ids.billed,now]);
 await pool.query("INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,55000,'2027-12-15',$4)",
  [ids.invoice,ids.invoiceMeasure,ids.billed,now]);
 await pool.query("INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,55000,'2027-12-15',$3)",
  [ids.ar,ids.invoice,now]);
 for(const [id,actor] of [[ids.payable,owner],[ids.foreignPayable,outsider]]){
  await pool.query("INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,'CI supplier','CI-PO','CI overdue AP',90000,'2027-11-30',$2,$3,'ci','exceptions')",
   [id,now,actor]);
 }
 await pool.query("INSERT INTO bank_statements(id,account_reference,source_reference,period_start,period_end,opening_balance,closing_balance,expected_count,status,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,'2027-12-01','2027-12-31',0,10000,1,'imported',$4,$5,'ci','exceptions')",
  [ids.stmt,'CI-exc-'+randomUUID().slice(0,8),randomUUID(),now,owner]);
 await pool.query("INSERT INTO bank_statement_lines(id,statement_id,external_key,booked_date,description,amount) VALUES($1,$2,$3,'2027-12-28','CI pending line',10000)",
  [ids.line,ids.stmt,randomUUID()]);
});
after(async()=>{await closeDatabase();await pool.end();});
test('all-domain queue contains only confirmed owner documents with source module',async()=>{
 const response=await read(owner);
 assert.equal(response.status,200);
 const data=await json(response);
 for(const code of ['COMPLETED_WITHOUT_MEASUREMENT','APPROVED_UNBILLED',
  'INVOICE_JOURNAL_UNVERIFIED','RECEIVABLE_OVERDUE','PAYABLE_OVERDUE','BANK_LINE_UNMATCHED'])
  assert.ok(data.items.some(v=>v.code===code),'missing '+code);
 assert.equal(data.items.some(v=>v.id===ids.foreignOrder),false);
 assert.equal(data.items.some(v=>v.id===ids.foreignPayable),false);
 assert.equal(data.summary.allOpen,data.summary.byCategory.reduce((s,v)=>s+v.total,0));
 assert.equal(data.pageInfo.hasMore,false);
 const foreign=await json(await read(outsider));
 assert.ok(foreign.items.some(v=>v.id===ids.foreignOrder));
 assert.ok(!foreign.items.some(v=>v.id===ids.completed||v.id===ids.payable));
 const empty=await json(await read(anonymous));
 assert.equal(empty.summary.allOpen,0);
 assert.equal(empty.items.length,0);
});
test('filtering and validation are consistent without creating financial facts',async()=>{
 const payable=await json(await read(owner,'payables'));
 assert.equal(payable.summary.total,1);
 assert.equal(payable.items[0].id,ids.payable);
 const treasury=await json(await read(owner,'treasury'));
 assert.equal(treasury.summary.total,1);
 assert.equal(treasury.items[0].id,ids.line);
 assert.equal((await read(owner,'invalid-domain')).status,400);
 const before=await pool.query("SELECT COUNT(*)::int AS n FROM finance_audit_events WHERE actor_id=$1",[owner]);
 await read(owner);await read(owner,'accounting');
 const afterRead=await pool.query("SELECT COUNT(*)::int AS n FROM finance_audit_events WHERE actor_id=$1",[owner]);
 assert.equal(before.rows[0].n,afterRead.rows[0].n,'read-only cross-domain queue emitted business events');
});
