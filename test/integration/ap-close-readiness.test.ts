import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as account} from '../../app/api/accounting/accounts/route';
import {POST as rule} from '../../app/api/accounting/posting-rules/route';
import {POST as payable} from '../../app/api/payables/route';
import {POST as payment} from '../../app/api/finance/payables/payments/route';
import {GET as preflight} from '../../app/api/finance/periods/preflight/route';
import {POST as close} from '../../app/api/finance/periods/close/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('NO-GO: AP close test requires isolated PostgreSQL.');
const target=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
  !['/cisne_ci','/cisne_test'].includes(target.pathname)||
  !['cisne_ci','cisne_test'].includes(target.username))
 throw new Error('NO-GO: refusing AP close fixtures outside CI database.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
after(async()=>{await closeDatabase();await pool.end();});
const owner=randomUUID(),other=randomUUID();
const e=randomUUID(),l=randomUUID(),b=randomUUID();
const legacyId=randomUUID(),legacyPaymentId=randomUUID();
const recordedId=randomUUID(),recordedPaymentId=randomUUID();
const today=new Date().toISOString().slice(0,10);
const first=today.slice(0,8)+'01';
const last=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).toISOString().slice(0,10);
const path='/api/finance/periods/preflight?periodStart='+first+'&periodEnd='+last;
const req=(actor:string,url:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+url,{
 method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),
}),actor);
const acct=(id:string,type:string)=>({id,code:'CI-AP-'+id.slice(0,8),name:'Synthetic '+type,type,active:true});
const policy=(sourceType:string,debitAccountId:string,creditAccountId:string)=>({
 commandKey:randomUUID(),sourceType,debitAccountId,creditAccountId,expectedVersion:0,active:true,
});
const bill=(id:string,amount:string)=>({id,supplier:'Fornecedor fictício de integração',
 sourceReference:'CI-AP-'+id.slice(0,8),description:'Documento sintético, sem efeitos reais',
 amount,dueDate:'2099-12-31'});
const pay=(id:string,payableId:string,amount:string)=>({payableId,amount,effectiveDate:today,
 reference:'Pagamento sintético, sem banco',commandKey:id});
async function accepted(response:Response,expected:number,step:string){
 const body=await response.clone().json() as {code?:string};
 assert.equal(response.status,expected,step+' '+JSON.stringify(body));
 return body;
}

test('AP close: legacy gaps block new closure; valid journals reconcile; corrupt links fail closed',async()=>{
 for(const a of [acct(e,'expense'),acct(l,'liability'),acct(b,'asset')]){
  await accepted(await account(req(owner,'/api/accounting/accounts',a)),201,'Account');
 }
 await accepted(await payable(req(owner,'/api/payables',bill(legacyId,'10,00'))),201,'Legacy AP');
 await accepted(await payment(req(owner,'/api/finance/payables/payments',pay(legacyPaymentId,legacyId,'100000'))),201,'Legacy payment');

 await accepted(await rule(req(owner,'/api/accounting/posting-rules',policy('payable_accrual',e,l))),201,'Accrual policy');
 await accepted(await rule(req(owner,'/api/accounting/posting-rules',policy('payable_payment',l,b))),201,'Payment policy');
 await accepted(await payable(req(owner,'/api/payables',bill(recordedId,'250,00'))),201,'Recognized AP');
 await accepted(await payment(req(owner,'/api/finance/payables/payments',pay(recordedPaymentId,recordedId,'2500000'))),201,'Recognized payment');

 const read=async(actor:string)=> {
  const response=await preflight(req(actor,path));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  return response.json() as Promise<{canClose:boolean;advisoryOnly:boolean;
   unpostedPayables:number;unpostedPayablesAmountScaled:string;
   unpostedPayablePayments:number;unpostedPayablePaymentsAmountScaled:string;
   invalidPayableLinks:number;invalidPayablePaymentLinks:number;
  }>;
 };
 const clean=await read(owner);
 assert.equal(clean.canClose,false);
 assert.equal(clean.advisoryOnly,true);
 assert.equal(clean.unpostedPayables,1);
 assert.equal(clean.unpostedPayablesAmountScaled,'100000');
 assert.equal(clean.unpostedPayablePayments,1);
 assert.equal(clean.unpostedPayablePaymentsAmountScaled,'100000');
 assert.equal(clean.invalidPayableLinks,0);
 assert.equal(clean.invalidPayablePaymentLinks,0);
 assert.equal((await read(other)).unpostedPayables,0);
 const unpostedCloseId=randomUUID(),legacyBlocked=await close(req(owner,'/api/finance/periods/close',{
  id:unpostedCloseId,periodStart:first,periodEnd:last,
  reference:'CI must not certify AP without source journals',
 }));
 assert.equal(legacyBlocked.status,409);
 assert.equal((await legacyBlocked.json() as {code:string}).code,'FINANCE_UNPOSTED_SOURCE_BLOCKED');
 assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM finance_period_closes WHERE id=$1',[unpostedCloseId])).rows[0].n,0);

 // A direct SQL fixture deliberately violates organization ownership.
 // It MUST remain invisible to another owner and prevent a false clean close
 // for the true owner. CI database is discarded; no real data is modified.
 const now=new Date().toISOString(),foreignAccrual=randomUUID(),foreignPayment=randomUUID();
 for(const journalId of [foreignAccrual,foreignPayment]){
  await pool.query("INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,'Corrupted CI audit row','posted',2,$4,$5,'ci','ci')",
   [journalId,today,'CI-INVALID-'+journalId.slice(0,8),now,other]);
 }
 await pool.query('INSERT INTO accounting_payable_links(id,actor_id,payable_id,journal_id,amount,effective_date,rule_version,request_hash,correlation_id,created_at) VALUES($1,$2,$3,$4,100000,$5,1,$6,$7,$8)',
  [randomUUID(),other,legacyId,foreignAccrual,today,randomUUID(),randomUUID(),now]);
 await pool.query("INSERT INTO accounting_payable_payment_links(id,actor_id,payment_id,journal_id,kind,amount,effective_date,rule_version,request_hash,correlation_id,created_at) VALUES($1,$2,$3,$4,'payment',100000,$5,1,$6,$7,$8)",
  [randomUUID(),other,legacyPaymentId,foreignPayment,today,randomUUID(),randomUUID(),now]);

 const corrupt=await read(owner);
 assert.equal(corrupt.invalidPayableLinks,1);
 assert.equal(corrupt.invalidPayablePaymentLinks,1);
 assert.equal(corrupt.canClose,false);
 assert.equal((await read(other)).invalidPayableLinks,0);
 const closeId=randomUUID(),denied=await close(req(owner,'/api/finance/periods/close',{
  id:closeId,periodStart:first,periodEnd:last,reference:'AP-CI-NO-GO',
 }));
 assert.equal(denied.status,409);
 assert.equal((await denied.json() as {code:string}).code,'FINANCE_PAYABLE_LEDGER_INTEGRITY');
 const saved=await pool.query('SELECT 1 FROM finance_period_closes WHERE id=$1',[closeId]);
 assert.equal(saved.rowCount,0);
 console.log(JSON.stringify({event:'CISNE_AP_CLOSE_GUARD_CI',status:'BLOCKED_CORRUPTED_LINKS',
  legacyAdvisories:2,invalidLinks:2,realBankTransfers:0,realSuppliers:0}));
});
