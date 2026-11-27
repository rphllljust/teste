import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET,POST} from '../../app/api/controlling/project-costs/route';

const url=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!url)throw Error('NO-GO: isolated PostgreSQL required');
const target=new URL(url);
if(!['localhost','127.0.0.1'].includes(target.hostname)||!['/cisne_ci','/cisne_test'].includes(target.pathname))
 throw Error('NO-GO: cannot write project fixtures outside disposable PostgreSQL');
const pool=new Pool({connectionString:url,max:3});
const owner=randomUUID(),foreign=randomUUID(),ids={a:randomUUID(),b:randomUUID(),other:randomUUID(),
 payable:randomUUID(),foreignPayable:randomUUID(),measurement:randomUUID(),invoice:randomUUID()};
const created=new Date().toISOString();
const request=(actor:string,path:string,payload?:unknown)=>setTestIdentity(new Request('http://localhost'+path,{
 method:payload?'POST':'GET',headers:{'content-type':'application/json'},
 body:payload?JSON.stringify(payload):undefined}),actor);
const read=(actor:string,orderId?:string)=>GET(request(actor,'/api/controlling/project-costs?'+
 new URLSearchParams(orderId?{orderId}:{page:'1'})));
const post=(actor:string,payload:unknown)=>POST(request(actor,'/api/controlling/project-costs',payload));
type CostProjection={items:Array<{id:string;billedScaled:string;costScaled:string;contributionScaled:string}>;
 payables:Array<{id:string;remainingScaled:string}>;allocations:Array<{id:string;kind:string;reversed:boolean}>;
 pageInfo:{total:number};error?:string};
const json=async(response:Response)=>response.json() as Promise<CostProjection>;
before(async()=>{
 for(const [id,actor,title] of [[ids.a,owner,'CI OS ALPHA'],[ids.b,owner,'CI OS BRAVO'],[ids.other,foreign,'CI OS FOREIGN']]){
  await pool.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at,status) VALUES($1,$2,$3,'CI CLIENT','Serviços','CI project cost', $4,'authorized')",
   [id,actor,title,created]);
 }
 await pool.query("INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,'CI measurement',80000,'approved',$3)",
  [ids.measurement,ids.a,created]);
 await pool.query("INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,80000,'2028-09-30',$4)",
  [ids.invoice,ids.measurement,ids.a,created]);
 for(const [id,actor] of [[ids.payable,owner],[ids.foreignPayable,foreign]]){
  await pool.query("INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,'CI SUPPLIER','CI-PAYABLE','CI fixture',100000,'2028-09-30',$2,$3,'ci','cost-test')",
   [id,created,actor]);
 }
});
after(async()=>{await closeDatabase();await pool.end();});
test('cost control links owned payable to OS, keeps contributions exact and projects isolated',async()=>{
 let report=await json(await read(owner,ids.a));
 assert.equal(report.pageInfo.total,2);
 assert.equal(report.items.find(x=>x.id===ids.a)?.billedScaled,'80000');
 assert.equal(report.items.find(x=>x.id===ids.a)?.costScaled,'0');
 assert.equal((await read(foreign,ids.a)).status,404);
 const id=randomUUID(),alloc={action:'allocate',id,serviceOrderId:ids.a,
  payableId:ids.payable,amountScaled:'60000',reference:'Contrato CI ALPHA'};
 assert.equal((await post(owner,alloc)).status,201);
 assert.equal((await post(owner,alloc)).status,200);
 assert.equal((await post(owner,{...alloc,id:randomUUID(),amountScaled:'99999'})).status,409);
 assert.equal((await post(foreign,{...alloc,id:randomUUID(),payableId:ids.foreignPayable})).status,404);
 report=await json(await read(owner,ids.a));
 assert.equal(report.items.find(x=>x.id===ids.a)?.costScaled,'60000');
 assert.equal(report.items.find(x=>x.id===ids.a)?.contributionScaled,'20000');
 assert.equal(report.payables.find(x=>x.id===ids.payable)?.remainingScaled,'40000');
 assert.equal(report.allocations.find(x=>x.id===id)?.reversed,false);
 const second={action:'allocate',id:randomUUID(),serviceOrderId:ids.b,
  payableId:ids.payable,amountScaled:'40000',reference:'Divisão do custo aprovado'};
 assert.equal((await post(owner,second)).status,201);
 report=await json(await read(owner,ids.b));
 assert.equal(report.items.find(x=>x.id===ids.b)?.costScaled,'40000');
 assert.ok(!report.payables.some(x=>x.id===ids.payable));
 const reversal={action:'reverse',id:randomUUID(),allocationId:id,reference:'Estorno analítico CI'};
 assert.equal((await post(owner,reversal)).status,201);
 assert.equal((await post(owner,reversal)).status,200);
 assert.equal((await post(owner,{...reversal,id:randomUUID()})).status,409);
 report=await json(await read(owner,ids.a));
 assert.equal(report.items.find(x=>x.id===ids.a)?.costScaled,'0');
 assert.equal(report.items.find(x=>x.id===ids.a)?.contributionScaled,'80000');
 assert.equal(report.allocations.find(x=>x.id===id)?.reversed,true);
 assert.equal(report.payables.find(x=>x.id===ids.payable)?.remainingScaled,'60000');
 const audit=await pool.query("SELECT action FROM finance_audit_events WHERE entity_type='project_cost_allocation' AND actor_id=$1",
  [owner]);
 assert.equal(audit.rowCount,3);
});
test('PostgreSQL enforces immutable allocations and cross-owner access even for direct SQL',async()=>{
 const row=await pool.query('SELECT id FROM enterprise_project_cost_allocations WHERE actor_id=$1 LIMIT 1',[owner]);
 assert.ok(row.rows.length);
 await assert.rejects(pool.query('UPDATE enterprise_project_cost_allocations SET reference=$2 WHERE id=$1',
  [row.rows[0].id,'Unsafe edit']),/CISNE_PROJECT_COST_IMMUTABLE/);
 const foreignId=randomUUID();
 await assert.rejects(pool.query(
  'INSERT INTO enterprise_project_cost_allocations(id,actor_id,service_order_id,payable_id,kind,amount,reference,request_hash,correlation_id,created_at) '+
  "VALUES($1,$2,$3,$4,'allocate',1,'Unauthorized cost','ci','ci',$5)",
  [foreignId,owner,ids.other,ids.payable,created]),/CISNE_PROJECT_COST_OWNER_INVARIANT/);
});
