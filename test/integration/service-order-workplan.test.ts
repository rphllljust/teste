import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET,POST} from '../../app/api/orders/[id]/work-packages/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('NO-GO: enterprise OS WBS requires isolated PostgreSQL integration.');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||
 !['/cisne_ci','/cisne_test'].includes(url.pathname)||
 !['cisne_ci','cisne_test'].includes(url.username))
 throw Error('NO-GO: WBS test refuses non-disposable financial database.');
const db=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owner=randomUUID(),foreign=randomUUID(),order=randomUUID(),foreignOrder=randomUUID();
const worker=randomUUID(),a=randomUUID(),b=randomUUID(),payable=randomUUID(),allocation=randomUUID();
const now=new Date().toISOString(),urlFor=(id:string)=>'http://localhost/api/orders/'+id+'/work-packages';
const ctx=(id:string)=>({params:Promise.resolve({id})});
const get=(actor:string,id:string,q='')=>GET(setTestIdentity(new Request(urlFor(id)+q),actor),ctx(id));
const post=(actor:string,id:string,body:object)=>POST(setTestIdentity(new Request(urlFor(id),{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
}),actor),ctx(id));
const data=(reference:string,title:string,dependsOnId:string|null=null)=>({
 reference,title,description:'CI operational WBS evidence only',category:'labor' as const,
 plannedStartOn:'2026-11-27',plannedEndOn:'2027-01-30',
 plannedHoursScaled:'80000',plannedCostScaled:'300000',
 responsibleProfessionalId:worker,dependsOnId,
});
const create=(packageId:string,record:ReturnType<typeof data>)=>({
 action:'create',key:randomUUID(),packageId,data:record
});
const step=(packageId:string,action:string,expectedVersion:number,evidenceReference?:string)=>({
 action,key:randomUUID(),packageId,expectedVersion,
 ...(action==='complete'?{evidenceReference:evidenceReference??'CI-TECH-REPORT-001'}:{}),
 ...(action==='cancel'?{reason:'CI recorded cancellation reason'}:{})
});
type Board={items:Array<{id:string;state:string;rowVersion:number;dependencyState:string|null}>;
 summary:{total:number;done:number;active:number;completionRatePercent:number|null;
 plannedCostScaled:string;attributedCostScaled:string;varianceScaled:string;varianceAvailable:boolean};
 history:Array<{command:string;packageId:string}>;error?:string};
const read=async(actor=owner,q='')=>await (await get(actor,order,q)).json() as Board;

before(async()=>{
 await db.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) VALUES($1,$2,'CI WBS owned OS','CI tenant','Serviços','Owner test','executing',$3)",[order,owner,now]);
 await db.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) VALUES($1,$2,'CI WBS other OS','CI tenant other','Serviços','Owner test','executing',$3)",[foreignOrder,foreign,now]);
 await db.query("INSERT INTO professionals(id,owner_id,name,registration,specialty,department,status,created_at,updated_at) VALUES($1,$2,'CI WBS leader',$3,'Maintenance','Operations','active',$4,$4)",
 [worker,owner,'CI-WBS-'+worker.slice(0,8),now]);
});
after(async()=>{await closeDatabase();await db.end();});

test('OS WBS blocks unauthorized reading, mutation and cross-tenant professional assignment',async()=>{
 assert.equal((await get(foreign,order)).status,404);
 assert.equal((await post(foreign,order,create(a,data('WBS-01','First work activity')))).status,404);
 assert.equal((await get(owner,'bad-uuid')).status,400);
 assert.equal((await get(owner,order,'?unexpected=yes')).status,400);
 assert.equal((await GET(new Request(urlFor(order)),ctx(order))).status,401);
 const unauthorized=create(randomUUID(),{...data('FOREIGN-PRO','Unauthorized owner'),responsibleProfessionalId:randomUUID()});
 const denial=await post(owner,order,unauthorized);
 assert.equal(denial.status,409);
 assert.equal((await read()).summary.total,0);
});
test('WBS creates, replays, detects dependency cycle, versions and enforces predecessor completion',async()=>{
 const first=create(a,data('WBS-A','Mobilization of CI team'));
 const initial=await post(owner,order,first);
 assert.equal(initial.status,201,JSON.stringify(await initial.clone().json()));
 assert.equal((await post(owner,order,first)).status,200);
 assert.equal((await post(owner,order,{...first,data:data('WBS-A','DIFFERENT CONTENT')})).status,409);
 const second=create(b,data('WBS-B','Work execution checkpoint',a));
 assert.equal((await post(owner,order,second)).status,201);
 assert.equal((await post(owner,order,{
  action:'revise',key:randomUUID(),packageId:a,expectedVersion:1,
  data:data('WBS-A','Illegal dependency cycle',b)
 })).status,409);
 const updated=await post(owner,order,{
  action:'revise',key:randomUUID(),packageId:a,expectedVersion:1,
  data:{...data('WBS-A','Mobilization with revised budget'),plannedCostScaled:'400000'}
 });
 assert.equal(updated.status,201);
 assert.equal((await post(owner,order,step(b,'ready',1))).status,201);
 assert.equal((await post(owner,order,step(b,'start',2))).status,409);
 assert.equal((await post(owner,order,step(a,'ready',2))).status,201);
 assert.equal((await post(owner,order,step(a,'start',3))).status,201);
 assert.equal((await post(owner,order,step(a,'complete',4,'CI-REAL-EVIDENCE-REF-001'))).status,201);
 const race=await Promise.all([post(owner,order,step(b,'start',2)),post(owner,order,step(b,'start',2))]);
 assert.deepEqual(race.map(r=>r.status).sort((x,y)=>x-y),[201,409]);
 assert.equal((await post(owner,order,step(b,'complete',3,'CI-REAL-EVIDENCE-REF-002'))).status,201);
 assert.equal((await post(owner,order,{
  action:'revise',key:randomUUID(),packageId:a,expectedVersion:5,
  data:data('WBS-A','Illegal retroactive budget revision')
 })).status,409);
 const board=await read();
 assert.equal(board.summary.total,2);
 assert.equal(board.summary.done,2);
 assert.equal(board.summary.completionRatePercent,100);
 assert.equal(board.summary.plannedCostScaled,'700000');
 assert.equal(board.summary.varianceScaled,'700000');
 assert.ok(board.history.some(e=>e.command==='complete'&&e.packageId===b));
 assert.equal((await read(owner,'?state=done')).items.length,2);
 assert.equal((await post(owner,order,step(a,'cancel',5))).status,409);
});
test('real AP-to-OS cost allocation reconciles with WBS forecast without false receipt postings',async()=>{
 await db.query("INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,'CI WBS vendor','CI-WBS-AP','CI WBS cost allocation',250000,'2027-09-30',$2,$3,'ci','wbs-test')",
 [payable,now,owner]);
 await db.query("INSERT INTO enterprise_project_cost_allocations(id,actor_id,service_order_id,payable_id,kind,amount,reference,request_hash,correlation_id,created_at) VALUES($1,$2,$3,$4,'allocate',190000,'CI Workplan linked AP','ci-wbs-unique','ci',$5)",
 [allocation,owner,order,payable,now]);
 const report=await read();
 assert.equal(report.summary.attributedCostScaled,'190000');
 assert.equal(report.summary.varianceScaled,'510000');
 assert.equal(report.summary.varianceAvailable,true);
 assert.equal((await get(foreign,order)).status,404);
});
test('database rejects SQL tenant violations and immutable audit tampering',async()=>{
 await assert.rejects(db.query(`INSERT INTO enterprise_os_work_packages(
  id,owner_id,order_id,reference,title,category,planned_start_on,planned_end_on,planned_hours_scaled,planned_cost_scaled,created_at,updated_at)
  VALUES($1,$2,$3,'CI-UNOWNED','Cross tenant work package','labor','2026-11-27','2027-01-30',10000,50000,$4,$4)`,
 [randomUUID(),foreign,order,now]),/CISNE_OS_PACKAGE_OWNER_INVARIANT/);
 const event=await db.query('SELECT id FROM enterprise_os_work_package_events WHERE owner_id=$1 LIMIT 1',[owner]);
 assert.ok(event.rows.length);
 await assert.rejects(db.query("UPDATE enterprise_os_work_package_events SET command='cancel' WHERE id=$1",[event.rows[0].id]),
  /CISNE_OS_PACKAGE_EVENT_IMMUTABLE/);
});
