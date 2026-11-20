import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { POST as loginStaging } from '../../app/api/auth/staging-login/route';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { GET, POST } from '../../app/api/crm/route';
import { GET as proposalDetail } from '../../app/api/proposals/[id]/route';
import { GET as opportunityDetail } from '../../app/api/crm/opportunities/[id]/route';

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
type TestBody={
  error?:string; code?:string;
  result:{id:string;state:string;rowVersion:number};
  leads:Array<{companyName:string}>;
  opportunities:Array<{amountCents:string;stage:string;proposalId:string|null;proposalStatus:string|null}>;
  clients:Array<{legalName:string}>;
};
const read=async(r:Response)=>r.clone().json() as Promise<TestBody>;
const send=(body:unknown,actor=owner)=>POST(req('POST',body,actor));
async function cleanup(){
  // Proposal-origin links and proposal lines must be removed before their FK parents.
  await pool.query('DELETE FROM crm_opportunity_proposals WHERE owner_id=$1 OR owner_id=$2',[owner,other]);
  await pool.query('DELETE FROM proposal_lines WHERE proposal_id IN (SELECT id FROM proposals WHERE owner_id=$1 OR owner_id=$2)',[owner,other]);
  await pool.query('DELETE FROM proposals WHERE owner_id=$1 OR owner_id=$2',[owner,other]);
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
  const bridge=await pool.query("SELECT id FROM _cisne_schema_migrations WHERE id='0002_crm_proposal_origin'");
  assert.equal(bridge.rows.length,1);
  const link=await pool.query("SELECT to_regclass('public.crm_opportunity_proposals') AS t");
  assert.equal(link.rows[0].t,'crm_opportunity_proposals');
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


test('real staging login issues a verified cookie; owner comes from session, never from spoofed headers',async()=>{
  const names=['RAILWAY_ENVIRONMENT_NAME','CISNE_STAGING_PUBLIC_ORIGIN',
    'CISNE_STAGING_LOGIN_HASH','CISNE_STAGING_SESSION_SECRET','CISNE_STAGING_ACTOR_ID'] as const;
  const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const origin='https://cisne-web-staging-staging.up.railway.app';
  const passphrase='CI-fake-strong-passphrase-20261115-42-TEST';
  process.env.RAILWAY_ENVIRONMENT_NAME='staging';
  process.env.CISNE_STAGING_PUBLIC_ORIGIN=origin;
  process.env.CISNE_STAGING_LOGIN_HASH=createHash('sha256').update(passphrase).digest('hex');
  process.env.CISNE_STAGING_SESSION_SECRET='ci-only-staging-hmac-secret-20261115-long-unique';
  process.env.CISNE_STAGING_ACTOR_ID=owner;
  const signIn=(password:string,reqOrigin=origin)=>loginStaging(new Request(origin+'/api/auth/staging-login',{
    method:'POST',headers:{origin:reqOrigin,'content-type':'application/json'},
    body:JSON.stringify({passphrase:password}),
  }));
  try{
    assert.equal((await signIn(passphrase,'https://evil.invalid')).status,403);
    assert.equal((await signIn('not-the-valid-password-12345678')).status,401);
    const response=await signIn(passphrase);
    assert.equal(response.status,200);
    const cookie=response.headers.get('set-cookie')??'';
    assert.match(cookie,/__Host-cisne_staging=/);
    assert.match(cookie,/HttpOnly/);
    assert.match(cookie,/SameSite=Lax/);
    const cookieHeader=cookie.split(';')[0];

    // In-process identity 'other' must be ignored; only the verified cookie
    // binds the owner to the data.
    const secured=await GET(req('GET',undefined,other,{
      cookie:cookieHeader,'oai-authenticated-user-id':other,
    }));
    assert.equal(secured.status,200,JSON.stringify(await read(secured)));
    const body=await read(secured);
    assert.ok(body.leads.some(l=>l.companyName==='Empresa CI'));
    assert.ok(body.opportunities.some(o=>o.stage==='won'));

    const noCookie=await GET(req('GET',undefined,owner));
    assert.equal(noCookie.status,403);
    const wrongCookie=await GET(req('GET',undefined,owner,{cookie:cookieHeader+'tampered'}));
    assert.equal(wrongCookie.status,403);
  }finally{
    for(const name of names){
      if(old[name]===undefined)delete process.env[name];
      else process.env[name]=old[name];
    }
  }
});


test('CRM opportunity creates exactly one tenant-owned ERP proposal draft with traced origin',async()=>{
  await cleanup();
  const draftLead=randomUUID(),draftOpportunity=randomUUID(),proposalId=randomUUID();
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Porto_Velho'});
  const validUntil='2027-03-10';
  assert.ok(validUntil>=today);
  const clientCreated=await pool.query(
    'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4) RETURNING id',
    [clientId,owner,'Cliente ERP comercial CI',now],
  );
  assert.equal(clientCreated.rowCount,1);
  const newLead=await send({action:'createLead',key:randomUUID(),lead:{
    id:draftLead,contactName:'Lia Comercial',companyName:'Empresa de Serviço CI',
    contactEmail:null,source:'manual',
  }});
  assert.equal(newLead.status,201);
  const qual=await send({action:'qualifyLead',key:randomUUID(),leadId:draftLead,
    expectedVersion:1,outcome:'qualified',clientId});
  assert.equal(qual.status,200);
  const opCreated=await send({action:'createOpportunity',key:randomUUID(),opportunity:{
    id:draftOpportunity,leadId:draftLead,title:'Manutenção anual',amountCents:125050,
  }});
  assert.equal(opCreated.status,201);
  const early=await send({action:'createDraftProposal',key:randomUUID(),
    opportunityId:draftOpportunity,proposalId:randomUUID(),expectedVersion:1,
    scope:'Atendimento conforme escopo validado em CRM',validUntil});
  assert.equal(early.status,409,'must enter proposal stage before conversion');
  const moved=await send({action:'changeStage',key:randomUUID(),opportunityId:draftOpportunity,
    expectedVersion:1,stage:'proposal'});
  assert.equal(moved.status,200);
  assert.equal((await read(moved)).result.rowVersion,2);

  const draft={action:'createDraftProposal',key:randomUUID(),
    opportunityId:draftOpportunity,proposalId,expectedVersion:2,
    scope:'Atendimento de manutenção preventiva anual em equipamentos',validUntil};
  const foreign=await send(draft,other);
  assert.equal(foreign.status,404);
  const stale=await send({...draft,key:randomUUID(),expectedVersion:1});
  assert.equal(stale.status,409);
  const expired=await send({...draft,key:randomUUID(),validUntil:'2000-01-01'});
  assert.equal(expired.status,400);
  const response=await send(draft);
  assert.equal(response.status,201,JSON.stringify(await read(response)));
  assert.equal((await read(response)).result.state,'draft');
  assert.equal((await read(response)).result.id,proposalId);
  const replay=await send(draft);
  assert.equal(replay.status,201);
  assert.equal((await read(replay)).result.id,proposalId);
  const duplicate=await send({...draft,key:randomUUID(),proposalId:randomUUID()});
  assert.equal(duplicate.status,409);

  const linked=await pool.query(
    `SELECT p.id,p.owner_id,p.client_id,p.status,p.total,p.valid_until,p.scope,
      b.opportunity_id,b.command_key,l.quantity,l.unit_price,l.amount
     FROM proposals p JOIN crm_opportunity_proposals b ON p.id=b.proposal_id
     JOIN proposal_lines l ON l.proposal_id=p.id
     WHERE p.id=$1`,[proposalId]);
  assert.equal(linked.rows.length,1);
  assert.equal(linked.rows[0].owner_id,owner);
  assert.equal(linked.rows[0].client_id,clientId);
  assert.equal(linked.rows[0].status,'draft');
  assert.equal(linked.rows[0].total,12505000);
  assert.equal(linked.rows[0].quantity,1000000);
  assert.equal(linked.rows[0].unit_price,12505000);
  assert.equal(linked.rows[0].amount,12505000);
  assert.equal(linked.rows[0].opportunity_id,draftOpportunity);
  assert.equal(linked.rows[0].command_key,draft.key);
  assert.equal(linked.rows[0].valid_until,validUntil);
  assert.equal(linked.rows[0].scope,draft.scope);
  const detail=await proposalDetail(req('GET',undefined,owner),{params:Promise.resolve({id:proposalId})});
  assert.equal(detail.status,200);
  const projection=(await detail.json() as {
    projection:{id:string;totalScaled:string;lines:Array<{amountScaled:string}>;
      origin:{opportunityId:string}|null;availableCommands:unknown[]};
  }).projection;
  assert.equal(projection.id,proposalId);
  assert.equal(projection.totalScaled,'12505000');
  assert.equal(projection.lines[0].amountScaled,'12505000');
  assert.equal(projection.origin?.opportunityId,draftOpportunity);
  assert.deepEqual(projection.availableCommands.map(c=>(c as {id:string}).id),['revise','issue','cancel']);
  const opportunityContext=await opportunityDetail(req('GET',undefined,owner),{
    params:Promise.resolve({id:draftOpportunity}),
  });
  assert.equal(opportunityContext.status,200);
  const opportunityProjection=(await opportunityContext.json() as {
    projection:{title:string;client:{legalName:string}|null;proposal:{id:string;status:string}|null;
      history:Array<{action:string}>};
  }).projection;
  assert.equal(opportunityProjection.title,'Manutenção anual');
  assert.equal(opportunityProjection.client?.legalName,'Cliente ERP comercial CI');
  assert.deepEqual(opportunityProjection.proposal,{id:proposalId,status:'draft',total:'12505000',validUntil});
  assert.ok(opportunityProjection.history.some(event=>event.action==='createDraftProposal'));
  const deniedOpportunity=await opportunityDetail(req('GET',undefined,other),{
    params:Promise.resolve({id:draftOpportunity}),
  });
  assert.equal(deniedOpportunity.status,404);
  const deniedDetail=await proposalDetail(req('GET',undefined,other),{params:Promise.resolve({id:proposalId})});
  assert.equal(deniedDetail.status,404);

  const ownerResult=await read(await GET(req('GET',undefined,owner)));
  const ownOpportunity=ownerResult.opportunities
    .find(o=>o.proposalId===proposalId);
  assert.equal(ownOpportunity?.proposalStatus,'draft');
  const otherResult=await read(await GET(req('GET',undefined,other)));
  assert.equal(otherResult.opportunities.length,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM crm_opportunity_proposals WHERE owner_id=$1',[owner])).rows[0].n,1);
  await assert.rejects(pool.query(
    `INSERT INTO crm_opportunity_proposals(owner_id,opportunity_id,proposal_id,command_key,created_at)
     VALUES($1,$2,$3,$4,$5)`,
    [other,draftOpportunity,randomUUID(),randomUUID(),now],
  ));
});
