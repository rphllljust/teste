import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as listAccounts, POST as createAccount} from '../../app/api/accounting/accounts/route';
import {GET as listJournals, POST as createJournal} from '../../app/api/accounting/journals/route';
import {GET as getJournal} from '../../app/api/accounting/journals/[id]/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('NO-GO: accounting ownership tests require isolated PostgreSQL');
const url=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname)||
   !['/cisne_test','/cisne_ci'].includes(url.pathname)||url.port!=='5432')
  throw new Error('NO-GO: refusing accounting ownership tests outside disposable CI database');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const ownerA=randomUUID(),ownerB=randomUUID();
const debitA=randomUUID(),creditA=randomUUID(),debitB=randomUUID();
const acceptedId=randomUUID(),rejectedId=randomUUID(),rejectedByBId=randomUUID();
const accountIds=[debitA,creditA,debitB];
function request(method:'GET'|'POST',path:string,identity:string,body?:unknown){
  return setTestIdentity(new Request('http://localhost'+path,{
    method,headers:{'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }),identity);
}
function account(id:string,code:string,type:string){
  return {id,code,name:'Conta sintética isolada '+code,type};
}
function journal(id:string,firstAccountId:string,secondAccountId:string){
  return {
    id,effectiveDate:'2026-11-22',sourceReference:'CI-ACCOUNT-OWNER-'+id,
    description:'Lançamento de isolamento entre proprietários',
    lines:[
      {id:randomUUID(),accountId:firstAccountId,side:'debit',amount:'100,00'},
      {id:randomUUID(),accountId:secondAccountId,side:'credit',amount:'100,00'},
    ],
  };
}
after(async()=>{
  try{
    await pool.query('DELETE FROM journal_lines WHERE entry_id=ANY($1::text[])',[[acceptedId,rejectedId,rejectedByBId]]);
    await pool.query('DELETE FROM journal_entries WHERE id=ANY($1::text[])',[[acceptedId,rejectedId,rejectedByBId]]);
    await pool.query('DELETE FROM chart_accounts WHERE id=ANY($1::text[])',[accountIds]);
  }finally{await closeDatabase();await pool.end();}
});

test('active accounting accounts are private; journal posting refuses cross-owner references and persists owned lines',async()=>{
  const suffix=randomUUID().slice(0,12);
  assert.equal((await createAccount(request('POST','/api/accounting/accounts',ownerA,account(debitA,'CIA-'+suffix,'asset')))).status,201);
  assert.equal((await createAccount(request('POST','/api/accounting/accounts',ownerA,account(creditA,'CIB-'+suffix,'revenue')))).status,201);
  assert.equal((await createAccount(request('POST','/api/accounting/accounts',ownerB,account(debitB,'CIC-'+suffix,'asset')))).status,201);

  const listA=await listAccounts(request('GET','/api/accounting/accounts',ownerA));
  assert.equal(listA.status,200);
  const accountsA=(await listA.json() as {items:{id:string}[]}).items.map(r=>r.id);
  assert.ok(accountsA.includes(debitA));
  assert.ok(accountsA.includes(creditA));
  assert.ok(!accountsA.includes(debitB),'active foreign account must never appear in listing');
  const listB=await listAccounts(request('GET','/api/accounting/accounts',ownerB));
  const accountsB=(await listB.json() as {items:{id:string}[]}).items.map(r=>r.id);
  assert.ok(accountsB.includes(debitB));
  assert.ok(!accountsB.includes(debitA));
  assert.ok(!accountsB.includes(creditA));

  const forgedByA=await createJournal(request('POST','/api/accounting/journals',ownerA,journal(rejectedId,debitB,creditA)));
  assert.equal(forgedByA.status,400,'owner A cannot journal with owner B account');
  const forgedByB=await createJournal(request('POST','/api/accounting/journals',ownerB,journal(rejectedByBId,debitA,debitB)));
  assert.equal(forgedByB.status,400,'owner B cannot journal with owner A account');
  const denied=await pool.query('SELECT count(*)::int AS n FROM journal_entries WHERE id=ANY($1::text[])',[[rejectedId,rejectedByBId]]);
  assert.equal(denied.rows[0].n,0,'rejected posting must not persist any header');

  const accepted=await createJournal(request('POST','/api/accounting/journals',ownerA,journal(acceptedId,debitA,creditA)));
  assert.equal(accepted.status,201,JSON.stringify(await accepted.clone().json()));
  const persisted=await pool.query(
    'SELECT j.actor_id,a.actor_id AS account_actor,l.debit,l.credit FROM journal_lines l JOIN journal_entries j ON j.id=l.entry_id JOIN chart_accounts a ON a.id=l.account_id WHERE j.id=$1 ORDER BY l.id',
    [acceptedId],
  );
  assert.equal(persisted.rowCount,2);
  assert.ok(persisted.rows.every(r=>r.actor_id===ownerA&&r.account_actor===ownerA));
  assert.equal(persisted.rows.reduce((n,r)=>n+Number(r.debit),0),1000000);
  assert.equal(persisted.rows.reduce((n,r)=>n+Number(r.credit),0),1000000);

  const invisible=await getJournal(request('GET','/api/accounting/journals/'+acceptedId,ownerB),{
    params:Promise.resolve({id:acceptedId}),
  });
  assert.equal(invisible.status,404,'other owner must not read journal detail');
  const foreignList=await listJournals(request('GET','/api/accounting/journals',ownerB));
  assert.equal(foreignList.status,200);
  assert.ok(!(await foreignList.json() as {items:{id:string}[]}).items.some(r=>r.id===acceptedId));
  assert.equal((await getJournal(request('GET','/api/accounting/journals/'+acceptedId,ownerA),{
    params:Promise.resolve({id:acceptedId}),
  })).status,200);
});
