import type {parseLinked} from '../api/query';
import {escapedLike} from '../api/query';
import {measurementCommands} from './orders';

export type OperationQuery=ReturnType<typeof parseLinked>;
export type LinkedRow={id:string;order_id:string;amount_scaled:string;status:string;version:number;[key:string]:unknown};
export const outstandingExpression="r.amount-COALESCE((SELECT SUM(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END) FROM receivable_settlements s WHERE s.receivable_id=r.id),0)";

// List, aggregates and financial cockpit share the same owner-scoped predicate.
export function operationQuery(p:OperationQuery,actorId:string){
 const alias=p.kind==='measurements'?'m':p.kind==='invoices'?'i':'r';
 const from=p.kind==='measurements'?'measurements m JOIN service_orders o ON o.id=m.order_id':p.kind==='invoices'?'invoices i JOIN service_orders o ON o.id=i.order_id':'receivables r JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id';
 const due=p.kind==='measurements'?'o.due_date':alias+'.due_date';
 const clauses:string[]=['(o.owner_id IS NULL OR o.owner_id=?)'],values:(string|number)[]=[actorId];
 if(p.orderId){clauses.push('o.id=?');values.push(p.orderId);}
 if(p.q){clauses.push("(o.title LIKE ? ESCAPE '\\' OR o.client LIKE ? ESCAPE '\\' OR "+alias+".id LIKE ? ESCAPE '\\')");values.push(escapedLike(p.q),escapedLike(p.q),escapedLike(p.q));}
 if(p.status){clauses.push('m.status=?');values.push(p.status);}
 if(p.settlementState){const balance=outstandingExpression;clauses.push(p.settlementState==='outstanding'?balance+'>0':p.settlementState==='open'?balance+'=r.amount':p.settlementState==='settled'?balance+'=0':balance+'>0 AND '+balance+'<r.amount');}
 if(p.dueFrom){clauses.push(due+'>=?');values.push(p.dueFrom);}
 if(p.dueTo){clauses.push(due+'<=?');values.push(p.dueTo);}
 const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
 const sort=p.sort==='title.asc'?'o.title COLLATE NOCASE ASC,'+alias+'.id ASC':p.sort==='dueDate.asc'?(p.kind==='measurements'?due+' IS NULL ASC,':'')+due+' ASC,'+alias+'.id ASC':alias+'.created_at '+(p.sort==='createdAt.asc'?'ASC':'DESC')+','+alias+'.id '+(p.sort==='createdAt.asc'?'ASC':'DESC');
 // Explicit columns keep scaled money as strings on the wire.
 const columns=alias+'.id,'+alias+'.created_at,CAST('+alias+'.amount AS TEXT) AS amount_scaled,o.title,o.client,'+(p.kind==='measurements'?'m.order_id,m.description,m.status,m.version,o.due_date':p.kind==='invoices'?'i.order_id,i.measurement_id,i.due_date':"i.order_id,i.measurement_id,r.invoice_id,r.due_date,CAST(COALESCE((SELECT SUM(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END) FROM receivable_settlements s WHERE s.receivable_id=r.id),0) AS TEXT) settled_scaled");
 return {alias,from,where,values,sort,columns,balanceExpression:p.kind==='receivables'?outstandingExpression:null};
}

export function projectLinked(row:LinkedRow,kind:OperationQuery['kind']){
 const {amount_scaled,settled_scaled,...rest}=row;
 const settled=kind==='receivables'?String(settled_scaled??'0'):null;
 return {...rest,amountScaled:amount_scaled,moneyScale:4,currency:'BRL',availableCommands:kind==='measurements'?measurementCommands(row):[],businessContext:{type:'ServiceOrder',id:row.order_id},facts:kind==='receivables'?{principalScaled:amount_scaled,outstandingScaled:(BigInt(amount_scaled)-BigInt(settled!)).toString(),settledScaled:settled}:undefined,warnings:kind==='receivables'?['Recebimentos informados manualmente; conciliação bancária não conectada.']:[]};
}

export function operationMetrics(p:OperationQuery,aggregate:{total:number;amount:string|null;balance?:string|null},generatedAt:string){
 const filters={kind:p.kind,q:p.q,sort:p.sort,...(p.orderId?{orderId:p.orderId}:{}),...(p.status?{status:p.status}:{}),...(p.settlementState?{settlementState:p.settlementState}:{}),...(p.dueFrom?{dueFrom:p.dueFrom}:{}),...(p.dueTo?{dueTo:p.dueTo}:{})};
 const common={authority:p.kind+'.persistedPrincipal.v1',generatedAt,drilldown:{viewKey:'operation.'+p.kind,filters},status:'available' as const};
 return [{...common,metricId:p.kind+'.principal',label:'Valor registrado',value:aggregate.amount??(aggregate.total===0?'0':null),scale:4,currency:'BRL',status:aggregate.amount==null&&aggregate.total!==0?'unknown' as const:'available' as const},...(p.kind==='receivables'?[{...common,authority:'receivables.persistedSettlementLedger.v1',metricId:'receivables.outstanding',label:'Saldo dos títulos',value:aggregate.balance??(aggregate.total===0?'0':null),scale:4,currency:'BRL',status:aggregate.balance==null&&aggregate.total!==0?'unknown' as const:'available' as const}]:[]),{...common,metricId:p.kind+'.registered',label:'Registros no filtro',value:aggregate.total}];
}
