/** Truthful cross-module status. Missing optional workflow stages never impersonate completed work. */
export function classifyProcureToPay(input){
 const alerts=[];
 const add=(code,severity,message)=>alerts.push({code,severity,message});
 const lineCount=Number(input.lineCount??0),unreceived=Number(input.unreceivedCount??0),
  mismatched=Number(input.inventoryMismatchCount??0);
 if(!Number.isSafeInteger(lineCount)||!Number.isSafeInteger(unreceived)||!Number.isSafeInteger(mismatched)||
  Math.min(lineCount,unreceived,mismatched)<0)throw Error('INVALID_PROCUREMENT_EVIDENCE');
 if(!lineCount)add('PO_LINES_MISSING','warning','Pedido sem itens documentados.');
 if(mismatched)add('INVENTORY_EVIDENCE_MISMATCH','warning','Movimentos de estoque e quantidades recebidas não coincidem em todos os itens.');
 if(input.orderStatus==='received'&&unreceived)add('RECEIPT_INCOMPLETE','warning','Pedido marcado como recebido, mas existem quantidades ainda não aceitas.');
 if(input.orderStatus==='received'&&!input.hasInvoice)
  add('SUPPLIER_DOCUMENT_PENDING','warning','Recebimento documentado sem conciliação de documento fiscal do fornecedor.');
 if(input.hasInvoice&&!input.hasPayable)
  add('AP_LINK_MISSING','warning','Documento de fornecedor sem obrigação recuperável no contexto autenticado.');
 if(input.hasPayable&&input.invoiceAmount!==input.payableAmount)
  add('THREE_WAY_VALUE_MISMATCH','warning','Documento de compra e obrigação financeira apresentam valores diferentes.');
 if(input.hasPayable&&!input.accrualVerified)
  add('AP_ACCRUAL_UNVERIFIED','info','Obrigação sem reconhecimento contábil ativo e não estornado verificado.');
 if(input.hasPayable&&input.paymentCount>0&&input.unpostedPaymentCount>0)
  add('AP_PAYMENT_POSTING_UNVERIFIED','info','Existem pagamentos ou estornos sem diário válido comprovado.');
 if(input.hasPayable&&input.paymentCount>0&&input.unmatchedPaymentCount>0)
  add('BANK_RECONCILIATION_PENDING','info','Existem pagamentos documentados sem conciliação bancária ativa recuperada.');
 if(input.hasPayable&&BigInt(input.outstandingScaled)<0n)
  add('NEGATIVE_AP_BALANCE','warning','Baixas superam o valor nominal da obrigação.');
 return alerts;
}
export function buildProcureToPayTotals({orderAmount,invoiceAmount,payableAmount,payments,allocated}){
 const amount=v=>{const s=String(v??'0');if(!/^-?\d+$/.test(s))throw Error('INVALID_SCALED_AMOUNT');return BigInt(s);};
 const paymentSum=(payments??[]).reduce((n,p)=>n+(p.kind==='payment'?amount(p.amountScaled):-amount(p.amountScaled)),0n);
 const p=amount(payableAmount),invoice=amount(invoiceAmount),po=amount(orderAmount),allocatedValue=amount(allocated);
 return {orderScaled:String(po),invoiceScaled:String(invoice),payableScaled:String(p),
  paidScaled:String(paymentSum),outstandingScaled:String(p-paymentSum),
  attributedCostScaled:String(allocatedValue),unattributedCostScaled:String(p-allocatedValue),
  currency:'BRL',scale:4};
}
