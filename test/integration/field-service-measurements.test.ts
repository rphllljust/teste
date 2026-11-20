import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as createOrder} from '../../app/api/orders/route';
import {POST as orderCommand} from '../../app/api/commands/route';
import {POST as reportExecution} from '../../app/api/orders/[id]/execution/route';
import {GET as listMeasurements,POST as createMeasurement} from '../../app/api/orders/[id]/measurements/route';
import {POST as submitMeasurement} from '../../app/api/orders/[id]/measurements/[measurementId]/commands/route';

if(process.env.NODE_ENV!=='test')throw new Error('Integration harness must run with NODE_ENV=test');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for Field Service measurement integration tests');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
const actor=randomUUID(),orderId=randomUUID(),clientId=randomUUID();
const req=(path:string,body:unknown)=>setTestIdentity(new Request(`http://localhost${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),actor);
const orderParams={params:Promise.resolve({id:orderId})};
const json=async(response:Response)=>response.clone().json() as Promise<Record<string,unknown>>;
before(async()=>{const r=await pool.query('SELECT current_schema() AS schema');assert.equal(r.rows[0].schema,'public');});
after(async()=>{await pool.query('DELETE FROM field_measurement_events WHERE order_id=$1',[orderId]);await pool.query('DELETE FROM measurements WHERE order_id=$1',[orderId]);await pool.query('DELETE FROM execution_entries WHERE order_id=$1',[orderId]);await pool.query('DELETE FROM order_events WHERE order_id=$1',[orderId]);await pool.query('DELETE FROM service_orders WHERE id=$1',[orderId]);await pool.query('DELETE FROM clients WHERE id=$1',[clientId]);await closeDatabase();await pool.end();});

test('execution is auditable and measurement creation/submission is execution-linked, idempotent and persistent',async()=>{
 const now=new Date().toISOString();await pool.query('INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',[clientId,actor,'CI measurement client',now]);
 assert.equal((await createOrder(req('/api/orders',{id:orderId,title:'CI measured service order',category:'Serviços',description:'Field Service measurement invariant',dueDate:null,clientId,clientVersion:1}))).status,201);
 assert.equal((await orderCommand(req('/api/commands',{id:orderId,version:1,key:randomUUID(),command:'authorize'}))).status,201);
 assert.equal((await orderCommand(req('/api/commands',{id:orderId,version:2,key:randomUUID(),command:'start'}))).status,201);
 const executionKey=randomUUID();const execution=await reportExecution(req(`/api/orders/${orderId}/execution`,{command:'report',key:executionKey,version:3,resourceKind:'labor',description:'Execução concluída em campo',quantity:'2,5',unit:'hora',resourceReference:'PROF-CI-01',effectiveDate:'2026-11-20',reference:'APONT-CI-001'}),orderParams);
 assert.equal(execution.status,201,JSON.stringify(await json(execution.clone())));const executionBody=await json(execution) as unknown as {resource:{id:string}};assert.ok(executionBody.resource.id);
 assert.equal((await orderCommand(req('/api/commands',{id:orderId,version:3,key:randomUUID(),command:'complete'}))).status,201);
 const measurementKey=randomUUID();const payload={key:measurementKey,executionId:executionBody.resource.id,description:'Medição da execução CI',amount:'250,00'};
 const created=await createMeasurement(req(`/api/orders/${orderId}/measurements`,payload),orderParams);assert.equal(created.status,201,JSON.stringify(await json(created.clone())));const createdBody=await json(created) as unknown as {resource:{id:string;executionId:string;rowVersion:number}};assert.equal(createdBody.resource.executionId,executionBody.resource.id);
 const replay=await createMeasurement(req(`/api/orders/${orderId}/measurements`,payload),orderParams);assert.equal(replay.status,200);assert.equal((await json(replay)).replayed,true);
 const duplicateExecution=await createMeasurement(req(`/api/orders/${orderId}/measurements`,{...payload,key:randomUUID(),description:'Medição duplicada'}),orderParams);assert.equal(duplicateExecution.status,409);
 const submitted=await submitMeasurement(req(`/api/orders/${orderId}/measurements/${createdBody.resource.id}/commands`,{key:randomUUID(),version:1,command:'submit'}),{params:Promise.resolve({id:orderId,measurementId:createdBody.resource.id})});assert.equal(submitted.status,200,JSON.stringify(await json(submitted.clone())));
 const listed=await listMeasurements(setTestIdentity(new Request(`http://localhost/api/orders/${orderId}/measurements`),actor),orderParams);assert.equal(listed.status,200);const item=((await json(listed)) as unknown as {items:Array<{status:string;executionId:string;version:number;availableCommands:unknown[]}>}).items[0];assert.deepEqual({status:item.status,executionId:item.executionId,version:item.version},{status:'submitted',executionId:executionBody.resource.id,version:2});assert.equal(item.availableCommands.length,0);
 const persisted=await pool.query(`SELECT m.status,m.version,m.execution_entry_id,COUNT(e.id)::int AS audit_events FROM measurements m JOIN field_measurement_events e ON e.measurement_id=m.id WHERE m.id=$1 GROUP BY m.id`,[createdBody.resource.id]);assert.deepEqual(persisted.rows[0],{status:'submitted',version:2,execution_entry_id:executionBody.resource.id,audit_events:2});
});
