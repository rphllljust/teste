import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as createClient} from '../../app/api/clients/route';
import {GET as getCatalog} from '../../app/api/service-catalog/route';
import {POST as createOrder} from '../../app/api/orders/route';
import {GET as getOrder} from '../../app/api/orders/[id]/route';
import {POST as registerPerson} from '../../app/api/field/people/route';
import {GET as getSchedule,POST as planOrder} from '../../app/api/orders/[id]/planning/route';
import {POST as applyCommand} from '../../app/api/commands/route';
import {GET as getExecution,POST as reportExecution} from '../../app/api/orders/[id]/execution/route';
import {POST as settleReceivable} from '../../app/api/finance/receivables/settlements/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('FIELD_LIFECYCLE_NO_GO: test-only database required');
const target=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
   !['/cisne_test','/cisne_ci'].includes(target.pathname)||target.port!=='5432')
  throw Error('FIELD_LIFECYCLE_NO_GO: refusing non-disposable PostgreSQL');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const actor=randomUUID(),clientId=randomUUID(),orderId=randomUUID(),personId=randomUUID();
let measurementId='',invoiceId='',receivableId='';
function req(path:string,method='GET',body?:unknown){
  return setTestIdentity(new Request('http://localhost'+path,{
    method,headers:body===undefined?undefined:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),
  }),actor);
}
function planning(method='GET',body?:unknown){
  const route='/api/orders/'+orderId+'/planning';
  const params={params:Promise.resolve({id:orderId})};
  return method==='POST'?planOrder(req(route,method,body),params):getSchedule(req(route),params);
}
async function expectStatus(response:Response,status:number){
  const payload=await response.clone().json() as Record<string,unknown>;
  assert.equal(response.status,status,'Unexpected HTTP: '+JSON.stringify(payload));
  return payload;
}
async function orderCommand(command:'authorize'|'start'|'complete'|'measure',version:number,extra:Record<string,unknown>={}){
  return expectStatus(await applyCommand(req('/api/commands','POST',{
    id:orderId,version,key:randomUUID(),command,...extra,
  })),201);
}

after(async()=>{
  // These records are purely synthetic and reside on a verified disposable CI DB.
  if(receivableId){
    await pool.query('DELETE FROM finance_audit_events WHERE entity_id=$1',[receivableId]);
    await pool.query('DELETE FROM receivable_settlements WHERE receivable_id=$1',[receivableId]);
    await pool.query('DELETE FROM receivables WHERE id=$1',[receivableId]);
  }
  if(invoiceId)await pool.query('DELETE FROM invoices WHERE id=$1',[invoiceId]);
  if(measurementId)await pool.query('DELETE FROM measurements WHERE id=$1',[measurementId]);
  await pool.query('DELETE FROM execution_entries WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM field_planning_events WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM field_order_assignments WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM field_order_schedules WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM field_people WHERE id=$1',[personId]);
  await pool.query('DELETE FROM order_events WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM service_orders WHERE id=$1',[orderId]);
  await pool.query('DELETE FROM clients WHERE id=$1',[clientId]);
  await pool.query('DELETE FROM business_commands WHERE id=$1',[clientId]);
  await closeDatabase();await pool.end();
});

test('Client -> real catalog -> OS -> schedule/team -> execution -> measurement -> invoice -> receivable settlement',async()=>{
  const client=await createClient(req('/api/clients','POST',{
    id:clientId,
    data:{legalName:'Cliente Teste da Operação',tradeName:null,document:null,email:null,phone:null},
  }));
  await expectStatus(client,201);
  const catalog=await expectStatus(await getCatalog(req('/api/service-catalog')),200);
  const services=catalog.services as Array<{id:string;name:string}>;
  const service=services.find(item=>item.id==='cisne-instalacao-eletrica');
  assert.ok(service,'active catalog service required');
  const order=await expectStatus(await createOrder(req('/api/orders','POST',{
    id:orderId,title:'OS instalação elétrica (ciclo de homologação)',category:'Serviços',
    description:'Instalação e manutenção elétrica com apuração financeira',
    dueDate:'2026-12-15',clientId,clientVersion:1,serviceCatalogId:service.id,
  })),201);
  assert.equal((order.resource as {id:string}).id,orderId);
  const persisted=await pool.query(
    'SELECT owner_id,client_id,service_catalog_id,status,version FROM service_orders WHERE id=$1',[orderId],
  );
  assert.equal(persisted.rows[0].owner_id,actor);
  assert.equal(persisted.rows[0].client_id,clientId);
  assert.equal(persisted.rows[0].service_catalog_id,service.id);
  assert.equal(persisted.rows[0].status,'draft');

  await expectStatus(await registerPerson(req('/api/field/people','POST',{
    id:personId,fullName:'Técnico CI de Campo',specialty:'Instalações elétricas',
  })),201);
  await expectStatus(await planning('POST',{
    key:randomUUID(),command:'set_schedule',expectedVersion:0,
    startsAt:'2026-12-03T12:00:00.000Z',endsAt:'2026-12-03T14:00:00.000Z',
    location:'Unidade de serviço sintética',
  }),201);
  await expectStatus(await planning('POST',{
    key:randomUUID(),command:'assign_person',personId,
  }),201);
  const plan=await expectStatus(await planning(),200);
  assert.equal((plan.schedule as {version:number}).version,1);
  assert.equal((plan.assignments as Array<{personId:string}>)[0].personId,personId);

  const auth=await orderCommand('authorize',1);
  assert.equal((auth.resource as {rowVersion:number}).rowVersion,2);
  const begun=await orderCommand('start',2);
  assert.equal((begun.resource as {rowVersion:number}).rowVersion,3);

  const reportBody={
    command:'report',key:randomUUID(),version:3,resourceKind:'labor',
    description:'Apontamento de instalação elétrica realizada',
    quantity:'2,5',unit:'h',resourceReference:null,
    effectiveDate:'2026-12-03',reference:'CI-OS-EXECUTADA',
  };
  const recorded=await expectStatus(await reportExecution(req('/api/orders/'+orderId+'/execution','POST',reportBody),
    {params:Promise.resolve({id:orderId})}),201);
  const entryId=(recorded.resource as {id:string}).id;
  assert.equal(entryId,reportBody.key,'execution and order event share the stable idempotency key');
  const executionAudit=await pool.query(
    'SELECT e.id,ev.id AS event_id,ev.target_id FROM execution_entries e JOIN order_events ev ON ev.id=e.id WHERE e.id=$1',[entryId],
  );
  assert.equal(executionAudit.rows[0]?.event_id,entryId,'execution FK is satisfied by the persisted audit event');
  assert.equal(executionAudit.rows[0]?.target_id,entryId);
  const replayedExecution=await reportExecution(req('/api/orders/'+orderId+'/execution','POST',reportBody),
    {params:Promise.resolve({id:orderId})});
  assert.equal(replayedExecution.status,201);
  const execution=await expectStatus(await getExecution(req('/api/orders/'+orderId+'/execution'),
    {params:Promise.resolve({id:orderId})}),200);
  assert.ok((execution.items as Array<{id:string}>).some(row=>row.id===entryId));

  const completed=await orderCommand('complete',3);
  assert.equal((completed.resource as {rowVersion:number}).rowVersion,4);
  const measured=await orderCommand('measure',4,{
    description:'Medição financeira sintética da OS',amount:'12,5000',
  });
  measurementId=(measured.resource as {id:string}).id;
  const approved=await expectStatus(await applyCommand(req('/api/commands','POST',{
    id:measurementId,version:1,key:randomUUID(),command:'approve_measurement',
  })),201);
  assert.equal((approved.resource as {rowVersion:number}).rowVersion,2);

  const billed=await expectStatus(await applyCommand(req('/api/commands','POST',{
    id:measurementId,version:2,key:randomUUID(),command:'invoice',
    dueDate:'2026-12-15',
  })),201);
  const billing=billed.resource as {id:string;receivableId:string;measurementId:string};
  invoiceId=billing.id;
  receivableId=billing.receivableId;
  assert.equal(billing.measurementId,measurementId);

  const receiptKey=randomUUID();
  const settlement={
    receivableId,amount:'125000',effectiveDate:'2026-12-04',
    reference:'Liquidação sintética de OS',commandKey:receiptKey,
  };
  await expectStatus(await settleReceivable(req('/api/finance/receivables/settlements','POST',settlement)),201);
  const duplicate=await expectStatus(await settleReceivable(req('/api/finance/receivables/settlements','POST',settlement)),200);
  assert.equal(duplicate.replayed,true);

  const detail=await expectStatus(await getOrder(req('/api/orders/'+orderId),
    {params:Promise.resolve({id:orderId})}),200);
  const orderDetail=detail.order as {
    status:string;service_catalog_id:string;relations:{measurements:number;invoices:number;receivables:number};
    sublists:{history:{pageInfo:{total:number}}};
  };
  assert.equal(orderDetail.status,'completed');
  assert.equal(orderDetail.service_catalog_id,service.id);
  assert.deepEqual(orderDetail.relations,{clientId,contractId:null,measurements:1,invoices:1,receivables:1});
  assert.ok(orderDetail.sublists.history.pageInfo.total>=7);

  const facts=await pool.query(
    "SELECT o.status,o.service_catalog_id,m.status AS measurement_status,m.amount,i.amount AS invoice_amount,r.amount AS receivable_amount,(SELECT COUNT(*)::int FROM receivable_settlements s WHERE s.receivable_id=r.id AND s.kind='receipt') AS receipt_count,(SELECT COUNT(*)::int FROM execution_entries e WHERE e.order_id=o.id) AS entries,(SELECT COUNT(*)::int FROM field_order_assignments a WHERE a.order_id=o.id AND a.active) AS people FROM service_orders o JOIN measurements m ON m.order_id=o.id JOIN invoices i ON i.measurement_id=m.id JOIN receivables r ON r.invoice_id=i.id WHERE o.id=$1",
    [orderId],
  );
  assert.equal(facts.rows.length,1);
  const record=facts.rows[0];
  assert.equal(record.status,'completed');
  assert.equal(record.service_catalog_id,service.id);
  assert.equal(record.measurement_status,'billed');
  assert.equal(Number(record.amount),125000);
  assert.equal(Number(record.invoice_amount),125000);
  assert.equal(Number(record.receivable_amount),125000);
  assert.equal(record.receipt_count,1);
  assert.equal(record.entries,1);
  assert.equal(record.people,1);
});
