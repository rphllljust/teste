import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as getRule,POST as configureRule} from '../../app/api/accounting/posting-rules/route';
import {GET as verifyBilling,POST as bill} from '../../app/api/finance/billing/route';
import {POST as postCommand} from '../../app/api/commands/route';
import {GET as reconciliation} from '../../app/api/accounting/reconciliation/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('Automatic accounting integration requires isolated PostgreSQL and NODE_ENV=test');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const actor=randomUUID(),foreignActor=randomUUID(),orderId=randomUUID();
const debitId=randomUUID(),creditId=randomUUID(),expenseId=randomUUID();
const approved=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
const request=(identity:string,path:string,body?:unknown)=>
  setTestIdentity(new Request('http://localhost'+path,{
    method:body===undefined?'GET':'POST',
    headers:{'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }),identity);
const rulePath='/api/accounting/posting-rules';
const billingPath='/api/finance/billing';
const today=()=>new Date().toISOString().slice(0,10);

before(async()=>{
  const now=new Date().toISOString();
  await pool.query(
    "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at) "+
    "VALUES($1,$2,'Auto GL CI','CISNE fixture','Serviços','CI fixture','completed',1,$3)",
    [orderId,actor,now],
  );
  for(const id of approved){
    await pool.query(
      "INSERT INTO measurements(id,order_id,description,amount,status,version,created_at) "+
      "VALUES($1,$2,'Auto GL CI',25000,'approved',1,$3)",
      [id,orderId,now],
    );
  }
  await pool.query(
    "INSERT INTO chart_accounts(id,code,name,type,created_at,actor_id,request_hash) "+
    "VALUES($1,$1,'Accounts receivable','asset',$5,$4,'ci'),"+
    "($2,$2,'Service revenue','revenue',$5,$4,'ci'),"+
    "($3,$3,'Expense','expense',$5,$4,'ci')",
    [debitId,creditId,expenseId,actor,now],
  );
});
after(async()=>{
  // Intentionally retain immutable finance audit/link test rows until the
  // disposable CI PostgreSQL service is destroyed; never delete audit history.
  await closeDatabase();await pool.end();
});

test('configured revenue recognition posts exactly once within invoice/receivable transaction',async()=>{
  const empty=await getRule(request(actor,rulePath));
  assert.equal(empty.status,200);
  assert.equal((await empty.json() as {rule:null}).rule,null);

  const invalid={commandKey:randomUUID(),expectedVersion:0,debitAccountId:debitId,
    creditAccountId:expenseId,active:true};
  const invalidResponse=await configureRule(request(actor,rulePath,invalid));
  assert.equal(invalidResponse.status,409);
  assert.equal((await invalidResponse.json() as {code:string}).code,'ACCOUNTING_CLASSIFICATION_MISMATCH');

  const input={commandKey:randomUUID(),expectedVersion:0,debitAccountId:debitId,
    creditAccountId:creditId,active:true};
  const configured=await configureRule(request(actor,rulePath,input));
  assert.equal(configured.status,201,JSON.stringify(await configured.clone().json()));
  assert.equal((await configureRule(request(actor,rulePath,input))).status,200);
  assert.equal((await configureRule(request(foreignActor,rulePath,input))).status,409);
  const oldVersion=await configureRule(request(actor,rulePath,{
    ...input,commandKey:randomUUID(),expectedVersion:0,
  }));
  assert.equal(oldVersion.status,409);
  assert.equal((await oldVersion.json() as {code:string}).code,'STALE_VERSION');

  const billingCommand={measurementId:approved[0],dueDate:'2027-03-20',commandKey:randomUUID(),expectedVersion:1};
  assert.equal((await bill(request(foreignActor,billingPath,billingCommand))).status,404);
  const responses=await Promise.all([
    bill(request(actor,billingPath,billingCommand)),
    bill(request(actor,billingPath,billingCommand)),
  ]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  const body=await responses.find(r=>r.status===201)!.json() as {
    resource:{invoiceId:string;receivableId:string;accounting:{status:string;journalId:string;ruleVersion:number}};
  };
  assert.equal(body.resource.accounting.status,'auto_posted');
  assert.equal(body.resource.accounting.ruleVersion,1);
  const replay=await responses.find(r=>r.status===200)!.json() as typeof body;
  assert.equal(replay.resource.accounting.journalId,body.resource.accounting.journalId);
  assert.equal(replay.resource.invoiceId,body.resource.invoiceId);
  const verified=await verifyBilling(request(actor,billingPath+'?commandKey='+billingCommand.commandKey));
  assert.equal(verified.status,200);
  assert.equal((await verified.json() as typeof body).resource.invoiceId,body.resource.invoiceId);
  assert.equal((await verifyBilling(request(foreignActor,billingPath+'?commandKey='+billingCommand.commandKey))).status,404);

  const dispatched=await postCommand(request(actor,'/api/commands',{
    id:approved[1],version:1,key:randomUUID(),command:'invoice',dueDate:'2027-03-20',
  }));
  assert.equal(dispatched.status,201,JSON.stringify(await dispatched.clone().json()));
  const dispatchedBody=await dispatched.json() as {resource:{id:string;accounting:{status:string;journalId:string}}};
  assert.equal(dispatchedBody.resource.accounting.status,'auto_posted');
  assert.ok(dispatchedBody.resource.accounting.journalId);

  const duplicate=await bill(request(actor,billingPath,{
    ...billingCommand,commandKey:randomUUID(),
  }));
  assert.equal(duplicate.status,409);

  const stored=await pool.query(
    "SELECT i.amount AS invoice_amount,r.amount AS receivable_amount,l.posting_mode,l.rule_version,"+
    "j.id AS journal_id,j.actor_id,j.effective_date,"+
    "(SELECT SUM(debit)::int FROM journal_lines WHERE entry_id=j.id) AS total_debit,"+
    "(SELECT SUM(credit)::int FROM journal_lines WHERE entry_id=j.id) AS total_credit "+
    "FROM invoices i JOIN receivables r ON r.invoice_id=i.id "+
    "JOIN accounting_invoice_links l ON l.invoice_id=i.id "+
    "JOIN journal_entries j ON j.id=l.journal_id WHERE i.id=$1",
    [body.resource.invoiceId],
  );
  assert.equal(stored.rows.length,1);
  const row=stored.rows[0];
  assert.equal(row.invoice_amount,25000);
  assert.equal(row.receivable_amount,25000);
  assert.equal(row.posting_mode,'automatic_invoice');
  assert.equal(row.rule_version,1);
  assert.equal(row.journal_id,body.resource.accounting.journalId);
  assert.equal(row.actor_id,actor);
  assert.equal(row.effective_date,today());
  assert.equal(row.total_debit,25000);
  assert.equal(row.total_credit,25000);
  const lines=await pool.query(
    'SELECT account_id,debit,credit FROM journal_lines WHERE entry_id=$1 ORDER BY debit DESC',
    [row.journal_id],
  );
  assert.deepEqual(lines.rows,[
    {account_id:debitId,debit:25000,credit:0},
    {account_id:creditId,debit:0,credit:25000},
  ]);
  const reconciled=await reconciliation(request(actor,'/api/accounting/reconciliation'));
  assert.equal(reconciled.status,200);
  assert.equal((await reconciled.json() as {summary:{verifiedPostingCount:number;automaticPostingCount:number}}).summary.verifiedPostingCount,2);
  assert.equal((await reconciled.json() as {summary:{automaticPostingCount:number}}).summary.automaticPostingCount,2);

  const disabled=await configureRule(request(actor,rulePath,{
    ...input,commandKey:randomUUID(),expectedVersion:1,active:false,
  }));
  assert.equal(disabled.status,200);
  const noAuto=await bill(request(actor,billingPath,{
    measurementId:approved[2],dueDate:'2027-03-20',commandKey:randomUUID(),
  }));
  assert.equal(noAuto.status,201);
  const noAutoBody=await noAuto.json() as {resource:{invoiceId:string;accounting:{status:string}}};
  assert.equal(noAutoBody.resource.accounting.status,'not_enabled');
  assert.equal((await pool.query(
    'SELECT count(*)::int AS n FROM accounting_invoice_links WHERE invoice_id=$1',
    [noAutoBody.resource.invoiceId],
  )).rows[0].n,0);

  await pool.query(
    "INSERT INTO finance_period_closes(id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) "+
    "VALUES($1,$2,$2,'closed',$3,$4,'ci',$5)",
    [randomUUID(),today(),actor,randomUUID(),new Date().toISOString()],
  );
  const closed=await bill(request(actor,billingPath,{
    measurementId:approved[3],dueDate:'2027-03-20',commandKey:randomUUID(),
  }));
  assert.equal(closed.status,409);
  assert.equal((await closed.json() as {code:string}).code,'FINANCE_PERIOD_CLOSED');
  assert.equal((await pool.query('SELECT status FROM measurements WHERE id=$1',[approved[2]])).rows[0].status,'approved');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE measurement_id=$1',[approved[3]])).rows[0].n,0);
});
