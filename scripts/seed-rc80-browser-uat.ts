// Disposable CI-only synthetic enterprise chain. Never connect to Railway databases.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {setTestIdentity} from '../lib/api/test-identity.mjs';
import {closeDatabase} from '../db/raw';
import {POST as createOrder} from '../app/api/orders/route';
import {POST as runCommand} from '../app/api/commands/route';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true'||process.env.NODE_ENV!=='test')
  throw Error('NO-GO: fixture requires hosted CI NODE_ENV=test');
if(Object.keys(process.env).some(key=>key.startsWith('RAILWAY_')))
  throw Error('NO-GO: fixture cannot run inside Railway');
const databaseUrl=new URL(process.env.DATABASE_URL??'about:blank');
if(databaseUrl.hostname!=='postgres'||databaseUrl.pathname!=='/cisne_ci')
  throw Error('NO-GO: only disposable GitHub Actions Postgres is allowed');
const owner='ci-browser-actor-rc80',clientId=randomUUID(),orderId=randomUUID();
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const now=new Date().toISOString();
const request=(path:string,payload:object)=>
  setTestIdentity(new Request('http://localhost'+path,{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),owner);
const command=async(id:string,version:number,kind:string,extras:object={})=>{
  const response=await runCommand(request('/api/commands',{
    id,version,key:randomUUID(),command:kind,...extras,
  }));
  assert.equal(response.status,201,kind+': '+await response.clone().text());
  return response.json() as Promise<{resource:{id:string;receivableId?:string}}>;
};
try{
  await pool.query(
    'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
    [clientId,owner,'Empresa Sintética RC80 - Sem Dados Reais',now]);
  const created=await createOrder(request('/api/orders',{
    id:orderId,title:'OS RC80 Integracao Completa',category:'Serviços',
    description:'Homologacao CI sintetica sem informacao empresarial',dueDate:null,
    clientId,clientVersion:1,
  }));
  assert.equal(created.status,201,await created.clone().text());
  await command(orderId,1,'authorize');
  await command(orderId,2,'start');
  await command(orderId,3,'complete');
  const measured=await command(orderId,4,'measure',{
    description:'Medicao sintetica RC80',amount:'12',
  });
  const measurementId=measured.resource.id;
  await command(measurementId,1,'approve_measurement');
  const billed=await command(measurementId,2,'invoice',{dueDate:'2026-12-01'});
  const invoiceId=billed.resource.id,receivableId=billed.resource.receivableId;
  assert.ok(receivableId,'Billing must create real receivable');
  const facts=await pool.query(
    'SELECT o.status,m.amount AS measured,i.amount AS invoiced,r.amount AS receivable FROM service_orders o JOIN measurements m ON m.order_id=o.id JOIN invoices i ON i.measurement_id=m.id JOIN receivables r ON r.invoice_id=i.id WHERE o.id=$1',[orderId]);
  assert.equal(facts.rowCount,1);
  assert.deepEqual(facts.rows[0],{status:'completed',measured:120000,invoiced:120000,receivable:120000});
  await mkdir('artifacts/rc80-ui',{recursive:true});
  await writeFile('artifacts/rc80-ui/fixture.json',JSON.stringify({
    synthetic:true,owner,clientId,orderId,measurementId,invoiceId,receivableId,
    title:'OS RC80 Integracao Completa',principalScaled:'120000',
  },null,2));
  console.log('RC80_SYNTHETIC_PERSISTED_CHAIN_OK');
}finally{await pool.end();await closeDatabase();}
