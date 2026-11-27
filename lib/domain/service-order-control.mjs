/**
 * Source-of-truth interpretation of one service order.
 * All currency remains integer units scaled by 10_000 (BigInt).
 * This is a documentary control view, never a substitute for native approval,
 * billing, bank reconciliation, posting, cost accounting or period close.
 */
const scaled=(raw)=>{
 const value=String(raw??'0');
 if(!/^-?\d+$/.test(value))throw Error('INVALID_OS_CONTROL_MONEY');
 return BigInt(value);
};
const count=(value)=>{
 const n=Number(value??0);
 if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_OS_CONTROL_COUNT');
 return n;
};
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
 new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function assessServiceOrderControl(order,evidence,amounts,{asOf=new Date().toISOString().slice(0,10)}={}){
 if(!validDay(asOf))throw Error('INVALID_OS_CONTROL_REFERENCE_DATE');
 const status=String(order.status);
 const terminal=status==='completed'||status==='cancelled';
 const executing=status==='executing'||status==='in_progress';
 const completed=status==='completed';
 const activeExecution=count(evidence.activeExecution);
 const correctedExecution=count(evidence.correctedExecution);
 const allocations=count(evidence.allocations);
 const pendingMeasurements=count(evidence.pendingMeasurements);
 const unmeasuredExecution=count(evidence.unmeasuredExecution);
 const approvedUnbilled=count(evidence.approvedUnbilled);
 const measurements=count(evidence.measurements);
 const invoices=count(evidence.invoices);
 const billed=scaled(amounts.billedScaled);
 const received=scaled(amounts.receivedScaled);
 const cost=scaled(amounts.attributedCostScaled);
 const outstanding=billed-received;
 const contribution=billed-cost;
 const overdue=!terminal&&validDay(order.dueDate)&&order.dueDate<asOf;
 const flags=[];
 if(overdue)flags.push('OS_DEADLINE_OVERDUE');
 if(executing&&allocations===0)flags.push('RESOURCE_ALLOCATION_NOT_RECORDED');
 if(completed&&activeExecution===0)flags.push('EXECUTION_EVIDENCE_MISSING');
 if(completed&&unmeasuredExecution>0)flags.push('EXECUTION_WITHOUT_MEASUREMENT');
 if(pendingMeasurements>0)flags.push('MEASUREMENT_DECISION_PENDING');
 if(approvedUnbilled>0)flags.push('APPROVED_MEASUREMENT_UNBILLED');
 if(outstanding<0n)flags.push('RECEIPTS_EXCEED_INVOICES');
 if(invoices>0&&outstanding>0n)flags.push('RECEIVABLE_BALANCE_OPEN');
 const severity=flags.some(f=>['OS_DEADLINE_OVERDUE','EXECUTION_EVIDENCE_MISSING','RECEIPTS_EXCEED_INVOICES'].includes(f))?'high':
  flags.length?'attention':'none';
 let phase='intake';
 if(status==='cancelled')phase='cancelled';
 else if(status==='draft'||status==='prepared')phase='intake';
 else if(status==='planned'||status==='authorized')phase='planning';
 else if(executing)phase='execution';
 else if(completed){
  if(unmeasuredExecution>0||!measurements)phase='measurement';
  else if(pendingMeasurements>0)phase='approval';
  else if(approvedUnbilled>0)phase='billing';
  else if(outstanding>0n)phase='collections';
  else if(invoices>0)phase='invoiced';
  else phase='review';
 }
 return {
  phase,flags,severity,overdue,asOf,
  counts:{activeExecution,correctedExecution,allocations,measurements,invoices,
   pendingMeasurements,unmeasuredExecution,approvedUnbilled},
  financial:{billedScaled:String(billed),receivedScaled:String(received),
   receivableOutstandingScaled:String(outstanding),attributedCostScaled:String(cost),
   partialContributionScaled:String(contribution)}
 };
}
