import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET} from '../../app/api/enterprise/procure-to-pay/[id]/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw Error('NO-GO: isolated PostgreSQL required');
const uri=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(uri.hostname)||
 !['/cisne_ci','/cisne_test'].includes(uri.pathname)||
 !['cisne_ci','cisne_test'].includes(uri.username))
 throw Error('NO-GO: no shared database fixtures allowed');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const actor=randomUUID(),other=randomUUID(),supplier=randomUUID(),item=randomUUID(),po=randomUUID(),
 line=randomUUID(),receipt=randomUUID(),receiptLine=randomUUID(),movement=randomUUID(),
 payable=randomUUID(),invoice=randomUUID(),payment=randomUUID();
const now=new Date().toISOString();
const request=(owner:string,id=po)=>setTestIdentity(
 new Request('http://localhost/api/enterprise/procure-to-pay/'+id),owner);
const read=(owner:string,id=po)=>GET(request(owner,id),{params:Promise.resolve({id})});
type Data={order:{id:string;status:string};
 financials:{orderScaled:string;payableScaled:string;paidScaled:string;outstandingScaled:string};
 alerts:Array<{code:string}>;stages:Array<{key:string;state:string;items:Array<{id:string}>}>;
 payableId:string|null;provenance:{readOnly:boolean;actorScoped:boolean};checks:{inventoryMismatchCount:number}};
before(async()=>{
 await pool.query('INSERT INTO suppliers(id,owner_id,legal_name,document,email,created_at,updated_at,request_hash) VALUES($1,$2,$3,$4,NULL,$5,$5,$6)',
  [supplier,actor,'CI synthetic vendor','CI-'+supplier,now,'ci']);
 await pool.query('INSERT INTO inventory_items(id,owner_id,sku,name,unit,minimum,created_at,request_hash) VALUES($1,$2,$3,$4,$5,0,$6,$7)',
  [item,actor,'CI-'+item.slice(0,9),'Synthetic supply','un',now,'ci']);
 await pool.query("INSERT INTO supplier_purchase_orders(id,owner_id,supplier_id,item_id,reference,quantity,unit_price,total,expected_on,status,received_at,created_at,updated_at,request_hash) "+
  "VALUES($1,$2,$3,$4,$5,2000,10000,20000,'2029-06-30','received',$6,$6,$6,'ci')",
  [po,actor,supplier,item,'PO-'+po.slice(0,9),now]);
 await pool.query('INSERT INTO supplier_purchase_order_lines(id,order_id,owner_id,item_id,position,quantity,unit_price,subtotal,created_at) VALUES($1,$2,$3,$4,1,2000,10000,20000,$5)',
  [line,po,actor,item,now]);
 await pool.query('INSERT INTO procurement_receipts(id,order_id,owner_id,reference,created_at,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [receipt,po,actor,'RECEIPT-'+receipt.slice(0,8),now,'ci','trace']);
 await pool.query('INSERT INTO procurement_receipt_lines(id,receipt_id,order_line_id,item_id,accepted_quantity,created_at) VALUES($1,$2,$3,$4,2000,$5)',
  [receiptLine,receipt,line,item,now]);
 await pool.query('INSERT INTO inventory_movements(id,item_id,owner_id,procurement_order_id,procurement_receipt_line_id,delta,reference,created_at,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,2000,$6,$7,$8,$9)',
  [movement,item,actor,po,receiptLine,'RCV-'+receipt.slice(0,8),now,'ci','trace']);
 await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,20000,$5,$6,$7,$8,$9)',
  [payable,'CI synthetic vendor','NF-'+po.slice(0,8),'Matched purchase','2029-07-31',now,actor,'ci','trace']);
 await pool.query('INSERT INTO procurement_supplier_invoices(id,owner_id,order_id,supplier_id,payable_id,document_number,issue_date,due_date,amount,request_hash,correlation_id,created_at) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,20000,$9,$10,$11)',
  [invoice,actor,po,supplier,payable,'NF-'+po.slice(0,8),'2029-06-02','2029-07-31','ci','trace',now]);
});
after(async()=>{await closeDatabase();await pool.end()});
test('complete procurement and inventory facts are read from one tenant only and without writes',async()=>{
 const noAccess=await read(other);
 assert.equal(noAccess.status,404);
 const result=await read(actor);
 assert.equal(result.status,200);
 const body=await result.json() as Data;
 assert.equal(body.order.id,po);
 assert.equal(body.payableId,payable);
 assert.equal(body.financials.payableScaled,'20000');
 assert.equal(body.financials.paidScaled,'0');
 assert.equal(body.financials.outstandingScaled,'20000');
 assert.equal(body.checks.inventoryMismatchCount,0);
 assert.deepEqual(body.stages.filter(s=>s.state==='linked').map(s=>s.key).slice(0,4),
  ['purchase','receipt','supplierDocument','payable']);
 assert.ok(body.alerts.some(x=>x.code==='AP_ACCRUAL_UNVERIFIED'));
 assert.equal(body.provenance.readOnly,true);
 assert.equal(body.provenance.actorScoped,true);
 assert.equal((await read(actor,randomUUID())).status,404);
 assert.equal((await read(actor,'bad-id')).status,400);
});
test('payments reduce AP outstanding without pretending cash was bank-reconciled',async()=>{
 await pool.query("INSERT INTO payable_payments(id,payable_id,kind,amount,effective_date,reference,created_at,actor_id,request_hash,correlation_id) "+
  "VALUES($1,$2,'payment',8000,'2029-06-03','CI PAY',$3,$4,'ci','trace')",
 [payment,payable,now,actor]);
 const result=await (await read(actor)).json() as Data;
 assert.equal(result.financials.paidScaled,'8000');
 assert.equal(result.financials.outstandingScaled,'12000');
 assert.ok(result.alerts.some(x=>x.code==='BANK_RECONCILIATION_PENDING'));
 assert.ok(result.alerts.some(x=>x.code==='AP_PAYMENT_POSTING_UNVERIFIED'));
 assert.equal(result.stages.find(s=>s.key==='bank')?.state,'pending');
});
