import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as getAccounts,POST as postAccount} from '../../app/api/accounting/accounts/route';
import {GET as getJournals,POST as postJournal} from '../../app/api/accounting/journals/route';
import {GET as journalDetail} from '../../app/api/accounting/journals/[id]/route';
import {POST as reverseJournal} from '../../app/api/accounting/journals/[id]/reverse/route';
import {GET as getLedger} from '../../app/api/accounting/ledger/route';
import {GET as getRules,POST as postRule} from '../../app/api/accounting/rules/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('Accounting integration must use isolated test PostgreSQL');

const pool=new Pool({connectionString:process.env.DATABASE_URL});
const actor=randomUUID(),outsider=randomUUID();
function request(identity:string,path:string,method='GET',body?:unknown){
  const r=new Request('http://localhost'+path,{
    method,headers:body===undefined?undefined:{'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return setTestIdentity(r,identity);
}
type ApiJson={replayed:boolean;error?:string;items:Array<Record<string,unknown>>;lines:unknown[];totals:{closingScaled:string}};
async function read(response:Response){return await response.json() as ApiJson;}
after(async()=>{
  await pool.query('DELETE FROM accounting_event_rules WHERE actor_id=$1',[actor]);
  await pool.query('DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE actor_id=$1)',[actor]);
  await pool.query('DELETE FROM journal_entries WHERE actor_id=$1',[actor]);
  await pool.query('DELETE FROM chart_accounts WHERE actor_id=$1',[actor]);
  await closeDatabase();
  await pool.end();
});

test('accounting event rules are owner-scoped, validate active accounts and replay idempotently',async()=>{
  const debit=randomUUID(),credit=randomUUID(),ruleId=randomUUID(),suffix=randomUUID().slice(0,8);
  for(const item of [{id:debit,code:'R'+suffix+'A',name:'Regra débito',type:'asset'},{id:credit,code:'R'+suffix+'B',name:'Regra crédito',type:'revenue'}]){
    const response=await postAccount(request(actor,'/api/accounting/accounts','POST',item));
    assert.equal(response.status,201,JSON.stringify(await read(response)));
  }
  const body={id:ruleId,eventType:'receivable_settlement',debitAccountId:debit,creditAccountId:credit};
  const created=await postRule(request(actor,'/api/accounting/rules','POST',body));
  assert.equal(created.status,201,JSON.stringify(await read(created)));
  const replay=await postRule(request(actor,'/api/accounting/rules','POST',body));
  assert.equal(replay.status,200);
  assert.equal((await read(replay)).replayed,true);
  const listed=await getRules(request(actor,'/api/accounting/rules'));
  assert.equal(listed.status,200);
  assert.equal(((await read(listed)).items as Array<Record<string,unknown>>).some(x=>x.id===ruleId),true);
  const outsiderRules=await getRules(request(outsider,'/api/accounting/rules'));
  assert.equal(((await read(outsiderRules)).items as Array<unknown>).length,0);
  const conflict=await postRule(request(actor,'/api/accounting/rules','POST',{...body,id:randomUUID(),creditAccountId:debit}));
  assert.equal(conflict.status,400);
  await pool.query('DELETE FROM accounting_event_rules WHERE id=$1',[ruleId]);
  await pool.query('DELETE FROM chart_accounts WHERE id IN ($1,$2)',[debit,credit]);
});

test('accounting full lifecycle: owned accounts, balanced posting, ledger, immutable reversal',async()=>{
  const debit=randomUUID(),credit=randomUUID(),journalId=randomUUID(),reverseId=randomUUID();
  const suffix=randomUUID().slice(0,8);
  const a={id:debit,code:'C'+suffix+'A',name:'Ativo sintético',type:'asset'};
  const b={id:credit,code:'C'+suffix+'B',name:'Receita sintética',type:'revenue'};
  for(const item of [a,b]){
    const result=await postAccount(request(actor,'/api/accounting/accounts','POST',item));
    assert.equal(result.status,201,JSON.stringify(await read(result)));
  }
  const replay=await postAccount(request(actor,'/api/accounting/accounts','POST',a));
  assert.equal(replay.status,200);
  assert.equal((await read(replay)).replayed,true);
  const forbidden=await getAccounts(request(outsider,'/api/accounting/accounts'));
  assert.equal(forbidden.status,200);
  assert.equal(((await read(forbidden)).items as Array<unknown>).length,0);
  const own=await getAccounts(request(actor,'/api/accounting/accounts'));
  assert.equal(((await read(own)).items as Array<unknown>).length,2);
  const lines=[
    {id:randomUUID(),accountId:debit,side:'debit',amount:'17,2500'},
    {id:randomUUID(),accountId:credit,side:'credit',amount:'17,2500'},
  ];
  const posted={id:journalId,effectiveDate:'2026-11-17',sourceReference:'E2E-SYNTHETIC',
    description:'Fato contábil sintético',lines};
  const invalid=await postJournal(request(actor,'/api/accounting/journals','POST',{
    ...posted,lines:[lines[0],{...lines[1],amount:'16,2500'}],
  }));
  assert.equal(invalid.status,400,JSON.stringify(await read(invalid)));
  const absent=await pool.query('SELECT id FROM journal_entries WHERE id=$1',[journalId]);
  assert.equal(absent.rowCount,0,'unbalanced attempt must not persist');
  const crossOwner=await postJournal(request(outsider,'/api/accounting/journals','POST',posted));
  assert.equal(crossOwner.status,409);
  const created=await postJournal(request(actor,'/api/accounting/journals','POST',posted));
  assert.equal(created.status,201,JSON.stringify(await read(created)));
  const replayPost=await postJournal(request(actor,'/api/accounting/journals','POST',posted));
  assert.equal(replayPost.status,200);
  const list=await getJournals(request(actor,'/api/accounting/journals?page=1'));
  assert.equal(list.status,200);
  const found=((await read(list)).items as Array<Record<string,unknown>>).find(x=>x.id===journalId);
  assert.equal(found?.debitScaled,'172500');
  assert.equal(found?.creditScaled,'172500');
  const ownerDetail=await journalDetail(request(actor,'/api/accounting/journals/'+journalId),
    {params:Promise.resolve({id:journalId})});
  assert.equal(ownerDetail.status,200);
  assert.equal(((await read(ownerDetail)).lines as Array<unknown>).length,2);
  const otherDetail=await journalDetail(request(outsider,'/api/accounting/journals/'+journalId),
    {params:Promise.resolve({id:journalId})});
  assert.equal(otherDetail.status,404);
  const ledger1=await getLedger(request(actor,'/api/accounting/ledger?accountId='+debit+'&page=1'));
  assert.equal(ledger1.status,200);
  assert.equal((await read(ledger1)).totals.closingScaled,'172500');
  const reversal={key:reverseId,effectiveDate:'2026-11-18',sourceReference:'E2E-REVERSAL',
    description:'Estorno sintético controlado'};
  const reversed=await reverseJournal(request(actor,'/api/accounting/journals/'+journalId+'/reverse','POST',reversal),
    {params:Promise.resolve({id:journalId})});
  assert.equal(reversed.status,201,JSON.stringify(await read(reversed)));
  const replayReversal=await reverseJournal(
    request(actor,'/api/accounting/journals/'+journalId+'/reverse','POST',reversal),
    {params:Promise.resolve({id:journalId})});
  assert.equal(replayReversal.status,200);
  const doubleReverse=await reverseJournal(
    request(actor,'/api/accounting/journals/'+journalId+'/reverse','POST',
      {...reversal,key:randomUUID()}),
    {params:Promise.resolve({id:journalId})});
  assert.equal(doubleReverse.status,409);
  const ledger2=await getLedger(request(actor,'/api/accounting/ledger?accountId='+debit+'&page=1'));
  assert.equal((await read(ledger2)).totals.closingScaled,'0');
  const persisted=await pool.query(
    'SELECT status,expected_count FROM journal_entries WHERE id=$1',[journalId],
  );
  assert.equal(persisted.rows[0]?.status,'posted');
  assert.equal(persisted.rows[0]?.expected_count,2);
  const reversals=await pool.query('SELECT COUNT(*)::int AS n FROM journal_entries WHERE reversal_of=$1',[journalId]);
  assert.equal(reversals.rows[0].n,1);
});
