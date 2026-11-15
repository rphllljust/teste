import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as registerClient} from '../../app/api/clients/route';
import {POST as registerProposal} from '../../app/api/proposals/route';
import {POST as actionProposal} from '../../app/api/proposals/[id]/commands/route';
import {POST as registerPO} from '../../app/api/purchase-orders/route';
import {POST as cancelPO} from '../../app/api/purchase-orders/[id]/commands/route';
import {GET as listContracts, POST as registerContract} from '../../app/api/contracts/route';
import {GET as detailContract} from '../../app/api/contracts/[id]/route';
import {POST as actionContract} from '../../app/api/contracts/[id]/commands/route';
import {POST as createOrder} from '../../app/api/orders/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('Contract integration requires NODE_ENV=test and disposable PostgreSQL');
const db=new Pool({connectionString:process.env.DATABASE_URL,max:4});
const actor=randomUUID(),stranger=randomUUID(),clientId=randomUUID(),proposalId=randomUUID();
const poId=randomUUID(),contractId=randomUUID(),orderId=randomUUID();
function req(method:'GET'|'POST',url:string,owner:string|undefined,body?:unknown){
  const request=new Request('http://localhost'+url,{method,
    headers:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  return owner?setTestIdentity(request,owner):request;
}
const param=(id:string)=>({params:Promise.resolve({id})});
const post=(path:string,owner:string,payload:unknown)=>
  req('POST',path,owner,payload);
const read=async(response:Response)=>response.clone().json() as Promise<Record<string,unknown>>;
async function cleanup(){
  await db.query('DELETE FROM order_events WHERE actor_id=$1',[actor]);
  await db.query('DELETE FROM service_orders WHERE owner_id=$1',[actor]);
  await db.query('DELETE FROM business_commands WHERE actor_id=$1 OR actor_id=$2',[actor,stranger]);
  await db.query('DELETE FROM contracts WHERE owner_id=$1',[actor]);
  await db.query('DELETE FROM purchase_orders WHERE owner_id=$1',[actor]);
  await db.query('DELETE FROM proposal_lines WHERE proposal_id IN(SELECT id FROM proposals WHERE owner_id=$1)',[actor]);
  await db.query('DELETE FROM proposals WHERE owner_id=$1',[actor]);
  await db.query('DELETE FROM clients WHERE owner_id=$1',[actor]);
}
after(async()=>{await cleanup();await db.end();});
const terms={scope:'Manutenção anual contratada com prazo e evidência',startsOn:'2026-11-15',endsOn:'2099-11-15'};
const input={id:contractId,proposalId,proposalVersion:3,purchaseOrderId:poId,
  reference:'CONTRATO-CI-RO-001',terms};

test('contract registration requires accepted, owner-matched proposal and active customer PO',async()=>{
  await cleanup();
  const c=await registerClient(post('/api/clients',actor,{id:clientId,
    data:{legalName:'Cliente Contrato CI',tradeName:null,document:null,email:null,phone:null}}));
  assert.equal(c.status,201,JSON.stringify(await read(c)));
  const p=await registerProposal(post('/api/proposals',actor,{id:proposalId,clientId,clientVersion:1,
    data:{title:'Contrato de manutenção',scope:'Atividades anuais e manutenção',
      validUntil:'2099-12-31',
      lines:[{description:'Atendimento técnico',unit:'un',quantity:'1',unitPrice:'125,50'}]}}));
  assert.equal(p.status,201);
  assert.equal((await registerContract(post('/api/contracts',actor,input))).status,404);
  const issue=await actionProposal(post('/api/proposals/'+proposalId+'/commands',actor,
    {key:randomUUID(),version:1,command:'issue'}),param(proposalId));
  assert.equal(issue.status,200);
  const accepted=await actionProposal(post('/api/proposals/'+proposalId+'/commands',actor,
    {key:randomUUID(),version:2,command:'accept',reference:'ACEITE-CI-COMERCIAL'}),param(proposalId));
  assert.equal(accepted.status,200);
  const po=await registerPO(post('/api/purchase-orders',actor,{id:poId,proposalId,proposalVersion:3,
    reference:'PO-CLIENTE-CI-001',receivedDate:'2026-11-15'}));
  assert.equal(po.status,201,JSON.stringify(await read(po)));
  assert.equal((await registerContract(post('/api/contracts',stranger,input))).status,404);
  assert.equal((await registerContract(post('/api/contracts',actor,{...input,proposalVersion:2}))).status,409);
  assert.equal((await registerContract(post('/api/contracts',actor,{...input,id:randomUUID(),purchaseOrderId:randomUUID()}))).status,404);
  const created=await registerContract(post('/api/contracts',actor,input));
  assert.equal(created.status,201,JSON.stringify(await read(created)));
  assert.equal((await registerContract(post('/api/contracts',actor,input))).status,201);
  assert.equal((await registerContract(post('/api/contracts',actor,{...input,reference:'DIVERGENTE'}))).status,409);
  assert.equal((await registerContract(post('/api/contracts',actor,{...input,id:randomUUID()}))).status,409);
  const persisted=await db.query(
    'SELECT owner_id,client_id,proposal_id,purchase_order_id,status,reference,row_version FROM contracts WHERE id=$1',
    [contractId]);
  assert.deepEqual(persisted.rows[0],{
    owner_id:actor,client_id:clientId,proposal_id:proposalId,purchase_order_id:poId,
    status:'draft',reference:'CONTRATO-CI-RO-001',row_version:1,
  });
  const forbidden=await cancelPO(post('/api/purchase-orders/'+poId+'/commands',actor,
    {key:randomUUID(),version:1,command:'cancel',reason:'Inadmissível com contrato'}),param(poId));
  assert.equal(forbidden.status,409);
  const listed=await listContracts(req('GET','/api/contracts?status=draft&q=CONTRATO-CI',actor));
  assert.equal(listed.status,200);
  const body=await read(listed) as {items:Array<{id:string}>};
  assert.equal(body.items[0].id,contractId);
  const hidden=await read(await listContracts(req('GET','/api/contracts',stranger))) as {items:unknown[]};
  assert.deepEqual(hidden.items,[]);
  const detail=await detailContract(req('GET','/api/contracts/'+contractId,actor),param(contractId));
  assert.equal(detail.status,200);
  const projection=(await read(detail) as {projection:{
    id:string;client:{id:string;state:{rowVersion:number}};
    availableCommands:Array<{id:string}>;canCreateOrder:boolean;
    related:{orders:{total:number;openTotal:number}};
  }}).projection;
  assert.equal(projection.id,contractId);
  assert.equal(projection.client.id,clientId);
  assert.equal(projection.client.state.rowVersion,1);
  assert.deepEqual(projection.availableCommands.map(x=>x.id),['revise','activate','cancel']);
  assert.equal(projection.canCreateOrder,false);
  assert.equal(projection.related.orders.total,0);
  assert.equal((await detailContract(req('GET','/api/contracts/'+contractId,stranger),param(contractId))).status,404);
});

test('contract activation requires signed evidence; linked OS is created only after authorization',async()=>{
  const revise={key:randomUUID(),version:1,command:'revise',
    terms:{...terms,scope:'Plano de manutenção revisado CI'}};
  const command=(p:unknown,owner=actor)=>actionContract(post('/api/contracts/'+contractId+'/commands',owner,p),
    param(contractId));
  const invalidActivation=await command({key:randomUUID(),version:1,command:'activate',signedReference:''});
  assert.equal(invalidActivation.status,400);
  const orderBody={id:orderId,title:'OS vinculada ao contrato CI',category:'Serviços',
    description:'Manutenção somente após ativação',dueDate:null,clientId,
    clientVersion:1,contractId,contractVersion:1};
  assert.equal((await createOrder(post('/api/orders',actor,orderBody))).status,409);
  const revised=await command(revise);
  assert.equal(revised.status,200);
  assert.equal((await command(revise)).status,200);
  assert.equal((await command({...revise,key:randomUUID()})).status,409);
  const activation={key:randomUUID(),version:2,command:'activate',
    signedReference:'ASSINATURA-DECLARADA-CI-001'};
  const active=await command(activation);
  assert.equal(active.status,200,JSON.stringify(await read(active)));
  assert.equal((await command(activation)).status,200);
  const stale=await createOrder(post('/api/orders',actor,{...orderBody,contractVersion:2}));
  assert.equal(stale.status,409);
  const created=await createOrder(post('/api/orders',actor,{...orderBody,contractVersion:3}));
  assert.equal(created.status,201,JSON.stringify(await read(created)));
  const replay=await createOrder(post('/api/orders',actor,{...orderBody,contractVersion:3}));
  assert.equal(replay.status,201);
  const linked=await db.query(
    'SELECT owner_id,client_id,contract_id,status FROM service_orders WHERE id=$1',[orderId]);
  assert.deepEqual(linked.rows[0],{owner_id:actor,client_id:clientId,
    contract_id:contractId,status:'draft'});
  const openContract=(await read(await detailContract(
    req('GET','/api/contracts/'+contractId,actor),param(contractId))) as {
      projection:{canCreateOrder:boolean;related:{orders:{total:number;openTotal:number}}};
    }).projection;
  assert.equal(openContract.canCreateOrder,true);
  assert.equal(openContract.related.orders.openTotal,1);
  assert.equal((await command({key:randomUUID(),version:3,command:'close'})).status,409);
  await db.query("UPDATE service_orders SET status='completed' WHERE id=$1",[orderId]);
  const closed=await command({key:randomUUID(),version:3,command:'close'});
  assert.equal(closed.status,200,JSON.stringify(await read(closed)));
  assert.equal((await createOrder(post('/api/orders',actor,
    {...orderBody,id:randomUUID(),contractVersion:4}))).status,409);
  const final=await db.query('SELECT status,row_version,signed_reference FROM contracts WHERE id=$1',[contractId]);
  assert.deepEqual(final.rows[0],{status:'closed',row_version:4,
    signed_reference:'ASSINATURA-DECLARADA-CI-001'});
  assert.equal((await command({key:randomUUID(),version:4,command:'activate',
    signedReference:'SEGUNDA-ASSINATURA'})).status,409);
});

test('public staging ignores forged owner header for contract mutations',async()=>{
  const previous=process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.RAILWAY_ENVIRONMENT_NAME='staging';
  try{
    const fake=new Request('http://localhost/api/contracts',{method:'POST',
      headers:{'content-type':'application/json','oai-authenticated-user-id':actor},
      body:JSON.stringify({...input,id:randomUUID()}),
    });
    assert.equal((await registerContract(fake)).status,403);
  }finally{
    if(previous===undefined)delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME=previous;
  }
});
