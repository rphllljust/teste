import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET} from '../../app/api/orders/[id]/control/route';
import {GET as operationsList} from '../../app/api/enterprise/operations/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('NO-GO: OS control integration requires disposable PostgreSQL');
const uri=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(uri.hostname)||
 !['/cisne_ci','/cisne_test'].includes(uri.pathname)||
 !['cisne_ci','cisne_test'].includes(uri.username))
 throw Error('NO-GO: OS control fixture must never write to a persistent database');
const db=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner=randomUUID(),foreign=randomUUID(),order=randomUUID(),foreignOrder=randomUUID();
const professional=randomUUID(),allocation=randomUUID(),execution=randomUUID();
const measurement=randomUUID(),invoice=randomUUID(),payable=randomUUID(),cost=randomUUID();
const now=new Date().toISOString();
const read=(id:string,actor?:string)=>{
 const request=new Request('http://localhost/api/orders/'+id+'/control');
 return GET(actor?setTestIdentity(request,actor):request,{params:Promise.resolve({id})});
};
type Body={order:{id:string;status:string};
 evidence:{allocations:number;activeExecution:number;measurements:number;approvedUnbilled:number;
  invoices:number;activeCostAllocations:number};
 control:{phase:string;flags:string[];financial:{billedScaled:string;attributedCostScaled:string;
  receivableOutstandingScaled:string;partialContributionScaled:string}};
 recent:{allocations:Array<{label:string}>;execution:Array<{id:string}>;
  measurements:Array<{invoiceId:string|null}>;costs:Array<{id:string}>}};
before(async()=>{
 await db.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) VALUES($1,$2,'CI Tier1 OS control','CI client','Serviços','Synthetic owner-scoped test','completed',$3)",[order,owner,now]);
 await db.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) VALUES($1,$2,'CI foreign OS','CI foreign','Serviços','Other tenant','executing',$3)",[foreignOrder,foreign,now]);
});
after(async()=>{await closeDatabase();await db.end();});
test('OS control rejects foreign, unauthenticated and invalid IDs before related documents',async()=>{
 assert.equal((await read(order,foreign)).status,404);
 assert.equal((await read(foreignOrder,owner)).status,404);
 assert.equal((await read(order)).status,401);
 assert.equal((await read('bad-id',owner)).status,400);
 const response=await read(order,owner);
 assert.equal(response.status,200);
 const body=await response.json() as Body;
 assert.equal(body.order.id,order);
 assert.equal(body.evidence.activeExecution,0);
 assert.ok(body.control.flags.includes('EXECUTION_EVIDENCE_MISSING'));
});
test('resource allocation and execution/measurement gates reflect persisted facts with no invented completion',async()=>{
 await db.query("INSERT INTO professionals(id,owner_id,name,registration,specialty,department,status,created_at,updated_at) VALUES($1,$2,'CI OS technician',$3,'Field','Ops','active',$4,$4)",[professional,owner,'CI-OS-'+professional.slice(0,8),now]);
 const start=new Date(Date.now()-3600000).toISOString(),end=new Date(Date.now()+3600000).toISOString();
 await db.query("INSERT INTO resource_allocations(id,owner_id,order_id,resource_type,resource_id,starts_at,ends_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,'professional',$4,$5,$6,$2,'ci-os','ci')",
  [allocation,owner,order,professional,start,end]);
 await db.query("INSERT INTO execution_entries(id,order_id,kind,resource_kind,description,quantity,unit,resource_reference,effective_date,reference,actor_id,created_at) VALUES($1,$2,'report','labor','CI performed service',2500000,'hour','CI-tech','2026-11-27','CI-OS-REPORT',$3,$4)",
  [execution,order,owner,now]);
 let body=await (await read(order,owner)).json() as Body;
 assert.equal(body.evidence.allocations,1);
 assert.equal(body.evidence.activeExecution,1);
 assert.equal(body.control.phase,'measurement');
 assert.ok(body.control.flags.includes('EXECUTION_WITHOUT_MEASUREMENT'));
 assert.equal(body.recent.allocations[0].label,'CI OS technician');
 assert.equal(body.recent.execution[0].id,execution);
 await db.query("INSERT INTO measurements(id,order_id,execution_entry_id,description,amount,status,created_at) VALUES($1,$2,$3,'CI measured work',75000,'approved',$4)",
  [measurement,order,execution,now]);
 body=await (await read(order,owner)).json() as Body;
 assert.equal(body.control.phase,'billing');
 assert.equal(body.evidence.approvedUnbilled,1);
 assert.ok(body.control.flags.includes('APPROVED_MEASUREMENT_UNBILLED'));
});
test('operational worklist flags partially measured completed OS with additional unmeasured active execution',async()=>{
 const otherExecution=randomUUID();
 await db.query("INSERT INTO execution_entries(id,order_id,kind,resource_kind,description,quantity,unit,resource_reference,effective_date,reference,actor_id,created_at) VALUES($1,$2,'report','labor','CI unmeasured second entry',1000000,'hour','CI-tech','2026-11-27','CI-OS-SECOND',$3,$4)",
  [otherExecution,order,owner,now]);
 const req=setTestIdentity(new Request('http://localhost/api/enterprise/operations?queue=unmeasured&page=1'),owner);
 const response=await operationsList(req);
 assert.equal(response.status,200);
 const body=await response.json() as {items:Array<{id:string;unmeasured:boolean}>;summary:{unmeasured:number}};
 assert.ok(body.items.some(x=>x.id===order&&x.unmeasured));
 assert.ok(body.summary.unmeasured>=1);
 const detail=await (await read(order,owner)).json() as Body;
 assert.ok(detail.control.flags.includes('EXECUTION_WITHOUT_MEASUREMENT'));
 assert.equal(detail.control.phase,'measurement');
});
test('OS financial ledger includes real invoice and immutable payable allocation but not an inferred bank receipt',async()=>{
 await db.query("INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,75000,'2029-09-30',$4)",
  [invoice,measurement,order,now]);
 await db.query("INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,'CI supplier','CI-OS-AP','CI allocated cost',100000,'2029-09-30',$2,$3,'ci','ci')",
  [payable,now,owner]);
 await db.query("INSERT INTO enterprise_project_cost_allocations(id,actor_id,service_order_id,payable_id,kind,amount,reference,request_hash,correlation_id,created_at) VALUES($1,$2,$3,$4,'allocate',30000,'CI OS materials', 'ci-os-control','ci',$5)",
  [cost,owner,order,payable,now]);
 const response=await read(order,owner);
 assert.equal(response.status,200);
 const body=await response.json() as Body;
 assert.equal(body.evidence.invoices,1);
 assert.equal(body.evidence.activeCostAllocations,1);
 assert.equal(body.control.financial.billedScaled,'75000');
 assert.equal(body.control.financial.attributedCostScaled,'30000');
 assert.equal(body.control.financial.partialContributionScaled,'45000');
 assert.equal(body.control.financial.receivableOutstandingScaled,'75000');
 assert.ok(body.control.flags.includes('RECEIVABLE_BALANCE_OPEN'));
 assert.equal(body.recent.measurements[0].invoiceId,invoice);
 assert.equal(body.recent.costs[0].id,cost);
 assert.equal((await read(order,foreign)).status,404);
});
