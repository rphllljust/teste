import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as createAccount} from '../../app/api/accounting/accounts/route';
import {POST as postingRule} from '../../app/api/accounting/posting-rules/route';
import {POST as createPayable} from '../../app/api/payables/route';
import {POST as makePayment} from '../../app/api/finance/payables/payments/route';
import {POST as payableCommand} from '../../app/api/payables/[id]/payments/route';
import {POST as createBankStatement} from '../../app/api/bank/statements/route';
import {POST as bankCommand} from '../../app/api/bank/commands/route';
import {POST as reverseJournal} from '../../app/api/accounting/journals/[id]/reverse/route';
import {GET as ledger} from '../../app/api/accounting/ledger/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('NO-GO: AP integration only in disposable PostgreSQL.');
const target=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(target.hostname)||
   !['/cisne_ci','/cisne_test'].includes(target.pathname)||
   !['cisne_ci','cisne_test'].includes(target.username))
 throw new Error('NO-GO: refuses AP writes on any remote or non-CI PostgreSQL.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
after(async()=>{await closeDatabase();await pool.end();});
const owner=randomUUID(),other=randomUUID();
const expenseId=randomUUID(),liabilityId=randomUUID(),bankId=randomUUID();
const legacyId=randomUUID(),payableId=randomUUID(),paymentId=randomUUID();
const matchId=randomUUID(),statementId=randomUUID(),bankLineId=randomUUID();
const today=new Date().toISOString().slice(0,10);
const monthStart=today.slice(0,8)+'01';
const monthEnd=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).toISOString().slice(0,10);
const nextDate=new Date(Date.parse(today+'T12:00:00Z')+35*86400000).toISOString().slice(0,10);
const req=(actor:string,path:string,body?:unknown)=>
 setTestIdentity(new Request('http://localhost'+path,{
  method:body===undefined?'GET':'POST',
  headers:{'content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 }),actor);
type ResponsePayload={
 code:string;
 accounting:{status:string;journalId:string;ruleVersion:number};
 resource:{accounting:{status:string;journalId:string;ruleVersion:number}};
 totals:{debitScaled:string;creditScaled:string};
};
const json=async(r:Response)=>(await r.clone().json()) as ResponsePayload;
async function status(response:Response,expected:number,step:string){
 assert.equal(response.status,expected,step+' '+JSON.stringify(await json(response)));
 return json(response);
}
const account=(id:string,type:string)=>({
 id,code:'CI-AP-'+id.slice(0,8),name:'Conta fictícia de homologação '+type,type,
});
const policy=(sourceType:string,debitAccountId:string,creditAccountId:string)=>({
 sourceType,commandKey:randomUUID(),expectedVersion:0,debitAccountId,creditAccountId,active:true,
});
const path='/api/finance/payables/payments';
const amount=2_500_000;

test('AP fictitious source -> accrued GL -> payment -> bank -> GL reversal -> closed origin',async()=>{
 for(const item of [account(expenseId,'expense'),account(liabilityId,'liability'),account(bankId,'asset')]){
  await status(await createAccount(req(owner,'/api/accounting/accounts',item)),201,'Owner chart account');
 }
 const legacy={id:legacyId,supplier:'Fornecedor Fictício CI',
   sourceReference:'CI-AP-LEGACY-'+legacyId.slice(0,8),
   description:'Obrigação manual anterior à política contábil',amount:'100,00',dueDate:'2099-12-31'};
 const legacyCreate=await status(await createPayable(req(owner,'/api/payables',legacy)),201,'Legacy payable');
 assert.equal(legacyCreate.accounting.status,'not_enabled');

 await status(await postingRule(req(owner,'/api/accounting/posting-rules',
  policy('payable_payment',liabilityId,bankId))),201,'Enable payable payment rule');
 const legacyPaymentKey=randomUUID();
 const legacyTry=await makePayment(req(owner,path,{
  payableId:legacyId,amount:'1000000',effectiveDate:today,
  reference:'Pagamento fictício sem origem reconhecida',commandKey:legacyPaymentKey,
 }));
 assert.equal(legacyTry.status,409);
 assert.equal((await json(legacyTry)).code,'PAYABLE_ORIGIN_UNRECOGNIZED');
 assert.equal((await pool.query('SELECT count(*)::int n FROM payable_payments WHERE id=$1',
  [legacyPaymentKey])).rows[0].n,0);

 const wrong=await postingRule(req(owner,'/api/accounting/posting-rules',
  policy('payable_accrual',bankId,expenseId)));
 assert.equal(wrong.status,409);
 assert.equal((await json(wrong)).code,'ACCOUNTING_CLASSIFICATION_MISMATCH');
 await status(await postingRule(req(owner,'/api/accounting/posting-rules',
  policy('payable_accrual',expenseId,liabilityId))),201,'Enable AP source rule');

 const payable={id:payableId,supplier:'Fornecedor Fictício CI',
  sourceReference:'CI-AP-'+payableId.slice(0,8),
  description:'Fatura sintética de fornecedor, sem pagamento bancário real',
  amount:'250,00',dueDate:'2099-12-31'};
 const created=await status(await createPayable(req(owner,'/api/payables',payable)),201,'Accrued payable');
 assert.equal(created.accounting.status,'auto_posted');
 const accrualId=String(created.accounting.journalId);
 assert.equal((await status(await createPayable(req(owner,'/api/payables',payable)),200,
  'Payable idempotent replay')).accounting.journalId,accrualId);
 const sourceRows=await pool.query('SELECT * FROM accounting_payable_links WHERE payable_id=$1',[payableId]);
 assert.equal(sourceRows.rowCount,1);
 assert.equal(sourceRows.rows[0].journal_id,accrualId);
 const debitCredit=await pool.query('SELECT account_id,debit,credit FROM journal_lines WHERE entry_id=$1',[accrualId]);
 assert.deepEqual(new Map(debitCredit.rows.map(x=>[x.account_id,{d:x.debit,c:x.credit}])),new Map([
  [expenseId,{d:amount,c:0}],[liabilityId,{d:0,c:amount}],
 ]));

 const outsider=await makePayment(req(other,path,{
  payableId,amount:String(amount),effectiveDate:today,reference:'OTHER COMPANY',
  commandKey:randomUUID(),
 }));
 assert.equal(outsider.status,404);

 const pay={payableId,amount:String(amount),effectiveDate:today,
  reference:'Transferência fictícia CI',commandKey:paymentId};
 const payments=await Promise.all([makePayment(req(owner,path,pay)),makePayment(req(owner,path,pay))]);
 assert.deepEqual(payments.map(r=>r.status).sort(),[200,201]);
 const paid=await json(payments.find(r=>r.status===201)!);
 assert.equal(paid.resource.accounting.status,'auto_posted');
 const payJournalId=String(paid.resource.accounting.journalId);
 assert.equal((await json(payments.find(r=>r.status===200)!)).resource.accounting.journalId,payJournalId);
 const pair=await pool.query('SELECT account_id,debit,credit FROM journal_lines WHERE entry_id=$1',[payJournalId]);
 assert.deepEqual(new Map(pair.rows.map(x=>[x.account_id,{d:x.debit,c:x.credit}])),new Map([
  [liabilityId,{d:amount,c:0}],[bankId,{d:0,c:amount}],
 ]));
 const liabLedger=await status(await ledger(req(owner,'/api/accounting/ledger?accountId='+liabilityId)),200,'Liability ledger');
 assert.equal(liabLedger.totals.debitScaled,String(amount));
 assert.equal(liabLedger.totals.creditScaled,String(amount));

 const statement={id:statementId,accountReference:'BANCO-FICTICIO-SEM-CONTA',
  sourceReference:'EXTRATO-SINTETICO-AP',periodStart:monthStart,periodEnd:monthEnd,
  openingBalance:'0',closingBalance:'-250,00',
  lines:[{id:bankLineId,externalKey:'DEBITO-CI-AP-'+paymentId.slice(0,8),
   bookedDate:today,amount:'-250,00',description:'Saída bancária fictícia'}]};
 await status(await createBankStatement(req(owner,'/api/bank/statements',statement)),201,'Synthetic statement');
 await status(await bankCommand(req(owner,'/api/bank/commands',{
  key:matchId,statementId,lineId:bankLineId,command:'match',version:1,
  targetType:'payment',targetId:paymentId,
 })),201,'Match supplier payment to bank line');

 const reversePath='/api/payables/'+payableId+'/payments';
 const reversal={key:randomUUID(),command:'reverse_payment',effectiveDate:today,
  reference:'Estorno de pagamento sintético',reversesId:paymentId};
 const denied=await payableCommand(req(owner,reversePath,reversal),
  {params:Promise.resolve({id:payableId})});
 assert.equal(denied.status,409);
 assert.equal((await json(denied)).code,'BANK_RECONCILIATION_ACTIVE');
 await status(await bankCommand(req(owner,'/api/bank/commands',{
  key:randomUUID(),statementId,lineId:bankLineId,command:'unmatch',version:1,
  matchId,
 })),201,'Unmatch before reversal');

 const direct=await reverseJournal(req(owner,'/api/accounting/journals/'+payJournalId+'/reverse',{
  commandKey:randomUUID(),effectiveDate:today,sourceReference:'BYPASS-NO',
  description:'Invalid direct journal reversal',
 }),{params:Promise.resolve({id:payJournalId})});
 assert.equal(direct.status,409);
 assert.equal((await json(direct)).code,'ACCOUNTING_SOURCE_REVERSAL_REQUIRED');
 const originalDirect=await reverseJournal(req(owner,'/api/accounting/journals/'+accrualId+'/reverse',{
  commandKey:randomUUID(),effectiveDate:today,sourceReference:'BYPASS-AP',
  description:'Invalid direct accrual reversal',
 }),{params:Promise.resolve({id:accrualId})});
 assert.equal(originalDirect.status,409);
 assert.equal((await json(originalDirect)).code,'ACCOUNTING_SOURCE_REVERSAL_REQUIRED');

 const reversed=await status(await payableCommand(req(owner,reversePath,reversal),
  {params:Promise.resolve({id:payableId})}),201,'Source controlled reverse');
 assert.equal(reversed.resource.accounting.status,'auto_reversed');
 const revJournal=String(reversed.resource.accounting.journalId);
 const reversedOf=await pool.query('SELECT reversal_of FROM journal_entries WHERE id=$1',[revJournal]);
 assert.equal(reversedOf.rows[0].reversal_of,payJournalId);
 assert.equal((await status(await payableCommand(req(owner,reversePath,reversal),
  {params:Promise.resolve({id:payableId})}),200,'Reversal replay')).resource.accounting.journalId,revJournal);
 const linkCounts=await pool.query(
  "SELECT kind,count(*)::int n FROM accounting_payable_payment_links WHERE actor_id=$1 GROUP BY kind",
  [owner]);
 assert.deepEqual(new Map(linkCounts.rows.map(x=>[x.kind,x.n])),new Map([['payment',1],['reversal',1]]));
 await assert.rejects(pool.query('DELETE FROM accounting_payable_links WHERE payable_id=$1',[payableId]),
  /CISNE_PAYABLE_LINK_IMMUTABLE/);
 await assert.rejects(pool.query('DELETE FROM accounting_payable_payment_links WHERE payment_id=$1',[paymentId]),
  /CISNE_PAYABLE_LINK_IMMUTABLE/);

 // A source booked in a closed month may not be reversed in a later month.
 const secondKey=randomUUID();
 await status(await makePayment(req(owner,path,{...pay,commandKey:secondKey})),
  201,'Second payment after reversal');
 await pool.query("INSERT INTO finance_period_closes(id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) VALUES($1,$2,$3,'closed',$4,$5,'ci',$6)",
  [randomUUID(),monthStart,monthEnd,owner,randomUUID(),new Date().toISOString()]);
 const afterClose=await payableCommand(req(owner,reversePath,{
  key:randomUUID(),command:'reverse_payment',reversesId:secondKey,
  effectiveDate:nextDate,reference:'Tentativa em mês posterior',
 }),{params:Promise.resolve({id:payableId})});
 assert.equal(afterClose.status,409);
 assert.equal((await json(afterClose)).code,'ACCOUNTING_CLOSED_ORIGIN');
 assert.equal((await pool.query('SELECT COUNT(*)::int n FROM payable_payments WHERE reverses_id=$1',
  [secondKey])).rows[0].n,0);
 console.log(JSON.stringify({event:'CISNE_AP_DOUBLE_ENTRY_CI',status:'VERIFIED',
  fictionalAmountScaled:String(amount),journals:['accrual','payment','reversal','second_payment'],
  syntheticBankMatches:1,actualTransfers:0,realSuppliers:0}));
});
