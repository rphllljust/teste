import {z} from 'zod';
import {databasePool} from '../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
type Issue={severity:'critical'|'warning';code:string;entityId:string;relatedId?:string};
type Measurement={id:string;amount:number;status:string};
type Invoice={id:string;measurement_id:string;order_id:string;amount:number};
type Receivable={id:string;invoice_id:string;amount:number};
type Settlement={id:string;receivable_id:string;kind:string;amount:number;reverses_id:string|null};
type Journal={id:string;source_reference:string;status:string;debit:string;credit:string};
const uuid=z.string().uuid();
const value=(amount:number)=>BigInt(String(amount));

/**
 * Owner-scoped, snapshot-consistent subledger verification. No writes, external
 * network calls, schema changes, document payloads or automatic GL claims.
 * Designed for on-demand checks without mutating any business evidence.
 */
export async function GET(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const {id}=await params;
    if(!uuid.safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Ordem inválida.');
    const client=await databasePool().connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const owned=await client.query<{id:string;status:string}>(
        'SELECT id,status FROM service_orders WHERE id=$1 AND owner_id=$2',
        [id,context.actorId],
      );
      if(!owned.rowCount)throw new ApiError(404,'NOT_FOUND','Ordem não encontrada.');
      const measurements=(await client.query<Measurement>(
        'SELECT id,amount,status FROM measurements WHERE order_id=$1 ORDER BY id',[id],
      )).rows;
      const measurementIds=measurements.map(x=>x.id);
      const invoices=(await client.query<Invoice>(
        'SELECT id,measurement_id,order_id,amount FROM invoices WHERE order_id=$1 OR measurement_id=ANY($2::text[]) ORDER BY id',
        [id,measurementIds],
      )).rows;
      const invoiceIds=invoices.map(x=>x.id);
      const receivables=(await client.query<Receivable>(
        'SELECT id,invoice_id,amount FROM receivables WHERE invoice_id=ANY($1::text[]) ORDER BY id',
        [invoiceIds],
      )).rows;
      const receivableIds=receivables.map(x=>x.id);
      const settlements=(await client.query<Settlement>(
        'SELECT id,receivable_id,kind,amount,reverses_id FROM receivable_settlements WHERE receivable_id=ANY($1::text[]) ORDER BY id',
        [receivableIds],
      )).rows;
      const journals=(await client.query<Journal>(
        `SELECT j.id,j.source_reference,j.status,
          COALESCE(SUM(l.debit),0)::text AS debit,
          COALESCE(SUM(l.credit),0)::text AS credit
         FROM journal_entries j LEFT JOIN journal_lines l ON l.entry_id=j.id
         WHERE j.actor_id=$1 AND (j.source_reference LIKE 'receivable_settlement:%' OR j.source_reference LIKE 'receivable_reversal:%')
         GROUP BY j.id,j.source_reference,j.status`,
        [context.actorId],
      )).rows;
      await client.query('COMMIT');
      const issues:Issue[]=[];
      const flag=(severity:Issue['severity'],code:string,entityId:string,relatedId?:string)=>{
        issues.push(relatedId?{severity,code,entityId,relatedId}:{severity,code,entityId});
      };
      if(owned.rows[0].status==='completed'&&!measurements.length)
        flag('warning','COMPLETED_ORDER_AWAITING_MEASUREMENT',id);
      const measurementMap=new Map(measurements.map(m=>[m.id,m]));
      const invoicesByMeasurement=new Map<string,Invoice[]>();
      for(const i of invoices){
        const entries=invoicesByMeasurement.get(i.measurement_id)??[];
        entries.push(i);invoicesByMeasurement.set(i.measurement_id,entries);
        const m=measurementMap.get(i.measurement_id);
        if(!m||i.order_id!==id)flag('critical','INVOICE_ORDER_OR_MEASUREMENT_MISMATCH',i.id,i.measurement_id);
        if(m&&value(i.amount)!==value(m.amount))
          flag('critical','INVOICE_AMOUNT_MISMATCH',i.id,m.id);
        if(m&&m.status!=='billed')flag('critical','INVOICE_ON_UNBILLED_MEASUREMENT',i.id,m.id);
      }
      for(const m of measurements){
        const count=invoicesByMeasurement.get(m.id)?.length??0;
        if(m.status==='billed'&&count!==1)flag('critical','BILLED_MEASUREMENT_INVOICE_COUNT',m.id);
        if(m.status==='approved'&&count===0)flag('warning','APPROVED_MEASUREMENT_AWAITING_INVOICE',m.id);
      }
      const receivablesByInvoice=new Map<string,Receivable[]>();
      for(const r of receivables){
        const entries=receivablesByInvoice.get(r.invoice_id)??[];
        entries.push(r);receivablesByInvoice.set(r.invoice_id,entries);
      }
      for(const i of invoices){
        const related=receivablesByInvoice.get(i.id)??[];
        if(related.length!==1)flag('critical','INVOICE_RECEIVABLE_COUNT',i.id);
        for(const r of related)
          if(value(r.amount)!==value(i.amount))
            flag('critical','RECEIVABLE_AMOUNT_MISMATCH',r.id,i.id);
      }
      let principal=0n,settled=0n;
      const journalsBySource=new Map(journals.map(j=>[j.source_reference,j]));
      const accountingIssues:Issue[]=[];
      for(const settlement of settlements){
        const prefix=settlement.kind==='reversal'?'receivable_reversal:':'receivable_settlement:';
        const match=[...journalsBySource.entries()].find(([source])=>source.startsWith(prefix+settlement.id));
        if(!match) accountingIssues.push({severity:'warning',code:'ACCOUNTING_PENDING_RULE',entityId:settlement.id});
        else if(match[1].debit!==match[1].credit) accountingIssues.push({severity:'critical',code:'ACCOUNTING_ENTRY_UNBALANCED',entityId:settlement.id,relatedId:match[1].id});
      }
      const settlementsByReceivable=new Map<string,Settlement[]>();
      for(const s of settlements){
        const entries=settlementsByReceivable.get(s.receivable_id)??[];
        entries.push(s);settlementsByReceivable.set(s.receivable_id,entries);
      }
      for(const r of receivables){
        principal+=value(r.amount);
        const rows=settlementsByReceivable.get(r.id)??[];
        const receipts=new Map(rows.filter(s=>s.kind==='receipt').map(s=>[s.id,s]));
        const reversals=new Set<string>();
        let net=0n;
        for(const entry of rows){
          const amount=value(entry.amount);
          if(amount<=0n)flag('critical','NON_POSITIVE_SETTLEMENT',entry.id);
          if(entry.kind==='receipt'){
            if(entry.reverses_id)flag('critical','RECEIPT_HAS_REVERSAL_REFERENCE',entry.id);
            net+=amount;
          }else if(entry.kind==='reversal'){
            net-=amount;
            const original=entry.reverses_id?receipts.get(entry.reverses_id):null;
            if(!original||value(original.amount)!==amount)
              flag('critical','REVERSAL_WITHOUT_MATCHING_RECEIPT',entry.id);
            if(entry.reverses_id&&reversals.has(entry.reverses_id))
              flag('critical','DUPLICATE_REVERSAL',entry.id);
            if(entry.reverses_id)reversals.add(entry.reverses_id);
          }else flag('critical','INVALID_SETTLEMENT_KIND',entry.id);
        }
        settled+=net;
        if(net<0n||net>value(r.amount))
          flag('critical','SETTLEMENT_BALANCE_OUT_OF_RANGE',r.id);
      }
      issues.sort((a,b)=>a.severity.localeCompare(b.severity)||
        a.code.localeCompare(b.code)||a.entityId.localeCompare(b.entityId)||
        (a.relatedId??'').localeCompare(b.relatedId??''));
      issues.push(...accountingIssues);
      issues.sort((a,b)=>a.severity.localeCompare(b.severity)||a.code.localeCompare(b.code)||a.entityId.localeCompare(b.entityId));
      const finalCritical=issues.filter(i=>i.severity==='critical').length;
      const finalWarnings=issues.length-finalCritical;
      return respond({
        orderId:id,status:finalCritical?'INCONSISTENT':finalWarnings?'PENDING':'CONSISTENT',
        scope:'owned_subledger_only',
        counts:{measurements:measurements.length,invoices:invoices.length,
          receivables:receivables.length,settlements:settlements.length,
          critical:finalCritical,warnings:finalWarnings},
        amountsScaled:{invoiced:invoices.reduce((n,i)=>n+value(i.amount),0n).toString(),
          receivablePrincipal:principal.toString(),netSettled:settled.toString(),
          outstanding:(principal-settled).toString()},
        accounting:{status:finalCritical?'INCONSISTENT':accountingIssues.length?'PENDING':'RECONCILED',
          journalCount:journals.length,
          balanced:journals.every(j=>j.debit===j.credit),
          reason:accountingIssues.length?'Some financial events have no matching automatic journal reference.':'Financial event journal references are balanced.'},
        issues,
      },context);
    }catch(error){
      await client.query('ROLLBACK').catch(()=>undefined);
      throw error;
    }finally{client.release();}
  }catch(error){return failure(error,context);}
}
