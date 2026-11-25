import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as reconciliation} from '../../app/api/accounting/reconciliation/route';
import {POST as postJournal} from '../../app/api/accounting/journals/route';
import {POST as linkInvoice} from '../../app/api/accounting/invoice-links/route';
import {POST as reverseJournal} from '../../app/api/accounting/journals/[id]/reverse/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw Error('Isolated PostgreSQL required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owners=[randomUUID(),randomUUID()];
const orderIds=[randomUUID(),randomUUID()],measurementIds=[randomUUID(),randomUUID()],invoiceIds=[randomUUID(),randomUUID()];
const receivableId=randomUUID(), debitAccount=randomUUID(),creditAccount=randomUUID(),journalId=randomUUID();
const url='http://localhost/api/accounting/reconciliation';
const request=(actor:string)=>setTestIdentity(new Request(url),actor);
before(async()=>{
  for(let i=0;i<2;i++){
    const now=new Date().toISOString();
    await pool.query(
      "INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at,status) VALUES($1,$2,'CI order','CI client','Service','CI', $3,'completed')",
      [orderIds[i],owners[i],now],
    );
    await pool.query(
      "INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,'CI measurement',$3,'approved',$4)",
      [measurementIds[i],orderIds[i],i===0?125000:91000,now],
    );
    await pool.query(
      'INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [invoiceIds[i],measurementIds[i],orderIds[i],i===0?125000:91000,'2027-02-01',now],
    );
  }
  const now=new Date().toISOString();
  await pool.query(
    "INSERT INTO chart_accounts(id,code,name,type,created_at,actor_id,request_hash) VALUES($1,$1,'CI AR','asset',$3,$2,'ci'),($4,$4,'CI revenue','revenue',$3,$2,'ci')",
    [debitAccount,owners[0],now,creditAccount],
  );
  await pool.query(
    'INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
    [receivableId,invoiceIds[0],125000,'2027-02-01',new Date().toISOString()],
  );
});
after(async()=>{
  // A throwaway CI database is required: links are immutable under UPDATE/DELETE.
  // TRUNCATE is reserved for isolated ephemeral test schemas, never production.
  const u=new URL(process.env.DATABASE_URL!);
  if(!['localhost','127.0.0.1'].includes(u.hostname)||!['/cisne_test','/cisne_ci'].includes(u.pathname))
    throw new Error('Refuse to clean immutable link fixture outside disposable test DB');
  await pool.query('TRUNCATE accounting_invoice_links');
  await pool.query('DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE actor_id=$1)',[owners[0]]);
  await pool.query('DELETE FROM journal_entries WHERE actor_id=$1',[owners[0]]);
  await pool.query('DELETE FROM business_commands WHERE actor_id=$1',[owners[0]]);
  await pool.query('DELETE FROM finance_audit_events WHERE actor_id=$1',[owners[0]]);
  await pool.query('DELETE FROM chart_accounts WHERE actor_id=$1',[owners[0]]);
  await pool.query('DELETE FROM receivables WHERE id=$1',[receivableId]);
  await pool.query('DELETE FROM invoices WHERE id=ANY($1::text[])',[invoiceIds]);
  await pool.query('DELETE FROM measurements WHERE id=ANY($1::text[])',[measurementIds]);
  await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[orderIds]);
  await closeDatabase();await pool.end();
});
test('reconciliation does not invent accounting links and isolates invoice ownership',async()=>{
  assert.equal((await reconciliation(new Request(url))).status,401);
  const forged=await reconciliation(new Request(url,{headers:{'oai-authenticated-user-id':owners[0]}}));
  assert.equal(forged.status,401);
  const a=await reconciliation(request(owners[0]));
  assert.equal(a.status,200);
  const body=await a.json() as {summary:{invoiceCount:number;withoutVerifiedPostingCount:number;withoutVerifiedPostingAmountScaled:string;missingReceivableCount:number};accountingLinkage:{status:string};items:Array<{invoiceId:string;receivableId:string|null}>};
  assert.equal(body.accountingLinkage.status,'MANUAL_VERIFICATION_AVAILABLE');
  assert.deepEqual(body.summary,{invoiceCount:1,withoutVerifiedPostingCount:1,withoutVerifiedPostingAmountScaled:'125000',missingReceivableCount:0,standaloneJournalCount:0,verifiedPostingCount:0,invoiceAmountScaled:'125000'});
  assert.deepEqual(body.items.map(x=>x.invoiceId),[invoiceIds[0]]);
  const b=await reconciliation(request(owners[1]));
  assert.equal(b.status,200);
  const foreign=await b.json() as typeof body;
  assert.equal(foreign.summary.invoiceCount,1);
  assert.equal(foreign.summary.missingReceivableCount,1);
  assert.deepEqual(foreign.items.map(x=>x.invoiceId),[invoiceIds[1]]);
});


test('manual invoice link enforces same actor, equal journal balance, replay and reversed gap',async()=>{
  const owner=owners[0],stranger=owners[1];
  const journalRequest={
    id:journalId,effectiveDate:'2027-02-01',sourceReference:'CI-INVOICE-LINK',
    description:'Matching the full invoice to A/R and revenue',
    lines:[
      {id:randomUUID(),accountId:debitAccount,debit:'125000',credit:'0'},
      {id:randomUUID(),accountId:creditAccount,debit:'0',credit:'125000'},
    ],
  };
  const request=(actor:string,path:string,body:unknown)=>setTestIdentity(new Request('http://localhost'+path,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),
  }),actor);
  const journal=await postJournal(request(owner,'/api/accounting/journals',journalRequest));
  assert.equal(journal.status,201,JSON.stringify(await journal.clone().json()));
  // Matching numbers without an asset/revenue classification do not certify billing.
  const expenseAccount=randomUUID(),unrelatedId=randomUUID();
  await pool.query(
    "INSERT INTO chart_accounts(id,code,name,type,created_at,actor_id,request_hash) VALUES($1,$1,'CI expense','expense',$2,$3,'ci')",
    [expenseAccount,new Date().toISOString(),owner],
  );
  const unrelated=await postJournal(request(owner,'/api/accounting/journals',{
    ...journalRequest,id:unrelatedId,sourceReference:'CI-UNRELATED-JOURNAL',
    lines:[
      {id:randomUUID(),accountId:debitAccount,debit:'125000',credit:'0'},
      {id:randomUUID(),accountId:expenseAccount,debit:'0',credit:'125000'},
    ],
  }));
  assert.equal(unrelated.status,201);
  const unrelatedLink=await linkInvoice(request(owner,'/api/accounting/invoice-links',{
    id:randomUUID(),commandKey:randomUUID(),invoiceId:invoiceIds[0],journalId:unrelatedId,
  }));
  assert.equal(unrelatedLink.status,409);
  assert.equal((await unrelatedLink.json() as {code:string}).code,'ACCOUNTING_CLASSIFICATION_MISMATCH');
  const link={
    id:randomUUID(),commandKey:randomUUID(),invoiceId:invoiceIds[0],journalId,
  };
  assert.equal((await linkInvoice(request(stranger,'/api/accounting/invoice-links',link))).status,404);
  const wrong=await linkInvoice(request(owner,'/api/accounting/invoice-links',{
    ...link,id:randomUUID(),commandKey:randomUUID(),invoiceId:invoiceIds[1],
  }));
  assert.equal(wrong.status,404);
  const accepted=await linkInvoice(request(owner,'/api/accounting/invoice-links',link));
  assert.equal(accepted.status,201,JSON.stringify(await accepted.clone().json()));
  const replay=await linkInvoice(request(owner,'/api/accounting/invoice-links',link));
  assert.equal(replay.status,200);
  assert.equal((await replay.json() as {replayed:boolean}).replayed,true);
  const duplicate=await linkInvoice(request(owner,'/api/accounting/invoice-links',{
    ...link,id:randomUUID(),commandKey:randomUUID(),
  }));
  assert.equal(duplicate.status,409);
  const reconciled=await reconciliation(setTestIdentity(new Request(url),owner));
  const linked=await reconciled.json() as {summary:{verifiedPostingCount:number;withoutVerifiedPostingCount:number};items:Array<{verifiedPosting:boolean;journalId:string}>};
  assert.equal(linked.summary.verifiedPostingCount,1);
  assert.equal(linked.summary.withoutVerifiedPostingCount,0);
  assert.equal(linked.items[0].verifiedPosting,true);
  assert.equal(linked.items[0].journalId,journalId);
  const foreign=await reconciliation(setTestIdentity(new Request(url),stranger));
  assert.equal((await foreign.json() as {summary:{withoutVerifiedPostingCount:number}}).summary.withoutVerifiedPostingCount,1);
  const immutability=await pool.query("SELECT count(*)::int AS n FROM accounting_invoice_links WHERE invoice_id=$1",[invoiceIds[0]]);
  assert.equal(immutability.rows[0].n,1);
  await assert.rejects(
    pool.query('DELETE FROM accounting_invoice_links WHERE invoice_id=$1',[invoiceIds[0]]),
    /CISNE_ACCOUNTING_LINK_IMMUTABLE/,
  );
  const reversed=await reverseJournal(request(owner,'/api/accounting/journals/'+journalId+'/reverse',{
    commandKey:randomUUID(),effectiveDate:'2027-02-02',sourceReference:'CI-INVOICE-REVERSE',
    description:'Reversal of invoice-linked journal',
  }),{params:Promise.resolve({id:journalId})});
  assert.equal(reversed.status,201,JSON.stringify(await reversed.clone().json()));
  const after=await reconciliation(setTestIdentity(new Request(url),owner));
  assert.equal((await after.json() as {summary:{verifiedPostingCount:number;withoutVerifiedPostingCount:number}}).summary.verifiedPostingCount,0);
});
