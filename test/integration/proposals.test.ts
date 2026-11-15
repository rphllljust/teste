import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as listProposals, POST as createProposal} from '../../app/api/proposals/route';
import {GET as detailProposal} from '../../app/api/proposals/[id]/route';
import {POST as proposalCommand} from '../../app/api/proposals/[id]/commands/route';

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


test('proposal lifecycle enforces row versions, idempotence, evidence and total consistency',async()=>{
  // The first case created a persisted draft with owner-specific lines.
  const route={params:Promise.resolve({id:proposalId})};
  const call=(payload:object,actor=owner)=>proposalCommand(
    req('POST','/api/proposals/'+proposalId+'/commands',actor,payload),route);
  const initial=await detailProposal(req('GET','/api/proposals/'+proposalId,owner),route);
  const first=(await initial.json() as {projection:{
    availableCommands:Array<{id:string}>;state:{rowVersion:number}
  }}).projection;
  assert.equal(first.state.rowVersion,1);
  assert.deepEqual(first.availableCommands.map(c=>c.id),['revise','issue','cancel']);
  const invalidAccept=await call({key:randomUUID(),version:1,command:'accept',reference:'REF-TESTE-001'});
  assert.equal(invalidAccept.status,409);
  const forged=await call({key:randomUUID(),version:1,command:'issue'},outsider);
  assert.equal(forged.status,404);

  const revision={key:randomUUID(),version:1,command:'revise',data:{
    title:'Contrato anual revisado',scope:'Entrega comercial revisada e validada',
    validUntil:'2099-12-31',
    lines:[{description:'Visita inicial',unit:'un',quantity:'2',unitPrice:'200,00'},
      {description:'Revisão documental',unit:'un',quantity:'1',unitPrice:'75,50'}],
  }};
  const revised=await call(revision);
  assert.equal(revised.status,200,JSON.stringify(await revised.clone().json()));
  assert.equal((await revised.json() as {resource:{rowVersion:number}}).resource.rowVersion,2);
  assert.equal((await call(revision)).status,200);
  assert.equal((await call({...revision,key:randomUUID()})).status,409);
  const rows=await pool.query('SELECT total,row_version,status FROM proposals WHERE id=$1',[proposalId]);
  assert.equal(rows.rows[0].total,4755000);
  assert.equal(rows.rows[0].row_version,2);
  assert.equal(rows.rows[0].status,'draft');
  const line=await pool.query('SELECT count(*)::int AS n,sum(amount)::int AS sum FROM proposal_lines WHERE proposal_id=$1',[proposalId]);
  assert.equal(line.rows[0].n,2);
  assert.equal(line.rows[0].sum,4755000);

  const issue={key:randomUUID(),version:2,command:'issue'};
  const issued=await call(issue);
  assert.equal(issued.status,200,JSON.stringify(await issued.clone().json()));
  assert.equal((await issued.json() as {state:string}).state,'issued');
  assert.equal((await call(issue)).status,200);
  assert.equal((await call({...issue,key:randomUUID()})).status,409);
  assert.equal((await call({key:randomUUID(),version:3,command:'revise',data:revision.data})).status,409);
  assert.equal((await call({key:randomUUID(),version:3,command:'accept',reference:''})).status,400);

  const evidence={key:randomUUID(),version:3,command:'accept',reference:'ACEITE-DECLARADO-CI-001'};
  const accepted=await call(evidence);
  assert.equal(accepted.status,200);
  assert.equal((await accepted.json() as {resource:{rowVersion:number};state:string}).state,'accepted');
  assert.equal((await call(evidence)).status,200);
  assert.equal((await call({key:randomUUID(),version:4,command:'reject'})).status,409);
  assert.equal((await call({key:randomUUID(),version:4,command:'cancel'})).status,409);
  const done=await pool.query(
    'SELECT status,row_version,evidence_reference,total FROM proposals WHERE id=$1',[proposalId]);
  assert.deepEqual(done.rows[0],{status:'accepted',row_version:4,
    evidence_reference:'ACEITE-DECLARADO-CI-001',total:4755000});
  const detail=await detailProposal(req('GET','/api/proposals/'+proposalId,owner),route);
  const body=(await detail.json() as {projection:{
    state:{code:string};availableCommands:Array<{id:string}>;history:Array<{command:string}>
  }}).projection;
  assert.equal(body.state.code,'accepted');
  assert.deepEqual(body.availableCommands,[]);
  assert.ok(body.history.some(e=>e.command==='accept'));
});

test('proposal rejects, cancels and expires only from legal states',async()=>{
  const baseData={
    title:'Proposta de manutenção',scope:'Serviços preventivos e corretivos',
    validUntil:'2099-12-31',
    lines:[{description:'Revisão técnica',unit:'un',quantity:'1',unitPrice:'120,00'}],
  };
  const register=async(id:string)=>createProposal(req('POST','/api/proposals',owner,
    {id,clientId,clientVersion:1,data:baseData}));
  const act=(id:string,body:object)=>proposalCommand(
    req('POST','/api/proposals/'+id+'/commands',owner,body),
    {params:Promise.resolve({id})});
  const rejectedId=randomUUID();
  assert.equal((await register(rejectedId)).status,201);
  assert.equal((await act(rejectedId,{key:randomUUID(),version:1,command:'issue'})).status,200);
  assert.equal((await act(rejectedId,{key:randomUUID(),version:2,command:'reject'})).status,200);
  assert.equal((await act(rejectedId,{key:randomUUID(),version:3,command:'cancel'})).status,409);
  const rejected=await pool.query('SELECT status FROM proposals WHERE id=$1',[rejectedId]);
  assert.equal(rejected.rows[0].status,'rejected');

  const cancelledId=randomUUID();
  assert.equal((await register(cancelledId)).status,201);
  assert.equal((await act(cancelledId,{key:randomUUID(),version:1,command:'cancel'})).status,200);
  assert.equal((await act(cancelledId,{key:randomUUID(),version:2,command:'issue'})).status,409);
  const cancelled=await pool.query('SELECT status FROM proposals WHERE id=$1',[cancelledId]);
  assert.equal(cancelled.rows[0].status,'cancelled');

  const expiredId=randomUUID();
  assert.equal((await register(expiredId)).status,201);
  assert.equal((await act(expiredId,{key:randomUUID(),version:1,command:'issue'})).status,200);
  // Model the clock crossing a validity date without changing the version.
  await pool.query("UPDATE proposals SET valid_until='2000-01-01' WHERE id=$1",[expiredId]);
  assert.equal((await act(expiredId,{key:randomUUID(),version:2,
    command:'accept',reference:'REF-EXPIRADO-001'})).status,409);
  assert.equal((await act(expiredId,{key:randomUUID(),version:2,command:'expire'})).status,200);
  assert.equal((await act(expiredId,{key:randomUUID(),version:3,command:'expire'})).status,409);
  const expired=await pool.query('SELECT status,row_version FROM proposals WHERE id=$1',[expiredId]);
  assert.deepEqual(expired.rows[0],{status:'expired',row_version:3});
});

test('simultaneous proposal issue commands cannot both commit',async()=>{
  const id=randomUUID();
  const create=await createProposal(req('POST','/api/proposals',owner,{id,clientId,clientVersion:1,
    data:{title:'Proposta concorrente',scope:'Serviços técnicos',
      validUntil:'2099-12-31',lines:[{description:'Inspeção',unit:'un',quantity:'1',unitPrice:'90'}]}}));
  assert.equal(create.status,201);
  const route={params:Promise.resolve({id})};
  const payload=()=>({key:randomUUID(),version:1,command:'issue'});
  const [first,second]=await Promise.all([
    proposalCommand(req('POST','/api/proposals/'+id+'/commands',owner,payload()),route),
    proposalCommand(req('POST','/api/proposals/'+id+'/commands',owner,payload()),route),
  ]);
  assert.deepEqual([first.status,second.status].sort(),[200,409]);
  const state=await pool.query('SELECT status,row_version FROM proposals WHERE id=$1',[id]);
  assert.deepEqual(state.rows[0],{status:'issued',row_version:2});
  const issued=await pool.query("SELECT count(*)::int AS n FROM business_commands WHERE entity_id=$1 AND command='issue'",[id]);
  assert.equal(issued.rows[0].n,1);
});
