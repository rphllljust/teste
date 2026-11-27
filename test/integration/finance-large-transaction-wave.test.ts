import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as prepareRun,GET as listRuns} from '../../app/api/finance/payment-runs/route';
import {GET as inspectRun} from '../../app/api/finance/payment-runs/[id]/route';
import {POST as runCommand} from '../../app/api/finance/payment-runs/[id]/commands/route';
import {GET as suggestions,POST as bankMatch} from '../../app/api/bank/assisted-match/route';
import {GET as listCollections,POST as createCollection} from '../../app/api/finance/collections/route';
import {GET as inspectCollection} from '../../app/api/finance/collections/[id]/route';
import {POST as caseCommand} from '../../app/api/finance/collections/[id]/commands/route';
import {registerPayablePayment,registerReceivableSettlement} from '../../lib/application/finance';
type PayRunResult={id?:string;status?:string;replayed?:boolean;payments?:Array<{id:string}>;error?:string};
type MatchingResult={id?:string;matched?:number;replayed?:boolean;error?:string};
type CaseResult={id?:string;status?:string;replayed?:boolean;error?:string};
const url=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!url)throw Error('NO-GO: isolated test database required');
const target=new URL(url);
if(!['localhost','127.0.0.1'].includes(target.hostname)||!['/cisne_ci','/cisne_test'].includes(target.pathname))
 throw Error('NO-GO: refuse controller test fixtures outside ephemeral PostgreSQL');
const pool=new Pool({connectionString:url,max:3});
const owner=randomUUID(),other=randomUUID();
const ids=[randomUUID(),randomUUID(),randomUUID()],runId=randomUUID(),caseId=randomUUID();
const stmt=randomUUID(),lineIds=[randomUUID(),randomUUID()];
const orderId=randomUUID(),measurementId=randomUUID(),invoiceId=randomUUID(),receivableId=randomUUID();
const at='2026-11-26',now=new Date().toISOString();
function get(path:string,actor=owner){return setTestIdentity(new Request('http://localhost'+path),actor);}
function post(path:string,body:unknown,actor=owner){
 return setTestIdentity(new Request('http://localhost'+path,{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify(body)}),actor);
}
async function json<T>(r:Response){return await r.json() as T;}
before(async()=>{
 for(let i=0;i<ids.length;i++)
  await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [ids[i],'CI SUPPLIER '+i,'CI-SOURCE-'+i,'Isolated payment-run fixture',
    [100000,200000,90000][i],'2026-12-01',now,i===2?other:owner,'fixture','ci']);
 await pool.query('INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [orderId,owner,'CI Collection Order','CI Customer','Services','Isolated owner case',now]);
 await pool.query('INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',
  [measurementId,orderId,'CI measurement',150000,'approved',now]);
 await pool.query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
  [invoiceId,measurementId,orderId,150000,'2026-11-01',now]);
 await pool.query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
  [receivableId,invoiceId,150000,'2026-11-01',now]);
});
after(async()=>{await closeDatabase();await pool.end();});
test('payment-run prepare persists a reviewable document and rejects cross-owner title',async()=>{
 const forbidden=await prepareRun(post('/api/finance/payment-runs',{
  id:randomUUID(),reference:'CI invalid foreign batch',effectiveDate:at,
  items:[{payableId:ids[2],amount:'9'}],
 }));
 assert.equal(forbidden.status,404);
 const payload={id:runId,reference:'CI batch payable source',effectiveDate:at,
  items:[{payableId:ids[0],amount:'10'},{payableId:ids[1],amount:'20'}]};
 const created=await prepareRun(post('/api/finance/payment-runs',payload));
 assert.equal(created.status,201,JSON.stringify(await json<PayRunResult>(created.clone())));
 assert.equal((await json<PayRunResult>(created)).status,'prepared');
 assert.equal((await prepareRun(post('/api/finance/payment-runs',payload))).status,200);
 const detail=await json<{run:{status:string};items:unknown[]}>(await inspectRun(
  get('/api/finance/payment-runs/'+runId),{params:Promise.resolve({id:runId})}));
 assert.equal(detail.run.status,'prepared');assert.equal(detail.items.length,2);
 const otherRead=await inspectRun(get('/api/finance/payment-runs/'+runId,other),{params:Promise.resolve({id:runId})});
 assert.equal(otherRead.status,404);
 const list=await json<{items:Array<{id:string}>}>(await listRuns(get('/api/finance/payment-runs')));
 assert.ok(list.items.some(x=>x.id===runId));
});
test('payment run posts two real local ledger payments atomically and permits identical replay',async()=>{
 const command={key:randomUUID(),action:'execute',expectedVersion:1};
 const first=await runCommand(post('/api/finance/payment-runs/'+runId+'/commands',command),
  {params:Promise.resolve({id:runId})});
 assert.equal(first.status,201,JSON.stringify(await json<PayRunResult>(first.clone())));
 const result=await json<PayRunResult>(first);
 assert.equal(result.payments?.length,2);
 const verified=await pool.query('SELECT payable_id,amount FROM payable_payments WHERE payable_id=ANY($1::text[]) AND kind=$2',[ids.slice(0,2),'payment']);
 assert.equal(verified.rows.length,2);
 assert.equal(verified.rows.reduce((n,x)=>n+Number(x.amount),0),300000);
 const replay=await runCommand(post('/api/finance/payment-runs/'+runId+'/commands',command),
  {params:Promise.resolve({id:runId})});
 assert.equal(replay.status,200);
 assert.equal((await json<PayRunResult>(replay)).replayed,true);
 const wrong=await runCommand(post('/api/finance/payment-runs/'+runId+'/commands',{
  key:randomUUID(),action:'execute',expectedVersion:1,
 }),{params:Promise.resolve({id:runId})});
 assert.equal(wrong.status,409);
});
test('assisted matching requires exact real payment source and commits two matches together',async()=>{
 await pool.query('INSERT INTO bank_statements(id,account_reference,source_reference,period_start,period_end,'+
  'opening_balance,closing_balance,expected_count,status,created_at,actor_id,request_hash,correlation_id) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
  [stmt,'CI BANK','CI BANK source','2026-11-01','2026-11-30',0,-300000,2,
   'imported',now,owner,'fixture','ci']);
 for(let i=0;i<2;i++)
  await pool.query('INSERT INTO bank_statement_lines(id,statement_id,external_key,booked_date,description,amount) '+
   'VALUES($1,$2,$3,$4,$5,$6)',[lineIds[i],stmt,'CI BANK-'+i,at,'CI payable match',i? -200000:-100000]);
 const raw=await suggestions(get('/api/bank/assisted-match?statementId='+stmt));
 assert.equal(raw.status,200,JSON.stringify(await json<{error?:string}>(raw.clone())));
 const data=await json<{suggestions:Array<{lineId:string;targetType:string;targetId:string}>;truncated:boolean}>(raw);
 assert.equal(data.truncated,false);assert.equal(data.suggestions.length,2);
 const key=randomUUID(),payload={id:key,statementId:stmt,matches:data.suggestions.map(s=>({
  lineId:s.lineId,targetType:s.targetType,targetId:s.targetId,
 }))};
 const attempt=await bankMatch(post('/api/bank/assisted-match',payload));
 assert.equal(attempt.status,201,JSON.stringify(await json<MatchingResult>(attempt.clone())));
 assert.equal((await json<MatchingResult>(attempt)).matched,2);
 assert.equal((await bankMatch(post('/api/bank/assisted-match',payload))).status,200);
 const matched=await pool.query("SELECT id FROM bank_reconciliation_events WHERE line_id=ANY($1::text[]) AND kind='match'",[lineIds]);
 assert.equal(matched.rows.length,2);
 const foreign=await suggestions(get('/api/bank/assisted-match?statementId='+stmt,other));
 assert.equal(foreign.status,404);
});
test('collections audit does not claim a promise is cash and refuses early resolution',async()=>{
 const created=await createCollection(post('/api/finance/collections',{
  id:caseId,receivableId,note:'CI contact case - verify outstanding title',
 }));
 assert.equal(created.status,201,JSON.stringify(await json<CaseResult>(created.clone())));
 const wrong=await createCollection(post('/api/finance/collections',{
  id:randomUUID(),receivableId,note:'CI forbidden foreign case'},other));
 assert.equal(wrong.status,404);
 const promise={key:randomUUID(),expectedVersion:1,action:'record_promise',
  note:'Customer promised a future transfer but none was received',promiseDate:'2027-01-15'};
 const saved=await caseCommand(post('/api/finance/collections/'+caseId+'/commands',promise),
  {params:Promise.resolve({id:caseId})});
 assert.equal(saved.status,201,JSON.stringify(await json<CaseResult>(saved.clone())));
 const premature=await caseCommand(post('/api/finance/collections/'+caseId+'/commands',{
  key:randomUUID(),expectedVersion:2,action:'resolve',note:'Must refuse before settlement',
 }),{params:Promise.resolve({id:caseId})});
 assert.equal(premature.status,409);
 const open=await json<{case:{status:string;outstandingScaled:string};history:unknown[]}>(await inspectCollection(
  get('/api/finance/collections/'+caseId),{params:Promise.resolve({id:caseId})}));
 assert.equal(open.case.status,'promised');assert.equal(open.case.outstandingScaled,'150000');
 assert.equal(open.history.length,2);
 const list=await json<{items:Array<{id:string}>}>(await listCollections(get('/api/finance/collections')));
 assert.ok(list.items.some(x=>x.id===caseId));
 // The only permitted settlement is the real receivables ledger, never a collections note.
 const settlement=await registerReceivableSettlement({actorId:owner,correlationId:randomUUID()},
  {receivableId,amount:150000,effectiveDate:at,reference:'CI RECEIPT',
   commandKey:randomUUID(),requestHash:'ci-settlement-'+randomUUID()});
 assert.equal(settlement.ok,true);
 const completed=await caseCommand(post('/api/finance/collections/'+caseId+'/commands',{
  key:randomUUID(),expectedVersion:2,action:'resolve',note:'Balance verified from posted settlement',
 }),{params:Promise.resolve({id:caseId})});
 assert.equal(completed.status,201,JSON.stringify(await json<CaseResult>(completed.clone())));
 assert.equal((await json<CaseResult>(completed)).status,'settled');
});
