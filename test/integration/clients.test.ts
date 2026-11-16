import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as listClients,POST as registerClient} from '../../app/api/clients/route';
import {GET as readClient} from '../../app/api/clients/[id]/route';
import {POST as commandClient} from '../../app/api/clients/[id]/commands/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('Client tests require NODE_ENV=test and a disposable PostgreSQL URL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const actor=randomUUID(),stranger=randomUUID(),clientId=randomUUID();
function req(method:'GET'|'POST',path:string,identity:string|undefined,payload?:unknown){
  const request=new Request('http://localhost'+path,{method,
    headers:{'content-type':'application/json'},
    body:payload?JSON.stringify(payload):undefined});
  return identity?setTestIdentity(request,identity):request;
}
async function cleanup(){
  await pool.query('DELETE FROM business_commands WHERE actor_id=$1',[actor]);
  await pool.query('DELETE FROM clients WHERE owner_id=$1',[actor]);
}
after(async()=>{await cleanup();await pool.end();});
const route={params:Promise.resolve({id:clientId})};

test('client API persists owner-scoped data and supports secure versioned commands',async()=>{
  await cleanup();
  const data={legalName:'Empresa Integração CI',tradeName:'Integracao',
    document:'12.345.678/0001-90',email:'contato@example.invalid',phone:null};
  const input={id:clientId,data};
  const created=await registerClient(req('POST','/api/clients',actor,input));
  assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
  assert.equal((await registerClient(req('POST','/api/clients',actor,input))).status,201);
  assert.equal((await registerClient(req('POST','/api/clients',stranger,input))).status,409);
  const own=await listClients(req('GET','/api/clients?q=Integra%C3%A7%C3%A3o&status=active&sort=name.asc',actor));
  assert.equal(own.status,200);
  const listed=await own.json() as {items:Array<{id:string;document:string;state:{rowVersion:number}}>;pageInfo:{total:number}};
  assert.equal(listed.pageInfo.total,1);
  assert.equal(listed.items[0].id,clientId);
  assert.equal(listed.items[0].document,'12345678000190');
  assert.equal(listed.items[0].state.rowVersion,1);
  const notOwner=await listClients(req('GET','/api/clients',stranger));
  assert.deepEqual((await notOwner.json() as {items:unknown[]}).items,[]);
  const context=await readClient(req('GET','/api/clients/'+clientId,actor),route);
  assert.equal(context.status,200);
  const result=await context.json() as {projection:{
    related:{orders:{total:number}};
    availableCommands:Array<{id:string}>;history:Array<{command:string}>;
  }};
  assert.equal(result.projection.related.orders.total,0);
  assert.ok(result.projection.availableCommands.some(c=>c.id==='revise'));
  assert.equal((await readClient(req('GET','/api/clients/'+clientId,stranger),route)).status,404);

  const rename={key:randomUUID(),version:1,command:'revise' as const,data:{
    ...data,legalName:'Empresa Revisada CI',
  }};
  const revised=await commandClient(req('POST','/api/clients/'+clientId+'/commands',actor,rename),route);
  assert.equal(revised.status,200,JSON.stringify(await revised.clone().json()));
  const body=await revised.json() as {resource:{rowVersion:number}};
  assert.equal(body.resource.rowVersion,2);
  assert.equal((await commandClient(req('POST','/api/clients/'+clientId+'/commands',actor,rename),route)).status,200);
  const stale=await commandClient(req('POST','/api/clients/'+clientId+'/commands',actor,
    {...rename,key:randomUUID()}),route);
  assert.equal(stale.status,409);
  const disabled=await commandClient(req('POST','/api/clients/'+clientId+'/commands',actor,
    {key:randomUUID(),version:2,command:'deactivate'}),route);
  assert.equal(disabled.status,200);
  const invalidRepeat=await commandClient(req('POST','/api/clients/'+clientId+'/commands',actor,
    {key:randomUUID(),version:3,command:'deactivate'}),route);
  assert.equal(invalidRepeat.status,409);
  const activated=await commandClient(req('POST','/api/clients/'+clientId+'/commands',actor,
    {key:randomUUID(),version:3,command:'activate'}),route);
  assert.equal(activated.status,200);
  assert.equal((await commandClient(req('POST','/api/clients/'+clientId+'/commands',stranger,
    {key:randomUUID(),version:4,command:'deactivate'}),route)).status,404);
  const saved=await pool.query('SELECT legal_name,status,row_version FROM clients WHERE id=$1',[clientId]);
  assert.deepEqual(saved.rows[0],{legal_name:'Empresa Revisada CI',status:'active',row_version:4});
});

test('forged request headers cannot enable public staging client mutations',async()=>{
  const prior=process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.RAILWAY_ENVIRONMENT_NAME='staging';
  try{
    const forged=new Request('http://localhost/api/clients',{method:'POST',
      headers:{'oai-authenticated-user-id':actor,'content-type':'application/json'},
      body:JSON.stringify({id:randomUUID(),data:{legalName:'Fake',tradeName:null,document:null,email:null,phone:null}})});
    assert.equal((await registerClient(forged)).status,403);
  }finally{
    if(prior===undefined)delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME=prior;
  }
});
