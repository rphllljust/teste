/**
 * Independent purchase-delivery and supplier-payable clocks.
 * These are documentary risk signals, not evidence of a bank balance or fiscal posting.
 * Date comparison uses explicit UTC calendar days for deterministic multi-region behavior.
 */
const dayMs=86400000;
const dateValue=(value)=>{
 if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))return null;
 const ms=Date.parse(value+'T00:00:00.000Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms:null;
};
const scaled=value=>{
 const raw=String(value??'0');
 if(!/^-?\d+$/.test(raw))throw Error('INVALID_PROCURE_DEADLINE_SCALED_VALUE');
 return BigInt(raw);
};
const clock=(value,today)=>{
 const ms=dateValue(value);
 if(ms===null)return {state:'unknown',date:null,daysUntil:null};
 const daysUntil=Math.round((ms-today)/dayMs);
 return {state:daysUntil<0?'overdue':daysUntil===0?'today':daysUntil<=7?'soon':'future',
  date:value,daysUntil};
};
export function assessProcureDeadlines(row,{today=new Date().toISOString().slice(0,10)}={}){
 const utcToday=dateValue(today);
 if(utcToday===null)throw Error('INVALID_PROCURE_REFERENCE_DATE');
 const active=row.status!=='draft'&&row.status!=='cancelled';
 const deliveryOutstanding=scaled(row.acceptedQuantity)<scaled(row.orderedQuantity);
 const paymentOutstanding=scaled(row.outstandingScaled)>0n;
 const delivery=active&&deliveryOutstanding?clock(row.expectedOn,utcToday):
  {state:'not_applicable',date:null,daysUntil:null};
 const payment=active&&row.hasPayable&&paymentOutstanding?clock(row.payableDueOn,utcToday):
  {state:'not_applicable',date:null,daysUntil:null};
 const alerts=[];
 if(delivery.state==='overdue')alerts.push('DELIVERY_OVERDUE');
 else if(delivery.state==='today')alerts.push('DELIVERY_DUE_TODAY');
 else if(delivery.state==='soon')alerts.push('DELIVERY_DUE_SOON');
 if(payment.state==='overdue')alerts.push('PAYMENT_OVERDUE');
 else if(payment.state==='today')alerts.push('PAYMENT_DUE_TODAY');
 else if(payment.state==='soon')alerts.push('PAYMENT_DUE_SOON');
 const severity=alerts.some(x=>x.endsWith('_OVERDUE'))?'overdue':
  alerts.some(x=>x.endsWith('_TODAY'))?'today':alerts.length?'soon':'none';
 return {delivery,payment,alerts,severity,asOf:today};
}
