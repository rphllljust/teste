/** Exact, read-only financial stress projection. No bank balances, writes or synthetic source records. */
export type CashScenarioSource={date:string;projectedIn:string;projectedOut:string};
export type CashScenarioRow={
 date:string;baselineNetScaled:string;stressedNetScaled:string;
 baselineRunningScaled:string;stressedRunningScaled:string;deltaScaled:string;
};
export type CashScenario={
 rows:CashScenarioRow[];baselineNetScaled:string;stressedNetScaled:string;
 delayedBeyondHorizonScaled:string;maximumTemporaryGapScaled:string;delayDays:number;
};
const money=(v:string)=>{if(!/^-?\\d+$/.test(v))throw new Error('INVALID_CASH_PROJECTION_AMOUNT');return BigInt(v);};
const day=(value:string)=>{if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z')))throw new Error('INVALID_CASH_PROJECTION_DATE');return value;};
const shifted=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
/** Reallocate only *projected receivables* by delayDays; payables remain at original due dates.
 * Observed receipts/payments are intentionally excluded: this is not a bank forecast.
 * A delayed receipt outside the requested reporting window is disclosed, never silently invented.
 */
export function buildCashStressScenario(source:ReadonlyArray<CashScenarioSource>,rangeEnd:string,delayDays:number):CashScenario{
 if(![0,7,15,30].includes(delayDays)||!Number.isInteger(delayDays))throw new Error('INVALID_STRESS_PERIOD');
 day(rangeEnd);
 const baseline=new Map<string,{incoming:bigint;outgoing:bigint}>();
 const stressed=new Map<string,bigint>();
 let delayedBeyondHorizon=0n;
 const add=(d:string,incoming:bigint,outgoing:bigint)=>{
  const prev=baseline.get(d)??{incoming:0n,outgoing:0n};
  baseline.set(d,{incoming:prev.incoming+incoming,outgoing:prev.outgoing+outgoing});
 };
 for(const row of source){
  const date=day(row.date),incoming=money(row.projectedIn),outgoing=money(row.projectedOut);
  if(incoming<0n||outgoing<0n||date>rangeEnd)throw new Error('INVALID_CASH_PROJECTION_SOURCE');
  add(date,incoming,outgoing);
  stressed.set(date,(stressed.get(date)??0n)-outgoing);
  const moved=shifted(date,delayDays);
  if(moved<=rangeEnd)stressed.set(moved,(stressed.get(moved)??0n)+incoming);
  else delayedBeyondHorizon+=incoming;
 }
 const dates=[...new Set([...baseline.keys(),...stressed.keys()])].sort();
 let regular=0n,stress=0n,maximumGap=0n;
 const rows=dates.map(date=>{
  const value=baseline.get(date);
  const original=(value?.incoming??0n)-(value?.outgoing??0n);
  const changed=stressed.get(date)??0n;
  regular+=original;stress+=changed;
  const gap=regular-stress;if(gap>maximumGap)maximumGap=gap;
  return {date,baselineNetScaled:String(original),stressedNetScaled:String(changed),
   baselineRunningScaled:String(regular),stressedRunningScaled:String(stress),
   deltaScaled:String(stress-regular)};
 });
 return {rows,baselineNetScaled:String(regular),stressedNetScaled:String(stress),
  delayedBeyondHorizonScaled:String(delayedBeyondHorizon),maximumTemporaryGapScaled:String(maximumGap),delayDays};
}
