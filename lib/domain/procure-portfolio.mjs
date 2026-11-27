/** Evidence classification for a purchase-to-payment portfolio row.
 * All monetary/quantity fields remain scaled integer strings, never IEEE floats.
 * This module is intentionally pure and shared with PostgreSQL contract tests.
 */
const scaled=(value)=>{
  const raw=String(value??'0');
  if(!/^-?\d+$/.test(raw))throw Error('INVALID_PORTFOLIO_SCALED_VALUE');
  return BigInt(raw);
};
export function classifyProcurePortfolio(record){
  const ordered=scaled(record.orderedQuantity),accepted=scaled(record.acceptedQuantity);
  const principal=scaled(record.payableAmount),paid=scaled(record.paidAmount);
  const attributed=scaled(record.attributedAmount);
  const orderValue=scaled(record.orderAmount);
  const invoice=scaled(record.invoiceAmount);
  const outstanding=principal-paid;
  const flags=[];
  if(record.status!=='cancelled'&&record.status!=='draft'){
    if(Number(record.lineCount)===0)flags.push('PURCHASE_LINES_MISSING');
    if(accepted<ordered)flags.push('RECEIPT_INCOMPLETE');
    if(accepted>ordered)flags.push('RECEIPT_EXCEEDS_ORDER');
    if(!record.hasInvoice)flags.push('SUPPLIER_DOCUMENT_PENDING');
    else if(!record.hasPayable)flags.push('PAYABLE_LINK_MISSING');
    else{
      if(invoice!==principal)flags.push('DOCUMENT_AP_AMOUNT_MISMATCH');
      if(!record.accrualVerified)flags.push('ACCOUNTING_UNVERIFIED');
      if(record.unmatchedPayments>0)flags.push('BANK_MATCH_UNVERIFIED');
      if(outstanding<0n)flags.push('PAYABLE_OVERSETTLED');
    }
  }
  let phase='verified';
  if(record.status==='cancelled')phase='cancelled';
  else if(record.status==='draft')phase='draft';
  else if(!record.lineCount||accepted>ordered)phase='exception';
  else if(accepted<ordered)phase='receiving';
  else if(!record.hasInvoice)phase='document';
  else if(!record.hasPayable||invoice!==principal)phase='exception';
  else if(!record.accrualVerified)phase='accounting';
  else if(outstanding>0n)phase='payment';
  else if(record.unmatchedPayments>0)phase='bank';
  return {
    phase,flags,
    orderScaled:String(orderValue),
    payableScaled:String(principal),
    paidScaled:String(paid),
    outstandingScaled:String(outstanding),
    attributedScaled:String(attributed),
    unallocatedScaled:String(principal-attributed),
    receiptRatio:ordered>0n?String(accepted*10000n/ordered):null,
  };
}
export function sumScaled(values){
  return String(values.reduce((total,value)=>total+scaled(value),0n));
}
