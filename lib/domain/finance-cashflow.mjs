/** Exact BRL x10^4 portfolio accumulation. Never pass monetary amounts through Number. */
export function buildDailyFinancialFlow({receivables,payables,receipts,payments}){
 const days=new Map();
 const fields=['projectedIn','projectedOut','realizedIn','realizedOut'];
 const add=(rows,key)=>{
  for(const row of rows){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||! /^-?\d+$/.test(String(row.amount)))
    throw new Error('CISNE_FINANCE_OWNER_INVARIANT: invalid cash-flow source');
   const item=days.get(row.date)??{date:row.date,projectedIn:0n,projectedOut:0n,realizedIn:0n,realizedOut:0n};
   item[key]+=BigInt(row.amount);
   days.set(row.date,item);
  }
 };
 add(receivables,fields[0]);add(payables,fields[1]);add(receipts,fields[2]);add(payments,fields[3]);
 const sums={projectedIn:0n,projectedOut:0n,realizedIn:0n,realizedOut:0n};
 const items=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(item=>{
  for(const key of fields)sums[key]+=item[key];
  return {
   date:item.date,
   projectedIn:String(item.projectedIn),
   projectedOut:String(item.projectedOut),
   realizedIn:String(item.realizedIn),
   realizedOut:String(item.realizedOut),
   netProjected:String(item.projectedIn-item.projectedOut),
   netRealized:String(item.realizedIn-item.realizedOut),
  };
 });
 const summary=Object.fromEntries(fields.map(key=>[key,String(sums[key])]));
 return {
  items,
  summary:{
   ...summary,
   netProjected:String(sums.projectedIn-sums.projectedOut),
   netRealized:String(sums.realizedIn-sums.realizedOut),
  },
 };
}
