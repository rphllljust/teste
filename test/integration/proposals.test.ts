import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as listProposals, POST as createProposal} from '../../app/api/proposals/route';
import {GET as detailProposal} from '../../app/api/proposals/[id]/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('Proposal tests require NODE_ENV=test and a disposable PostgreSQL URL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner=randomUUID(),outsider=randomUUID(),clientId=randomUUID(),proposalId=randomUUID();
function req(method:'GET'|'POST',path:string,actor:string|undefined,data?:unknown){
  const r=new Request('http://localhost'+path,{method,
    headers:{'content-type':'application/json'},
    body:data?JSON.stringify(data):undefined});
  return actor?setTestIdentity(r,actor):r;
}
async function cleanup(){
  await pool.query('DELETE FROM business_commands WHERE actor_id=$1',[owner]);
  await pool.query('DELETE FROM proposal_lines WHERE proposal_id IN(SELECT id FROM proposals WHERE owner_id=$1)',[owner]);
  await pool.query('DELETE FROM proposals WHERE owner_id=$1',[owner]);
  await pool.query('DELETE FROM clients WHERE owner_id=$1',[owner]);
}
after(async()=>{await cleanup();await pool.end();});

test('proposal API performs owner-scoped list and idempotent manual draft registration',async()=>{
  await cleanup();
  const now=new Date().toISOString();
  await pool.query(
    'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
    [clientId,owner,'Cliente Proposta CI',now],
  );
  const data={title:'Manutenção anual',scope:'Inspeções e serviços preventivos',validUntil:'2027-02-15',
    lines:[{description:'Visita programada',unit:'un',quantity:'2',unitPrice:'125,50'}]};
  const payload={id:proposalId,clientId,clientVersion:1,data};
  const created=await createProposal(req('POST','/api/proposals',owner,payload));
  assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
  const createdPayload=await created.json() as {resource:{id:string;rowVersion:number}};
  assert.equal(createdPayload.resource.id,proposalId);
  assert.equal(createdPayload.resource.rowVersion,1);
  const same=await createProposal(req('POST','/api/proposals',owner,payload));
  assert.equal(same.status,201);
  const conflict=await createProposal(req('POST','/api/proposals',owner,{...payload,data:{...data,title:'Outro título'}}));
  assert.equal(conflict.status,409);
  const duplicateRow=await pool.query('SELECT count(*)::int AS n,total FROM proposals WHERE id=$1 GROUP BY total',[proposalId]);
  assert.equal(duplicateRow.rows[0].n,1);
  assert.equal(duplicateRow.rows[0].total,2510000);
  const countLines=await pool.query('SELECT count(*)::int AS n, sum(amount)::int AS total FROM proposal_lines WHERE proposal_id=$1',[proposalId]);
  assert.equal(countLines.rows[0].n,1);
  assert.equal(countLines.rows[0].total,2510000);

  const list=await listProposals(req('GET','/api/proposals?q=Manuten%C3%A7%C3%A3o&status=draft',owner));
  assert.equal(list.status,200);
  const body=await list.json() as {items:Array<{id:string;clientId:string;totalScaled:string}>;pageInfo:{total:number;hasMore:boolean}};
  assert.equal(body.pageInfo.total,1);
  assert.equal(body.items[0].id,proposalId);
  assert.equal(body.items[0].clientId,clientId);
  assert.equal(body.items[0].totalScaled,'2510000');
  const notOwner=await listProposals(req('GET','/api/proposals',outsider));
  assert.deepEqual((await notOwner.json() as {items:unknown[]}).items,[]);

  const detail=await detailProposal(req('GET','/api/proposals/'+proposalId,owner),
    {params:Promise.resolve({id:proposalId})});
  assert.equal(detail.status,200);
  const record=(await detail.json() as {
    projection:{id:string;lines:Array<{quantityScaled:string;unitPriceScaled:string;amountScaled:string}>;
      state:{code:string};related:{purchaseOrders:{total:number}};availableCommands:unknown[]};
  }).projection;
  assert.equal(record.id,proposalId);
  assert.equal(record.state.code,'draft');
  assert.equal(record.lines[0].quantityScaled,'2000000');
  assert.equal(record.lines[0].unitPriceScaled,'1255000');
  assert.equal(record.lines[0].amountScaled,'2510000');
  assert.equal(record.related.purchaseOrders.total,0);
  assert.deepEqual(record.availableCommands,[]);
  assert.equal((await detailProposal(req('GET','/api/proposals/'+proposalId,outsider),
    {params:Promise.resolve({id:proposalId})})).status,404);
});

test('proposal registration fails closed on invalid owner, version, price, and staging identity spoofing',async()=>{
  const payload={id:randomUUID(),clientId,clientVersion:1,
    data:{title:'Outra manutenção',scope:'Executar serviços',validUntil:'2027-02-15',
      lines:[{description:'Execução técnica',unit:'h',quantity:'1',unitPrice:'50,00'}]}};
  assert.equal((await createProposal(req('POST','/api/proposals',outsider,payload))).status,404);
  assert.equal((await createProposal(req('POST','/api/proposals',owner,
    {...payload,id:randomUUID(),clientVersion:4}))).status,409);
  assert.equal((await createProposal(req('POST','/api/proposals',owner,
    {...payload,id:randomUUID(),data:{...payload.data,validUntil:'2000-01-01'}}))).status,400);
  assert.equal((await createProposal(req('POST','/api/proposals',owner,
    {...payload,id:randomUUID(),data:{...payload.data,lines:[{description:'Execução técnica',unit:'h',quantity:'100000',unitPrice:'999999'}]}}))).status,400);
  const prior=process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.RAILWAY_ENVIRONMENT_NAME='staging';
  try{
    const forged=new Request('http://localhost/api/proposals',{method:'POST',
      headers:{'content-type':'application/json','oai-authenticated-user-id':owner},
      body:JSON.stringify(payload)});
    assert.equal((await createProposal(forged)).status,403);
  }finally{
    if(prior===undefined)delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME=prior;
  }
});
