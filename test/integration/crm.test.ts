import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { GET, POST } from '../../app/api/crm/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw new Error('CRM integration tests require NODE_ENV=test and disposable DATABASE_URL');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owner=randomUUID(), other=randomUUID(), leadId=randomUUID(), opportunityId=randomUUID(), clientId=randomUUID();
const now=new Date().toISOString();
function req(method:'GET'|'POST',data?:unknown,identity?:string,extra:Record<string,string>={}){
  const request=new Request('http://localhost/api/crm',{
    method,headers:{'content-type':'application/json',...extra},
    body:method==='POST'?JSON.stringify(data):undefined,
  });
  return identity?setTestIdentity(request,identity):request;
}
const read=async (r:Response)=>r.clone().json() as Promise<Record<string,any>>;
const send=(body:unknown,actor=owner)=>POST(req('POST',body,actor));
async function cleanup(){
  await pool.query('DELETE FROM crm_commands WHERE actor_id=$1 OR actor_id=$2',[owner,other]);
  await pool.query('DELETE FROM crm_opportunities WHERE owner_id=$1 OR owner_id=$2',[owner,other]);
  await pool.query('DELETE FROM crm_leads WHERE owner_id=$1 OR owner_id=$2',[owner,other]);
  await pool.query('DELETE FROM clients WHERE owner_id=$1',[owner]);
}
after(async()=>{await cleanup();await pool.end();});

test('native CRM migration is applied exactly once',async()=>{
  const r=await pool.query("SELECT id FROM _cisne_schema_migrations WHERE id='0001_native_crm'");
  assert.equal(r.rows.length,1);
  const leads=await pool.query("SELECT to_regclass('public.crm_leads') AS t");
  assert.equal(leads.rows[0].t,'crm_leads');
});

test('staging denies API reads and writes even with forged identity headers',async()=>{
  const prior=process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.RAILWAY_ENVIRONMENT_NAME='staging';
  try{
    const fakeHeaders={'oai-authenticated-user-id':'forged-admin'};
    const a=await GET(req('GET',undefined,undefined,fakeHeaders));
    assert.equal(a.status,403);
    const b=await POST(req('POST',{action:'createLead',key:randomUUID()},undefined,fakeHeaders));
    assert.equal(b.status,403);
    assert.equal((await read(b)).code,'STAGING_PRIVATE_ACCESS_REQUIRED');
  }finally{
    if(prior===undefined)delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME=prior;
  }
});

test('real PostgreSQL CRM lifecycle isolates owners and validates every transition',async()=>{
  await cleanup();
  const firstGet=await GET(req('GET',undefined,owner));
  assert.equal(firstGet.status,200);
  assert.deepEqual((await read(firstGet)).leads,[]);
  const payload={
    action:'createLead',key:randomUUID(),lead:{
      id:leadId,contactName:'Marina Teste',companyName:'Empresa CI',
      contactEmail:'marina@example.invalid',source:'referral',
    },
  };
  const created=await send(payload);
  assert.equal(created.status,201,JSON.stringify(await read(created)));
  assert.equal((await read(created)).result.state,'new');

  // Idempotent replays do not create a second lead.
  const replay=await send(payload);
  assert.equal(replay.status,201);
  const otherReplay=await send(payload,other);
  assert.equal(otherReplay.status,409);
  const leadRows=await pool.query('SELECT count(*)::int AS n FROM crm_leads WHERE id=$1',[leadId]);
  assert.equal(leadRows.rows[0].n,1);

  const listOwn=await GET(req('GET',undefined,owner));
  assert.equal(listOwn.status,200);
  assert.equal((await read(listOwn)).leads[0].companyName,'Empresa CI');
  const listOther=await GET(req('GET',undefined,other));
  assert.equal(listOther.status,200);
  assert.deepEqual((await read(listOther)).leads,[]);

  const qualifiedWrongOwner=await send({
    action:'qualifyLead',key:randomUUID(),leadId,expectedVersion:1,
    outcome:'qualified',clientId:null,
  },other);
  assert.equal(qualifiedWrongOwner.status,404);

  const qualifyUnknownClient=await send({
    action:'qualifyLead',key:randomUUID(),leadId,expectedVersion:1,
    outcome:'qualified',clientId:randomUUID(),
  });
  assert.equal(qualifyUnknownClient.status,404);

  // A real, active ERP client is the only permitted client linkage.
  await pool.query('INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
    [clientId,owner,'Cliente ERP CI',now]);
  const qualification={
    action:'qualifyLead',key:randomUUID(),leadId,expectedVersion:1,
    outcome:'qualified',clientId,
  };
  const qualified=await send(qualification);
  assert.equal(qualified.status,200,JSON.stringify(await read(qualified)));
  assert.equal((await read(qualified)).result.rowVersion,2);
  const qualifiedReplay=await send(qualification);
  assert.equal(qualifiedReplay.status,200);
  const stale=await send({...qualification,key:randomUUID()});
  assert.equal(stale.status,409);

  // An opportunity must come from the caller's qualified lead.
  const crossTenantOpportunity=await send({
    action:'createOpportunity',key:randomUUID(),
    opportunity:{id:randomUUID(),leadId,title:'Contato indevido',amountCents:1000},
  },other);
  assert.equal(crossTenantOpportunity.status,404);
  const opportunity={
    action:'createOpportunity',key:randomUUID(),
    opportunity:{id:opportunityId,leadId,title:'Contrato anual de manutenção',amountCents:125050},
  };
  const op=await send(opportunity);
  assert.equal(op.status,201,JSON.stringify(await read(op)));
  const linked=await pool.query('SELECT client_id,stage FROM crm_opportunities WHERE id=$1',[opportunityId]);
  assert.deepEqual(linked.rows[0],{client_id:clientId,stage:'discovery'});

  const illegalJump=await send({
    action:'changeStage',key:randomUUID(),opportunityId,expectedVersion:1,stage:'won',
  });
  assert.equal(illegalJump.status,409);
  for(const [stage,version] of [['proposal',1],['negotiation',2],['won',3]] as const){
    const moved=await send({
      action:'changeStage',key:randomUUID(),opportunityId,expectedVersion:version,stage,
    });
    assert.equal(moved.status,200,JSON.stringify(await read(moved)));
    assert.equal((await read(moved)).result.rowVersion,version+1);
  }
  const closed=await send({
    action:'changeStage',key:randomUUID(),opportunityId,expectedVersion:4,stage:'lost',
  });
  assert.equal(closed.status,409);
  const otherUpdate=await send({
    action:'changeStage',key:randomUUID(),opportunityId,expectedVersion:4,stage:'lost',
  },other);
  assert.equal(otherUpdate.status,404);
  const own=await read(await GET(req('GET',undefined,owner)));
  assert.equal(own.opportunities.length,1);
  assert.equal(own.opportunities[0].amountCents,'125050');
  assert.equal(own.opportunities[0].stage,'won');
  assert.equal(own.clients[0].legalName,'Cliente ERP CI');
  const stranger=await read(await GET(req('GET',undefined,other)));
  assert.deepEqual(stranger.opportunities,[]);
  assert.deepEqual(stranger.clients,[]);
});
