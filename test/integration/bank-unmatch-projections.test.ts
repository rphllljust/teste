import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { POST as importStatement, GET as listStatements } from '../../app/api/bank/statements/route';
import { POST as reconcile } from '../../app/api/bank/commands/route';
import { GET as listTreasury } from '../../app/api/treasury/route';
import { POST as registerPayment } from '../../app/api/finance/payables/payments/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw new Error('NO-GO: bank reconciliation tests require disposable PostgreSQL');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(url.hostname) ||
    !['/cisne_test','/cisne_ci'].includes(url.pathname) || url.port !== '5432')
  throw new Error('NO-GO: bank reconciliation cannot mutate non-CI database');

const pool = new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner = randomUUID(), outsider = randomUUID();
const payable = randomUUID(), payment = randomUUID();
const statement = randomUUID(), line = randomUUID(), match = randomUUID(), unmatch = randomUUID();
const accountReference = 'CI-BANK-' + randomUUID().slice(0,16);
function req(method:'GET'|'POST',path:string,actor:string,data?:unknown) {
  return setTestIdentity(new Request('http://localhost'+path,{
    method,
    headers:{'content-type':'application/json'},
    body:data===undefined?undefined:JSON.stringify(data),
  }),actor);
}
async function check(response:Response,status:number,label:string) {
  assert.equal(response.status,status,label+': '+JSON.stringify(await response.clone().json()));
}
async function unmatchedFromStatements(actor:string) {
  const response=await listStatements(req('GET','/api/bank/statements?accountReference='+accountReference,actor));
  await check(response,200,'bank list');
  const value=await response.json() as {items:Array<{id:string;unmatchedCount:number}>};
  const found=value.items.find(item=>item.id===statement);
  return found ? Number(found.unmatchedCount) : null;
}
async function pendingFromTreasury(actor:string) {
  const response=await listTreasury(req('GET','/api/treasury?pendingOnly=1&q='+accountReference,actor));
  await check(response,200,'treasury');
  const value=await response.json() as {items:Array<{statementId:string;unmatchedCount:number}>};
  const found=value.items.find(item=>item.statementId===statement);
  return found ? Number(found.unmatchedCount) : null;
}
after(async()=>{
  try {
    await pool.query('DELETE FROM bank_reconciliation_events WHERE line_id=$1',[line]);
    await pool.query('DELETE FROM bank_statement_lines WHERE statement_id=$1',[statement]);
    await pool.query('DELETE FROM bank_statements WHERE id=$1',[statement]);
    await pool.query('DELETE FROM payable_payments WHERE payable_id=$1',[payable]);
    await pool.query('DELETE FROM finance_audit_events WHERE actor_id=$1',[owner]);
    await pool.query('DELETE FROM payables WHERE id=$1',[payable]);
  }finally{await closeDatabase();await pool.end();}
});

test('active bank match and unmatch drive both authorized unmatched projections',async()=>{
  await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[
    payable,'Fornecedor de teste','CI-BANK','Título de conciliação',30000,'2026-11-22',new Date().toISOString(),owner,randomUUID(),randomUUID(),
  ]);
  await check(await registerPayment(req('POST','/api/finance/payables/payments',owner,{
    payableId:payable,amount:'10000',effectiveDate:'2026-11-22',reference:'CI payment bank',commandKey:payment,
  })),201,'payment posted');

  await check(await importStatement(req('POST','/api/bank/statements',owner,{
    id:statement,accountReference,sourceReference:'CI-EXTRATO-'+randomUUID().slice(0,8),
    periodStart:'2026-11-22',periodEnd:'2026-11-22',
    openingBalance:'0',closingBalance:'-1',
    lines:[{id:line,externalKey:'CI-LINE-1',bookedDate:'2026-11-22',amount:'-1',description:'Pagamento registrado'}],
  })),201,'bank statement imported');

  assert.equal(await unmatchedFromStatements(owner),1);
  assert.equal(await pendingFromTreasury(owner),1);
  assert.equal(await unmatchedFromStatements(outsider),null,'No cross-owner statement access');
  assert.equal(await pendingFromTreasury(outsider),null,'No cross-owner treasury access');

  await check(await reconcile(req('POST','/api/bank/commands',outsider,{
    key:randomUUID(),statementId:statement,lineId:line,command:'match',version:1,targetType:'payment',targetId:payment,
  })),404,'foreign reconciliation denied');

  await check(await reconcile(req('POST','/api/bank/commands',owner,{
    key:match,statementId:statement,lineId:line,command:'match',version:1,targetType:'payment',targetId:payment,
  })),201,'match');
  assert.equal(await unmatchedFromStatements(owner),0,'Active match removes bank pending line');
  assert.equal(await pendingFromTreasury(owner),null,'No pending line after active match');

  await check(await reconcile(req('POST','/api/bank/commands',owner,{
    key:unmatch,statementId:statement,lineId:line,command:'unmatch',version:1,matchId:match,
  })),201,'unmatch');
  assert.equal(await unmatchedFromStatements(owner),1,'Reversed match restores pending bank line');
  assert.equal(await pendingFromTreasury(owner),1,'Reversed match restores treasury pending line');

  const persisted=await pool.query('SELECT kind,reverses_id FROM bank_reconciliation_events WHERE line_id=$1 ORDER BY created_at,id',[line]);
  assert.equal(persisted.rows.length,2,'Both matching facts persist');
  assert.deepEqual(new Set(persisted.rows.map(x=>x.kind)),new Set(['match','unmatch']));
  assert.ok(persisted.rows.some(x=>x.kind==='unmatch'&&x.reverses_id===match));
});
