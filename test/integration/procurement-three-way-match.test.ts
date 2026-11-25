import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as inventory} from '../../app/api/inventory/route';
import {POST as procure} from '../../app/api/procurement/route';
import {POST as approve} from '../../app/api/procurement/[id]/commands/route';
import {POST as receive} from '../../app/api/procurement/[id]/receipts/route';
import {GET as supplierInvoiceDetails,POST as matchInvoice} from '../../app/api/procurement/[id]/supplier-invoice/route';
import {POST as account} from '../../app/api/accounting/accounts/route';
import {GET as payableDetail} from '../../app/api/payables/[id]/route';
import {POST as policy} from '../../app/api/accounting/posting-rules/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('Three-way tests require disposable CI PostgreSQL.');
const target=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
 !['/cisne_ci','/cisne_test'].includes(target.pathname)||
 !['cisne_ci','cisne_test'].includes(target.username))
 throw new Error('NO-GO: refusing purchase / AP fixture on non-disposable database.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
after(async()=>{await closeDatabase();await pool.end();});
const actor=randomUUID(),outsider=randomUUID(),supplierId=randomUUID();
const itemA=randomUUID(),itemB=randomUUID(),orderId=randomUUID(),lineA=randomUUID(),lineB=randomUUID();
const accountExpense=randomUUID(),accountPayable=randomUUID(),invoiceId=randomUUID();
const date=new Date().toISOString().slice(0,10);
const path=(id:string)=>'/api/procurement/'+id+'/supplier-invoice';
const req=(who:string,url:string,body?:unknown)=>
 setTestIdentity(new Request('http://localhost'+url,{
  method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 }),who);
type Data={code?:string;error?:string;replayed?:boolean;resource?:{id:string;payableId:string;accounting:{status:string;journalId:string}};invoice?:{documentNumber:string;payableId:string;amount:number}|null};
async function expect(response:Response,status:number,message:string){
 const json=await response.clone().json() as Data;
 assert.equal(response.status,status,message+' '+JSON.stringify(json));
 return json;
}
const command=(key:string,amount:string,documentNumber='NF-CI-THREE-WAY-001',supplier=supplierId)=>({
 key,supplierId:supplier,documentNumber,issueDate:date,dueDate:'2099-12-31',amount,
});
const order=(id:string,lines:Array<{id:string;itemId:string;quantity:string;unitPrice:string;discount?:string;tax?:string}>)=>({
 type:'order',id,supplierId,reference:'PC-CI-'+id.slice(0,8),expectedOn:'2027-06-30',
 freight:'2.00',additionalCosts:'1.00',lines,
});
const postOrder=async(id:string,lines:Parameters<typeof order>[1])=>{
 await expect(await procure(req(actor,'/api/procurement',order(id,lines))),201,'create PO');
 await expect(await approve(req(actor,'/api/procurement/'+id+'/commands',{
  key:randomUUID(),version:1,command:'approve',
 }),{params:Promise.resolve({id})}),200,'approve PO');
};
const receiveOrder=async(id:string,version:number,lines:Array<{lineId:string;accepted:string;rejected:string}>)=>
 expect(await receive(req(actor,'/api/procurement/'+id+'/receipts',{
  key:randomUUID(),version,reference:'CI-RECEIPT-'+randomUUID().slice(0,8),lines,
 }),{params:Promise.resolve({id})}),201,'received');
const supplierMatch=(who:string,id:string,input:ReturnType<typeof command>)=>
 matchInvoice(req(who,path(id),input),{params:Promise.resolve({id})});

test('synthetic three-way: approved PO, two partial deliveries, exact invoice and native AP double-entry',async()=>{
 for(const [id,name] of [[itemA,'CI-MATERIAL-ALPHA'],[itemB,'CI-MATERIAL-BETA']]){
  await expect(await inventory(req(actor,'/api/inventory',{
   type:'create',id,sku:'CI-'+id.slice(0,8),name,unit:'un',minimum:'0',
  })),201,'inventory item');
 }
 await expect(await procure(req(actor,'/api/procurement',{
  type:'supplier',id:supplierId,legalName:'Fornecedor fictício integral CI',
  document:'CI-DOC-'+supplierId,email:'',
 })),201,'supplier');
 for(const [id,type] of [[accountExpense,'expense'],[accountPayable,'liability']]){
  await expect(await account(req(actor,'/api/accounting/accounts',{
   id,code:'CI-3WAY-'+id.slice(0,8),name:'CI '+type,type,
  })),201,'chart account');
 }
 await expect(await policy(req(actor,'/api/accounting/posting-rules',{
  sourceType:'payable_accrual',commandKey:randomUUID(),expectedVersion:0,
  debitAccountId:accountExpense,creditAccountId:accountPayable,active:true,
 })),201,'AP recognition policy');

 await postOrder(orderId,[
  {id:lineA,itemId:itemA,quantity:'3',unitPrice:'12.50',discount:'1.00',tax:'0.50'},
  {id:lineB,itemId:itemB,quantity:'2',unitPrice:'4.00',discount:'0',tax:'0'},
 ]);
 const expectedAmount=(await pool.query('SELECT total FROM supplier_purchase_orders WHERE id=$1',
  [orderId])).rows[0].total as number;
 assert.equal(expectedAmount,480000); // 37.00 + 8.00 + 2.00 freight + 1.00 costs = 48.00
 const input=command(invoiceId,'48.00');
 const premature=await supplierMatch(actor,orderId,input);
 assert.equal(premature.status,409);
 assert.equal((await expect(premature,409,'before received')).code,'THREE_WAY_ORDER_NOT_READY');
 await receiveOrder(orderId,2,[{lineId:lineA,accepted:'1',rejected:'0'},{lineId:lineB,accepted:'1',rejected:'0'}]);
 const partial=await supplierMatch(actor,orderId,input);
 assert.equal((await expect(partial,409,'partial delivery')).code,'THREE_WAY_ORDER_NOT_READY');
 await receiveOrder(orderId,3,[{lineId:lineA,accepted:'2',rejected:'0'},{lineId:lineB,accepted:'1',rejected:'0'}]);

 const badSupplier=await supplierMatch(actor,orderId,command(randomUUID(),'48.00','NF-CI-ERR',outsider));
 assert.equal((await expect(badSupplier,409,'supplier mismatch')).code,'SUPPLIER_MISMATCH');
 const badAmount=await supplierMatch(actor,orderId,command(randomUUID(),'47.99','NF-CI-AMOUNT'));
 assert.equal((await expect(badAmount,409,'monetary mismatch')).code,'THREE_WAY_AMOUNT_MISMATCH');
 const crossTenant=await supplierMatch(outsider,orderId,command(randomUUID(),'48.00'));
 assert.equal((await expect(crossTenant,404,'tenant isolation')).code,'NOT_FOUND');
 const nullBefore=await supplierInvoiceDetails(req(actor,path(orderId)),{params:Promise.resolve({id:orderId})});
 assert.equal((await expect(nullBefore,200,'unmatched invoice')).invoice,null);
 assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM payables WHERE actor_id=$1',[actor])).rows[0].n,0);

 const submitted=await Promise.all([
  supplierMatch(actor,orderId,input),
  supplierMatch(actor,orderId,input),
 ]);
 assert.deepEqual(submitted.map(r=>r.status).sort(),[200,201]);
 const data=await expect(submitted.find(r=>r.status===201)!,201,'three-way posted');
 assert.equal(data.resource?.payableId,invoiceId);
 assert.equal(data.resource?.accounting.status,'auto_posted');
 const postedJournal=data.resource?.accounting.journalId;
 assert.ok(postedJournal);
 const replay=await expect(submitted.find(r=>r.status===200)!,200,'idempotent replay');
 assert.equal(replay.resource?.accounting.journalId,postedJournal);
 const retry=await supplierMatch(actor,orderId,command(randomUUID(),'48.00','NF-CI-OTHER'));
 assert.equal((await expect(retry,409,'same PO duplicate')).code,'SUPPLIER_INVOICE_DUPLICATE');
 const mismatchKey=await supplierMatch(actor,orderId,{...input,documentNumber:'NF-CI-DIFFERENT'});
 assert.equal((await expect(mismatchKey,409,'reused command key')).code,'IDEMPOTENCY_CONFLICT');

 const facts=await pool.query('SELECT i.id,i.owner_id,i.order_id,i.amount,i.payable_id, '+
  'p.amount AS payable_amount,al.journal_id FROM procurement_supplier_invoices i '+
  'JOIN payables p ON p.id=i.payable_id LEFT JOIN accounting_payable_links al ON al.payable_id=i.payable_id '+
  'WHERE i.id=$1',[invoiceId]);
 assert.equal(facts.rowCount,1);
 assert.equal(facts.rows[0].amount,expectedAmount);
 assert.equal(facts.rows[0].payable_amount,expectedAmount);
 assert.equal(facts.rows[0].journal_id,postedJournal);
 const lines=await pool.query('SELECT SUM(accepted_quantity)::int qty,COUNT(*)::int n FROM procurement_supplier_invoice_lines WHERE supplier_invoice_id=$1',[invoiceId]);
 assert.deepEqual(lines.rows[0],{qty:5000,n:2});
 const evidence=await pool.query('SELECT SUM(accepted_quantity)::int qty,COUNT(*)::int n FROM procurement_supplier_invoice_receipts WHERE supplier_invoice_id=$1',[invoiceId]);
 assert.deepEqual(evidence.rows[0],{qty:5000,n:4});
 const journal=await pool.query('SELECT jl.account_id,jl.debit,jl.credit FROM journal_lines jl WHERE jl.entry_id=$1',[postedJournal]);
 assert.deepEqual(new Map(journal.rows.map(x=>[x.account_id,{debit:x.debit,credit:x.credit}])),
  new Map([[accountExpense,{debit:expectedAmount,credit:0}],
   [accountPayable,{debit:0,credit:expectedAmount}]]));
 const detail=await supplierInvoiceDetails(req(actor,path(orderId)),{params:Promise.resolve({id:orderId})});
 assert.equal((await expect(detail,200,'linked invoice')).invoice?.payableId,invoiceId);
 const apView=await payableDetail(req(actor,'/api/payables/'+invoiceId),{params:Promise.resolve({id:invoiceId})});
 assert.equal(apView.status,200);
 const apProjection=await apView.json() as {projection:{source:{procurement:{orderId:string;orderReference:string;documentNumber:string}}}};
 assert.equal(apProjection.projection.source.procurement.orderId,orderId);
 assert.equal(apProjection.projection.source.procurement.documentNumber,input.documentNumber);
 await assert.rejects(pool.query('DELETE FROM procurement_supplier_invoices WHERE id=$1',[invoiceId]),
  /CISNE_SUPPLIER_INVOICE_IMMUTABLE/);
 console.log(JSON.stringify({event:'CISNE_PURCHASE_THREE_WAY_CI',status:'MATCHED_AND_ACCRUED',
  orderCount:1,receiptCount:2,receiptLineProofs:4,invoiceCount:1,
  payableCount:1,accountingJournalCount:1,
  amountScaled:expectedAmount,realSuppliers:0,externalFiscalTransmission:0}));
});

test('a PO with rejected physical units cannot generate a payable even if status is received',async()=>{
 const rejectedOrderId=randomUUID(),lineId=randomUUID();
 await postOrder(rejectedOrderId,[{id:lineId,itemId:itemA,quantity:'2',unitPrice:'1.00'}]);
 await receiveOrder(rejectedOrderId,2,[{lineId,accepted:'1',rejected:'1'}]);
 const result=await supplierMatch(actor,rejectedOrderId,
  command(randomUUID(),'5.00','NF-CI-REJECTED'));
 assert.equal((await expect(result,409,'rejected quantity')).code,'THREE_WAY_RECEIPT_MISMATCH');
 assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM procurement_supplier_invoices WHERE order_id=$1',[rejectedOrderId])).rows[0].n,0);
});
