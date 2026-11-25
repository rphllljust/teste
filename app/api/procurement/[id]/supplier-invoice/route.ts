import { z } from 'zod';
import { database } from '../../../../../db/raw';
import {
 ApiError, failure, fingerprint, jsonBody, requestContext, respond, validDate,
 type RequestContext,
} from '../../../../../lib/api/http';
import { assertFinancePeriodOpen } from '../../../../../lib/application/finance';
import { postPayableAccrualIfConfigured, savedPayableAccrual } from '../../../../../lib/application/payable-posting';

export const dynamic='force-dynamic';
const money=z.string().trim().regex(/^\d{1,9}(?:[,.]\d{1,4})?$/)
 .transform(value=>{const [whole,fraction='']=value.split(/[,.]/);
  return Number(whole)*10000+Number(fraction.padEnd(4,'0'));})
 .refine(value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647);
const command=z.object({
 key:z.string().uuid(),
 supplierId:z.string().uuid(),
 documentNumber:z.string().trim().min(3).max(80).transform(value=>value.toUpperCase()),
 issueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 amount:money,
}).strict();
type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number|null}>;
type OrderLine={id:string;item_id:string;quantity:number;unit_price:number;discount:number;tax:number;subtotal:number};
type ReceiptEvidence={id:string;accepted_quantity:number;rejected_quantity:number};
const number=(value:unknown)=>Number(value);
const round=(product:bigint)=>(product+500n)/1000n;

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const orderId=(await params).id;
  if(!z.string().uuid().safeParse(orderId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Pedido inválido.');
  const order=await database().prepare(
   'SELECT p.id,p.supplier_id AS "supplierId",p.reference,p.status,p.total, '+
   's.legal_name AS "supplierName" FROM supplier_purchase_orders p '+
   'JOIN suppliers s ON s.id=p.supplier_id AND s.owner_id=p.owner_id '+
   'WHERE p.id=? AND p.owner_id=?').bind(orderId,context.actorId).first();
  if(!order)throw new ApiError(404,'NOT_FOUND','Pedido indisponível.');
  const invoice=await database().prepare(
   'SELECT i.id,i.document_number AS "documentNumber",i.issue_date AS "issueDate", '+
   'i.due_date AS "dueDate",i.amount,i.payable_id AS "payableId", '+
   'p.source_reference AS "payableReference",al.journal_id AS "journalId" '+
   'FROM procurement_supplier_invoices i '+
   'JOIN payables p ON p.id=i.payable_id AND p.actor_id=i.owner_id '+
   'LEFT JOIN accounting_payable_links al ON al.payable_id=p.id AND al.actor_id=p.actor_id '+
   'WHERE i.order_id=? AND i.owner_id=?').bind(orderId,context.actorId).first();
  return respond({order,invoice:invoice??null,
   eligibility:invoice?'already_matched':order.status==='received'?'requires_server_three_way_check':'awaiting_complete_receipt',
   policy:'full_receipt_exact_price_one_invoice_per_order_no_fiscal_transmission'},context);
 }catch(error){return failure(error,context);}
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const orderId=(await params).id;
  if(!z.string().uuid().safeParse(orderId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Pedido inválido.');
  const parsed=command.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Documento do fornecedor inválido.');
  const data=parsed.data;
  if(!validDate(data.issueDate)||!validDate(data.dueDate)||data.dueDate<data.issueDate||
     data.issueDate>new Date().toISOString().slice(0,10))
   throw new ApiError(400,'VALIDATION_FAILED','Datas de emissão e vencimento inconsistentes.');
  const requestHash=await fingerprint({actor:context.actorId,orderId,scope:'procurement.three_way',data});
  const result=await database().transaction(async(query:Query)=>{
   // Match creation and finance close share the actor lock. The PO row lock
   // serializes with receipts, approvals and other invoices for this order.
   const today=new Date().toISOString().slice(0,10);
   await assertFinancePeriodOpen(query,context!.actorId,today);
   const order=await query('SELECT p.id,p.owner_id,p.supplier_id,p.reference,p.status, '+
    'p.total,p.freight,p.additional_costs,p.currency,s.legal_name,s.status AS supplier_status '+
    'FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id AND s.owner_id=p.owner_id '+
    'WHERE p.id=$1 AND p.owner_id=$2 FOR UPDATE OF p',[orderId,context!.actorId]);
   if(!order.rows.length)throw new ApiError(404,'NOT_FOUND','Pedido indisponível.');
   const po=order.rows[0];
   const prior=await query('SELECT id,owner_id,order_id,request_hash,payable_id FROM procurement_supplier_invoices WHERE id=$1',[data.key]);
   if(prior.rows.length){
    const old=prior.rows[0];
    if(old.owner_id!==context!.actorId||old.order_id!==orderId||old.request_hash!==requestHash)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador utilizado em outra operação.');
    const accounting=await savedPayableAccrual(query,String(old.payable_id),context!.actorId);
    return {ok:true,replayed:true,resource:{type:'procurementSupplierInvoice',id:data.key,
     orderId,payableId:String(old.payable_id),accounting}};
   }
   if(po.supplier_id!==data.supplierId)
    throw new ApiError(409,'SUPPLIER_MISMATCH','O documento pertence a outro fornecedor.');
   if(po.status!=='received'||po.currency!=='BRL'||po.supplier_status!=='active')
    throw new ApiError(409,'THREE_WAY_ORDER_NOT_READY','Pedido deve estar integralmente recebido, em BRL e com fornecedor ativo.');
   const already=await query('SELECT id FROM procurement_supplier_invoices WHERE order_id=$1 OR '+
    '(owner_id=$2 AND supplier_id=$3 AND document_number=$4) LIMIT 1',
    [orderId,context!.actorId,data.supplierId,data.documentNumber]);
   if(already.rows.length)
    throw new ApiError(409,'SUPPLIER_INVOICE_DUPLICATE','Pedido ou documento do fornecedor já conciliado.');
   const payableKey=await query('SELECT id FROM payables WHERE id=$1',[data.key]);
   if(payableKey.rows.length)
    throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador de obrigação já utilizado.');

   const lineQuery=await query('SELECT id,item_id,quantity,unit_price,discount,tax,subtotal '+
    'FROM supplier_purchase_order_lines WHERE order_id=$1 AND owner_id=$2 ORDER BY position,id',
    [orderId,context!.actorId]);
   const lines=lineQuery.rows as unknown as OrderLine[];
   if(!lines.length)throw new ApiError(409,'THREE_WAY_NO_ORDER_LINES','Pedido sem itens verificáveis.');
   let subtotal=0n;
   const proof:Array<{line:OrderLine;receipts:ReceiptEvidence[]}>=[];

   for(const line of lines){
    if(!Number.isSafeInteger(number(line.quantity))||number(line.quantity)<=0)
     throw new ApiError(409,'THREE_WAY_INVALID_LINE','Quantidade de pedido inconsistente.');
    const expected=round(BigInt(line.quantity)*BigInt(line.unit_price))-
     BigInt(line.discount)+BigInt(line.tax);
    if(expected!==BigInt(line.subtotal)||expected<=0n)
     throw new ApiError(409,'THREE_WAY_PRICE_MISMATCH','Valor da linha diverge da composição aprovada.');
    subtotal+=expected;
    const receiptQuery=await query(
     'SELECT rl.id,rl.accepted_quantity,rl.rejected_quantity '+
     'FROM procurement_receipt_lines rl JOIN procurement_receipts r ON r.id=rl.receipt_id '+
     'WHERE rl.order_line_id=$1 AND r.order_id=$2 AND r.owner_id=$3 ORDER BY rl.id',
     [line.id,orderId,context!.actorId]);
    const receipts=receiptQuery.rows as unknown as ReceiptEvidence[];
    const accepted=receipts.reduce((n,r)=>n+number(r.accepted_quantity),0);
    const rejected=receipts.reduce((n,r)=>n+number(r.rejected_quantity),0);
    if(!receipts.length||rejected!==0||accepted!==number(line.quantity))
     throw new ApiError(409,'THREE_WAY_RECEIPT_MISMATCH',
      'A quantidade recebida e aceita deve corresponder integralmente ao pedido; rejeições ou pendências impedem faturamento.');
    for(const receipt of receipts){
     if(number(receipt.accepted_quantity)<=0)
      throw new ApiError(409,'THREE_WAY_RECEIPT_MISMATCH','Recebimento sem quantidade aceita.');
     const movement=await query('SELECT COUNT(*)::int AS n,COALESCE(SUM(delta),0)::bigint AS delta '+
      'FROM inventory_movements WHERE procurement_receipt_line_id=$1 AND '+
      'procurement_order_id=$2 AND owner_id=$3 AND item_id=$4',
      [receipt.id,orderId,context!.actorId,line.item_id]);
     if(number(movement.rows[0]?.n)!==1||
        number(movement.rows[0]?.delta)!==number(receipt.accepted_quantity))
      throw new ApiError(409,'THREE_WAY_INVENTORY_MISMATCH',
       'Recebimento não corresponde ao movimento de estoque persistido.');
    }
    proof.push({line,receipts});
   }
   const expectedTotal=subtotal+BigInt(number(po.freight))+BigInt(number(po.additional_costs));
   if(expectedTotal!==BigInt(number(po.total))||expectedTotal!==BigInt(data.amount)||
      expectedTotal<=0n||expectedTotal>2147483647n)
    throw new ApiError(409,'THREE_WAY_AMOUNT_MISMATCH',
     'Documento deve corresponder exatamente ao valor do pedido aprovado, incluindo tributos, descontos e despesas.');
   const now=new Date().toISOString();
   await query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [data.key,String(po.legal_name),data.documentNumber,
     'Documento de fornecedor conciliado ao pedido '+String(po.reference),
     data.amount,data.dueDate,now,context!.actorId,requestHash,context!.correlationId]);
   const accounting=await postPayableAccrualIfConfigured(query,context!,{
    payableId:data.key,amount:data.amount,effectiveDate:today,requestHash,
   });
   await query('INSERT INTO procurement_supplier_invoices('+
    'id,owner_id,order_id,supplier_id,payable_id,document_number,issue_date,due_date,amount,request_hash,correlation_id,created_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [data.key,context!.actorId,orderId,data.supplierId,data.key,data.documentNumber,
     data.issueDate,data.dueDate,data.amount,requestHash,context!.correlationId,now]);
   for(const item of proof){
    await query('INSERT INTO procurement_supplier_invoice_lines('+
     'id,supplier_invoice_id,order_line_id,accepted_quantity,unit_price,subtotal) '+
     'VALUES($1,$2,$3,$4,$5,$6)',
     [crypto.randomUUID(),data.key,item.line.id,item.line.quantity,item.line.unit_price,item.line.subtotal]);
    for(const receipt of item.receipts){
     await query('INSERT INTO procurement_supplier_invoice_receipts('+
      'id,supplier_invoice_id,receipt_line_id,accepted_quantity) VALUES($1,$2,$3,$4)',
      [crypto.randomUUID(),data.key,receipt.id,receipt.accepted_quantity]);
    }
   }
   await query('INSERT INTO finance_audit_events('+
    'id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) '+
    "VALUES($1,'procurement_supplier_invoice',$2,'three_way_matched',$3,$4,$5,$6,$7)",
    [crypto.randomUUID(),data.key,context!.actorId,requestHash,context!.correlationId,
     JSON.stringify({orderId,supplierId:data.supplierId,documentNumber:data.documentNumber,
      lines:proof.length,receiptEvents:proof.reduce((n,x)=>n+x.receipts.length,0),
      amountScaled:data.amount,payableId:data.key,accounting}),now]);
   return {ok:true,replayed:false,resource:{type:'procurementSupplierInvoice',
    id:data.key,orderId,payableId:data.key,amountScaled:String(data.amount),accounting}};
  });
  return respond(result,context,result.replayed?200:201);
 }catch(error){return failure(error,context);}
}
