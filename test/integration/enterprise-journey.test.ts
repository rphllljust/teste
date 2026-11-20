import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as createClient} from '../../app/api/clients/route';
import {GET as detailClient} from '../../app/api/clients/[id]/route';
import {POST as createProposal} from '../../app/api/proposals/route';
import {POST as commandProposal} from '../../app/api/proposals/[id]/commands/route';
import {POST as createPurchaseOrder} from '../../app/api/purchase-orders/route';
import {POST as createContract} from '../../app/api/contracts/route';
import {GET as detailContract} from '../../app/api/contracts/[id]/route';
import {POST as commandContract} from '../../app/api/contracts/[id]/commands/route';
import {POST as createOrder} from '../../app/api/orders/route';
import {GET as detailOrder} from '../../app/api/orders/[id]/route';
import {POST as commandOrder} from '../../app/api/commands/route';
import {POST as reportExecution} from '../../app/api/orders/[id]/execution/route';
import {POST as createMeasurement} from '../../app/api/orders/[id]/measurements/route';
import {POST as commandMeasurement} from '../../app/api/orders/[id]/measurements/[measurementId]/commands/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('NO-GO: enterprise journey requires disposable PostgreSQL and NODE_ENV=test');
const dbUrl=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(dbUrl.hostname)||
   !['/cisne_test','/cisne_ci'].includes(dbUrl.pathname)||dbUrl.port!=='5432')
  throw new Error('NO-GO: refusing mutations outside isolated CI PostgreSQL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});

function request(method:'GET'|'POST',path:string,actor:string,data?:unknown){
  const r=new Request('http://localhost'+path,{
    method,headers:{'content-type':'application/json'},
    body:data===undefined?undefined:JSON.stringify(data),
  });
  return setTestIdentity(r,actor);
}
const at=(id:string)=>({params:Promise.resolve({id})});
const body=async(response:Response)=>response.clone().json() as Promise<Record<string,unknown>>;
async function assertStatus(response:Response,status:number,label:string){
  assert.equal(response.status,status,label+' '+JSON.stringify(await body(response)));
}
async function cleanup(actor:string,clientId:string,orderId:string){
  await pool.query('DELETE FROM field_measurement_events WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM measurements WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM execution_entries WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM order_events WHERE order_id=$1',[orderId]);
  await pool.query('DELETE FROM service_orders WHERE id=$1',[orderId]);
  await pool.query('DELETE FROM business_commands WHERE actor_id=$1',[actor]);
  await pool.query('DELETE FROM contracts WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM purchase_orders WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM proposal_lines WHERE proposal_id IN(SELECT id FROM proposals WHERE owner_id=$1)',[actor]);
  await pool.query('DELETE FROM proposals WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM clients WHERE id=$1 AND owner_id=$2',[clientId,actor]);
}

test('one isolated owner-linked client -> proposal -> PO -> contract -> OS -> execution -> measurement journey persists and cleans up',async()=>{
  const owner=randomUUID(),outsider=randomUUID(),clientId=randomUUID(),proposalId=randomUUID();
  const purchaseOrderId=randomUUID(),contractId=randomUUID(),orderId=randomUUID();
  const date='2026-11-20',future='2099-12-31';
  try{
    const client=await createClient(request('POST','/api/clients',owner,{
      id:clientId,data:{legalName:'CISNE CI enterprise journey',tradeName:null,document:null,email:null,phone:null},
    }));
    await assertStatus(client,201,'Client creation');
    const proposed=await createProposal(request('POST','/api/proposals',owner,{
      id:proposalId,clientId,clientVersion:1,
      data:{title:'Synthetic enterprise inspection',scope:'Approved disposable business journey',
        validUntil:future,lines:[{description:'Inspection',unit:'un',quantity:'1',unitPrice:'125,50'}]},
    }));
    await assertStatus(proposed,201,'Proposal');
    await assertStatus(await commandProposal(request('POST','/api/proposals/'+proposalId+'/commands',owner,{
      key:randomUUID(),version:1,command:'issue',
    }),at(proposalId)),200,'Issue proposal');
    await assertStatus(await commandProposal(request('POST','/api/proposals/'+proposalId+'/commands',owner,{
      key:randomUUID(),version:2,command:'accept',reference:'CI-ACCEPTED-PROPOSAL',
    }),at(proposalId)),200,'Accept proposal');
    await assertStatus(await createPurchaseOrder(request('POST','/api/purchase-orders',owner,{
      id:purchaseOrderId,proposalId,proposalVersion:3,reference:'CI-PO-001',receivedDate:date,
    })),201,'Customer purchase order');
    await assertStatus(await createContract(request('POST','/api/contracts',owner,{
      id:contractId,proposalId,proposalVersion:3,purchaseOrderId,reference:'CI-CONTRACT-001',
      terms:{scope:'Disposable maintenance contract',startsOn:date,endsOn:future},
    })),201,'Contract');
    await assertStatus(await commandContract(request('POST','/api/contracts/'+contractId+'/commands',owner,{
      key:randomUUID(),version:1,command:'activate',signedReference:'CI-SIGNED-REFERENCE',
    }),at(contractId)),200,'Activate authorized contract');

    await assertStatus(await createOrder(request('POST','/api/orders',owner,{
      id:orderId,title:'CI contract-linked service order',category:'Serviços',
      description:'Authorized field execution',dueDate:null,clientId,clientVersion:1,
      contractId,contractVersion:2,
    })),201,'Linked service order');
    const hidden=await detailOrder(request('GET','/api/orders/'+orderId,outsider),at(orderId));
    assert.equal(hidden.status,404,'Cross-owner service order must be inaccessible');

    await assertStatus(await commandOrder(request('POST','/api/commands',owner,{
      id:orderId,version:1,key:randomUUID(),command:'authorize',
    })),201,'Authorize OS');
    await assertStatus(await commandOrder(request('POST','/api/commands',owner,{
      id:orderId,version:2,key:randomUUID(),command:'start',
    })),201,'Start execution');
    const execution=await reportExecution(request('POST','/api/orders/'+orderId+'/execution',owner,{
      command:'report',key:randomUUID(),version:3,resourceKind:'labor',
      description:'Technician work',quantity:'2,5',unit:'hora',
      resourceReference:'CI-TECH',effectiveDate:date,reference:'CI-EXEC-001',
    }),at(orderId));
    await assertStatus(execution,201,'Execution registration');
    const executionId=(await body(execution) as {resource:{id:string}}).resource.id;
    await assertStatus(await commandOrder(request('POST','/api/commands',owner,{
      id:orderId,version:3,key:randomUUID(),command:'complete',
    })),201,'Complete OS');

    const measurement=await createMeasurement(request('POST','/api/orders/'+orderId+'/measurements',owner,{
      key:randomUUID(),executionId,description:'CI executed work measurement',amount:'250,00',
    }),at(orderId));
    await assertStatus(measurement,201,'Create measurement');
    const measurementId=(await body(measurement) as {resource:{id:string}}).resource.id;
    await assertStatus(await commandMeasurement(request('POST','/api/orders/'+orderId+'/measurements/'+measurementId+'/commands',owner,{
      key:randomUUID(),version:1,command:'submit',
    }),{params:Promise.resolve({id:orderId,measurementId})}),200,'Submit measurement');

    const relationships=await pool.query(
      'SELECT o.owner_id,o.client_id,o.contract_id,c.proposal_id,c.purchase_order_id FROM service_orders o JOIN contracts c ON c.id=o.contract_id WHERE o.id=$1',[orderId]);
    assert.deepEqual(relationships.rows[0],{
      owner_id:owner,client_id:clientId,contract_id:contractId,proposal_id:proposalId,purchase_order_id:purchaseOrderId,
    });
    const persisted=await pool.query(
      'SELECT m.status,m.execution_entry_id,m.version FROM measurements m WHERE m.id=$1 AND m.order_id=$2',
      [measurementId,orderId]);
    assert.deepEqual(persisted.rows[0],{status:'submitted',execution_entry_id:executionId,version:2});

    const customer=await detailClient(request('GET','/api/clients/'+clientId,owner),at(clientId));
    await assertStatus(customer,200,'Client Object Page API');
    const projection=(await body(customer) as {projection:{related:{proposals:{id:string}[];contracts:{id:string}[]}}}).projection;
    assert.ok(projection.related.proposals.some(p=>p.id===proposalId));
    assert.ok(projection.related.contracts.some(c=>c.id===contractId));
    const contract=await detailContract(request('GET','/api/contracts/'+contractId,owner),at(contractId));
    await assertStatus(contract,200,'Contract Object Page API');
    const contracted=(await body(contract) as {projection:{related:{orders:{total:number}}}}).projection;
    assert.equal(contracted.related.orders.total,1);
    assert.equal((await detailClient(request('GET','/api/clients/'+clientId,outsider),at(clientId))).status,404);
    assert.equal((await detailContract(request('GET','/api/contracts/'+contractId,outsider),at(contractId))).status,404);
  }finally{
    await cleanup(owner,clientId,orderId);
    const leftover=await pool.query('SELECT count(*)::int AS n FROM clients WHERE id=$1',[clientId]);
    assert.equal(leftover.rows[0].n,0,'Synthetic owner data must be removed');
    await pool.end();
  }
});
// This test attests one isolated API and DB chain, not NextCRM/MinIO or browser writes.
