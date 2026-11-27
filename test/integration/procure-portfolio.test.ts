import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET} from '../../app/api/enterprise/procure-to-pay/portfolio/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw Error('NO-GO: isolated PostgreSQL required');
const uri=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(uri.hostname)||
 !['/cisne_ci','/cisne_test'].includes(uri.pathname)||
 !['cisne_ci','cisne_test'].includes(uri.username))
 throw Error('NO-GO: shared database fixtures disallowed');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const actor=randomUUID(),other=randomUUID(),supplier=randomUUID(),item=randomUUID(),
 order=randomUUID(),line=randomUUID(),receipt=randomUUID(),receiptLine=randomUUID(),
 payable=randomUUID(),invoice=randomUUID();
const now=new Date().toISOString();
function request(owner:string,query=''){
 return setTestIdentity(new Request('http://localhost/api/enterprise/procure-to-pay/portfolio'+query),owner);
}
const read=(owner:string,query='')=>GET(request(owner,query));
type Entry={id:string;phase:string;flags:string[];orderScaled:string;
 outstandingScaled:string;payableScaled:string;acceptedQuantity:string;orderedQuantity:string};
type Result={items:Entry[];summary:{pageOrders:number;pageOutstandingScaled:string};
 pageInfo:{total:number;hasMore:boolean}};
before(async()=>{
 await pool.query('INSERT INTO suppliers(id,owner_id,legal_name,document,email,created_at,updated_at,request_hash) VALUES($1,$2,$3,$4,NULL,$5,$5,$6)',
  [supplier,actor,'CI Portfolio Vendor','CI-'+supplier,now,'ci']);
 await pool.query('INSERT INTO inventory_items(id,owner_id,sku,name,unit,minimum,created_at,request_hash) VALUES($1,$2,$3,$4,$5,0,$6,$7)',
  [item,actor,'PF-'+item.slice(0,9),'CI portfolio item','un',now,'ci']);
 await pool.query("INSERT INTO supplier_purchase_orders(id,owner_id,supplier_id,item_id,reference,quantity,unit_price,total,expected_on,status,received_at,created_at,updated_at,request_hash) VALUES($1,$2,$3,$4,$5,2500,40000,100000,'2029-08-31','received',$6,$6,$6,'ci')",
  [order,actor,supplier,item,'PORT-'+order.slice(0,9),now]);
 await pool.query('INSERT INTO supplier_purchase_order_lines(id,order_id,owner_id,item_id,position,quantity,unit_price,subtotal,created_at) VALUES($1,$2,$3,$4,1,2500,40000,100000,$5)',
  [line,order,actor,item,now]);
 await pool.query('INSERT INTO procurement_receipts(id,order_id,owner_id,reference,created_at,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [receipt,order,actor,'PORT-RC-'+receipt.slice(0,8),now,'ci','trace']);
 await pool.query('INSERT INTO procurement_receipt_lines(id,receipt_id,order_line_id,item_id,accepted_quantity,created_at) VALUES($1,$2,$3,$4,2500,$5)',
  [receiptLine,receipt,line,item,now]);
});
after(async()=>{await closeDatabase();await pool.end();});
test('portfolio uses only authenticated ownership and precise receipts; pending supplier document is not a payment',async()=>{
 const forbidden=await read(other);
 assert.equal(forbidden.status,200);
 const empty=await forbidden.json() as Result;
 assert.equal(empty.items.some(x=>x.id===order),false);
 const response=await read(actor,'?status=received&q=PORT-');
 assert.equal(response.status,200);
 const body=await response.json() as Result;
 const found=body.items.find(x=>x.id===order);
 assert.ok(found);
 assert.equal(found.phase,'document');
 assert.equal(found.orderScaled,'100000');
 assert.equal(found.outstandingScaled,'0');
 assert.equal(found.orderedQuantity,'2500');
 assert.equal(found.acceptedQuantity,'2500');
 assert.ok(found.flags.includes('SUPPLIER_DOCUMENT_PENDING'));
 assert.equal(body.pageInfo.hasMore,false);
});
test('linked supplier obligation enters accounting verification; no cash assumed',async()=>{
 await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,100000,$5,$6,$7,$8,$9)',
  [payable,'CI Portfolio Vendor','PORT-NF','Matched purchase','2029-09-30',now,actor,'ci','trace']);
 await pool.query('INSERT INTO procurement_supplier_invoices(id,owner_id,order_id,supplier_id,payable_id,document_number,issue_date,due_date,amount,request_hash,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,100000,$9,$10,$11)',
  [invoice,actor,order,supplier,payable,'PORT-NF','2029-08-30','2029-09-30','ci','trace',now]);
 const response=await read(actor);
 assert.equal(response.status,200);
 const body=await response.json() as Result;
 const entry=body.items.find(x=>x.id===order);
 assert.ok(entry);
 assert.equal(entry.phase,'accounting');
 assert.equal(entry.payableScaled,'100000');
 assert.equal(entry.outstandingScaled,'100000');
 assert.equal(body.summary.pageOutstandingScaled,'100000');
 assert.ok(entry.flags.includes('ACCOUNTING_UNVERIFIED'));
});
test('rejects invalid portfolio filters without cross-tenant fallback',async()=>{
 assert.equal((await read(actor,'?status=invalid')).status,400);
 assert.equal((await read(actor,'?page=0')).status,400);
 assert.equal((await read(actor,'?unexpected=1')).status,400);
});
