/**
 * Tier-1 purchasing invariant: accepted material must match its own purchase
 * line AND its own inventory movement. Aggregate equality alone is insufficient:
 * a +1000/-1000 misposting can hide a materially wrong stock valuation.
 *
 * Quantities are integer thousandths, represented as strings at the API boundary.
 * This projection is read-only. It never creates a receipt, an invoice or AP.
 */
const integer=(value,field)=>{
 const string=String(value??'0');
 if(!/^-?\d+$/.test(string)||(typeof value==='number'&&!Number.isSafeInteger(value)))
  throw new Error('INVALID_PROCUREMENT_QUANTITY_'+field);
 return BigInt(string);
};
export function verifyProcurementReceiptEvidence(lines,totals){
 if(!Array.isArray(lines)||!totals||typeof totals!=='object')
  throw new Error('INVALID_PROCUREMENT_EVIDENCE');
 const issues=[],lineEvidence=[];
 const warn=(code,lineId)=>issues.push({code,lineId});
 let stockTotal=0n,acceptedTotal=0n,movementsTotal=0n;
 for(const line of lines){
  const id=String(line.id??'');
  if(!id)throw new Error('INVALID_PROCUREMENT_LINE_ID');
  const ordered=integer(line.quantity,'ORDERED');
  const received=integer(line.receivedQuantity,'RECEIVED');
  const rejected=integer(line.rejectedQuantity,'REJECTED');
  const stock=integer(line.stockQuantity,'STOCK');
  const movementCount=integer(line.movementCount,'MOVEMENTS');
  if(ordered<=0n||received<0n||rejected<0n||movementCount<0n)
   throw new Error('INVALID_PROCUREMENT_LINE_QUANTITY');
  stockTotal+=stock;acceptedTotal+=received;movementsTotal+=movementCount;
  if(rejected>0n)warn('REJECTED_QUANTITY',id);
  if(received!==ordered)warn('RECEIPT_INCOMPLETE',id);
  if(received+rejected>ordered)warn('RECEIPT_OVER_ORDERED',id);
  if(stock!==received)warn('STOCK_LINE_MISMATCH',id);
  if(received>0n&&movementCount===0n)warn('STOCK_MOVEMENT_MISSING',id);
  lineEvidence.push({lineId:id,orderedQuantity:ordered.toString(),
   receivedQuantity:received.toString(),rejectedQuantity:rejected.toString(),
   stockQuantity:stock.toString(),movementCount:movementCount.toString()});
 }
 const linkedMovements=integer(totals.linkedMovements,'TOTAL_MOVEMENTS');
 const linkedQuantity=integer(totals.linkedQuantity,'TOTAL_STOCK');
 const receiptCount=integer(totals.receiptCount,'RECEIPT_COUNT');
 if(linkedMovements<0n||receiptCount<0n)throw new Error('INVALID_PROCUREMENT_TOTAL');
 if(lines.length===0)warn('PO_LINES_MISSING',null);
 if(receiptCount===0n)warn('NO_RECEIPTS',null);
 if(linkedMovements===0n)warn('NO_STOCK_MOVEMENTS',null);
 if(movementsTotal!==linkedMovements)warn('UNATTRIBUTED_STOCK_MOVEMENTS',null);
 if(stockTotal!==linkedQuantity)warn('STOCK_TOTAL_MISMATCH',null);
 if(acceptedTotal!==linkedQuantity)warn('RECEIPT_STOCK_TOTAL_MISMATCH',null);
 return {
  reconciled:issues.length===0,issues,lineEvidence,
  totals:{acceptedQuantity:acceptedTotal.toString(),stockQuantity:stockTotal.toString(),
   orderMovements:linkedMovements.toString(),attributedMovements:movementsTotal.toString()},
  source:'postgres_line_scoped_stock_and_receipts',
  note:'Reconciliação física por linha; não substitui conferência de preço, documento de fornecedor, passivo ou contabilização.'
 };
}
