import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as createClient} from '../../app/api/clients/route';
import {POST as createProposal} from '../../app/api/proposals/route';
import {POST as proposalCommand} from '../../app/api/proposals/[id]/commands/route';
import {GET as listPO,POST as registerPO} from '../../app/api/purchase-orders/route';
import {GET as detailPO} from '../../app/api/purchase-orders/[id]/route';
import {POST as cancelPO} from '../../app/api/purchase-orders/[id]/commands/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('PO integration tests require NODE_ENV=test and disposable PostgreSQL URL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owner=randomUUID(),stranger=randomUUID(),clientId=randomUUID(),proposalId=randomUUID();
const receivedDate='2026-11-15',validUntil='2099-12-31';
function req(method:'GET'|'POST',path:string,identity:string|undefined,body?:unknown){
  const request=new Request('http://localhost'+path,{method,
    headers:{'content-type':'application/json'},
    body:method==='POST'?JSON.stringify(body):undefined,
  });
  return identity?setTestIdentity(request,identity):request;
}
const proposalsRoute={params:Promise.resolve({id:proposalId})};
async function submitPO(body:unknown,actor=owner){return registerPO(req('POST','/api/purchase-orders',actor,body));}
async function cleanup(){
  await pool.query('DELETE FROM contracts WHERE owner_id=$1',[owner]);
  await pool.query('DELETE FROM business_commands WHERE actor_id=$1 OR actor_id=$2',[owner,stranger]);
  await pool.query('DELETE FROM purchase_orders WHERE owner_id=$1',[owner]);
  await pool.query('DELETE FROM proposal_lines WHERE proposal_id IN(SELECT id FROM proposals WHERE owner_id=$1)',[owner]);
  await pool.query('DELETE FROM proposals WHERE owner_id=$1',[owner]);
  await pool.query('DELETE FROM clients WHERE owner_id=$1',[owner]);
}
after(async()=>{await cleanup();await pool.end();});
const get=async(response:Response)=>response.clone().json() as Promise<{
  error?:string;code?:string;resource?:{id:string;rowVersion:number};
  items?:Array<{id:string;proposalId:string;clientId:string;reference:string;state:{code:string}}>;
  projection?:{id:string;proposalTitle:string;proposalTotalScaled:string;cancelReason:string|null;
    state:{code:string;rowVersion:number};availableCommands:Array<{id:string}>;history:Array<{command:string}>};
}>;

test('accepted proposal is required to create a customer PO with exact ownership',async()=>{
  await cleanup();
  const client={id:clientId,data:{legalName:'Cliente Comercial PO CI',tradeName:null,
    document:null,email:null,phone:null}};
  const c=await createClient(req('POST','/api/clients',owner,client));
  assert.equal(c.status,201,JSON.stringify(await get(c)));
  const p=await createProposal(req('POST','/api/proposals',owner,{id:proposalId,clientId,
    clientVersion:1,data:{title:'Contrato de manutenção',scope:'Manutenção de máquinas',
      validUntil,lines:[{description:'Manutenção anual',unit:'un',quantity:'1',unitPrice:'250,50'}]}}));
  assert.equal(p.status,201,JSON.stringify(await get(p)));
  const orderId=randomUUID();
  const payload={id:orderId,proposalId,proposalVersion:1,reference:'PO-CI-2026-001',receivedDate};
  const draftNotAllowed=await submitPO(payload);
  assert.equal(draftNotAllowed.status,409);
  const issue=await proposalCommand(req('POST','/api/proposals/'+proposalId+'/commands',owner,
    {key:randomUUID(),version:1,command:'issue'}),proposalsRoute);
  assert.equal(issue.status,200);
  assert.equal((await submitPO({...payload,proposalVersion:2})).status,409);
  const accept=await proposalCommand(req('POST','/api/proposals/'+proposalId+'/commands',owner,
    {key:randomUUID(),version:2,command:'accept',reference:'ACEITE-TESTE-DECLARADO'}),proposalsRoute);
  assert.equal(accept.status,200);
  assert.equal((await submitPO({...payload,proposalVersion:2})).status,409);
  assert.equal((await submitPO({...payload,proposalVersion:3,receivedDate:'2099-01-01'})).status,400);
  const prepared={...payload,proposalVersion:3};
  assert.equal((await submitPO(prepared,stranger)).status,404);
  const created=await submitPO(prepared);
  assert.equal(created.status,201,JSON.stringify(await get(created)));
  assert.equal((await get(created)).resource?.id,orderId);
  const replay=await submitPO(prepared);
  assert.equal(replay.status,201);
  assert.equal((await get(replay)).resource?.id,orderId);
  assert.equal((await submitPO({...prepared,reference:'PO-CI-ALTERADA'})).status,409);
  const duplicate=await submitPO({...prepared,id:randomUUID()});
  assert.equal(duplicate.status,409);
  const persisted=await pool.query(
    'SELECT id,owner_id,client_id,proposal_id,reference,status,row_version FROM purchase_orders WHERE id=$1',
    [orderId],
  );
  assert.deepEqual(persisted.rows[0],{
    id:orderId,owner_id:owner,client_id:clientId,proposal_id:proposalId,
    reference:'PO-CI-2026-001',status:'registered',row_version:1,
  });
  const all=await listPO(req('GET','/api/purchase-orders?proposalId='+proposalId+'&status=registered',owner));
  assert.equal(all.status,200);
  const listed=await get(all);
  assert.equal(listed.items?.length,1);
  assert.equal(listed.items?.[0].reference,'PO-CI-2026-001');
  assert.equal((await get(await listPO(req('GET','/api/purchase-orders',stranger)))).items?.length,0);
  const route={params:Promise.resolve({id:orderId})};
  const detail=await detailPO(req('GET','/api/purchase-orders/'+orderId,owner),route);
  assert.equal(detail.status,200);
  const info=(await get(detail)).projection!;
  assert.equal(info.proposalTitle,'Contrato de manutenção');
  assert.equal(info.proposalTotalScaled,'2505000');
  assert.equal(info.state.code,'registered');
  assert.deepEqual(info.availableCommands.map(x=>x.id),['cancel']);
  assert.equal((await detailPO(req('GET','/api/purchase-orders/'+orderId,stranger),route)).status,404);

  const reason={key:randomUUID(),version:1,command:'cancel',reason:'Pedido anulado pelo cliente'};
  assert.equal((await cancelPO(req('POST','/api/purchase-orders/'+orderId+'/commands',stranger,reason),route)).status,404);
  assert.equal((await cancelPO(req('POST','/api/purchase-orders/'+orderId+'/commands',owner,
    {...reason,key:randomUUID(),reason:''}),route)).status,400);
  const cancelled=await cancelPO(req('POST','/api/purchase-orders/'+orderId+'/commands',owner,reason),route);
  assert.equal(cancelled.status,200,JSON.stringify(await get(cancelled)));
  assert.equal((await cancelPO(req('POST','/api/purchase-orders/'+orderId+'/commands',owner,reason),route)).status,200);
  assert.equal((await cancelPO(req('POST','/api/purchase-orders/'+orderId+'/commands',owner,
    {...reason,key:randomUUID()}),route)).status,409);
  const afterCancel=(await get(await detailPO(req('GET','/api/purchase-orders/'+orderId,owner),route))).projection!;
  assert.equal(afterCancel.state.code,'cancelled');
  assert.equal(afterCancel.cancelReason,'Pedido anulado pelo cliente');
  assert.deepEqual(afterCancel.availableCommands,[]);
  assert.ok(afterCancel.history.some(h=>h.command==='cancel'));
});

test('PO with a registered contract is not cancellable',async()=>{
  const id=randomUUID();
  const created=await submitPO({id,proposalId,proposalVersion:3,
    reference:'PO-CI-2026-002',receivedDate});
  assert.equal(created.status,201);
  const now=new Date().toISOString();
  const contractId=randomUUID();
  await pool.query(
    `INSERT INTO contracts
     (id,owner_id,client_id,proposal_id,purchase_order_id,reference,scope,
      starts_on,status,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$9)`,
    [contractId,owner,clientId,proposalId,id,'CONTRATO-CI-002',
      'Prestação de serviços','2026-11-15',now],
  );
  const route={params:Promise.resolve({id})};
  const detail=await detailPO(req('GET','/api/purchase-orders/'+id,owner),route);
  assert.equal(detail.status,200);
  assert.deepEqual((await get(detail)).projection?.availableCommands,[]);
  const cancel=await cancelPO(req('POST','/api/purchase-orders/'+id+'/commands',owner,
    {key:randomUUID(),version:1,command:'cancel',reason:'Cancelamento com contrato'}),route);
  assert.equal(cancel.status,409);
  const row=await pool.query('SELECT status FROM purchase_orders WHERE id=$1',[id]);
  assert.equal(row.rows[0].status,'registered');
});


test('simultaneous customer PO requests with same source reference commit only once',async()=>{
  const reference='PO-CI-RACE-2026';
  const payload=()=>({id:randomUUID(),proposalId,proposalVersion:3,reference,receivedDate});
  const [a,b]=await Promise.all([submitPO(payload()),submitPO(payload())]);
  assert.deepEqual([a.status,b.status].sort(),[201,409]);
  const result=await pool.query(
    'SELECT count(*)::int AS n FROM purchase_orders WHERE owner_id=$1 AND proposal_id=$2 AND reference=$3',
    [owner,proposalId,reference],
  );
  assert.equal(result.rows[0].n,1);
});

test('spoofed public staging identity cannot create a customer PO',async()=>{
  const before=process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.RAILWAY_ENVIRONMENT_NAME='staging';
  try{
    const spoof=new Request('http://localhost/api/purchase-orders',{
      method:'POST',
      headers:{'content-type':'application/json','oai-authenticated-user-id':owner},
      body:JSON.stringify({id:randomUUID(),proposalId,proposalVersion:3,
        reference:'PO-FAKE-CLIENT',receivedDate}),
    });
    assert.equal((await registerPO(spoof)).status,403);
  }finally{
    if(before===undefined)delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME=before;
  }
});
