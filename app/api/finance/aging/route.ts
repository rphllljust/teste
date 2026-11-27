import { z } from 'zod';
import { database } from '../../../../db/raw';
import { outstandingExpression } from '../../../../lib/projections/operation';
import { payableBalance } from '../../../../lib/projections/payables';
import { ApiError, failure, requestContext, respond, validDate, type RequestContext } from '../../../../lib/api/http';

export const dynamic='force-dynamic';
const validAsOf=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate);
const buckets=['not_due','overdue_1_30','overdue_31_60','overdue_61_90','overdue_91_plus'] as const;
type BucketRow={bucket:string;count:string|number;value:string};
function agingQuery(kind:'receivables'|'payables'){
 const ar=kind==='receivables';
 const source=ar
  ? 'FROM receivables r JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id WHERE o.owner_id=?'
  : 'FROM payables p WHERE p.actor_id=?';
 const due=ar?'r.due_date':'p.due_date';
 const balance=ar?outstandingExpression:payableBalance;
 return [
  'WITH ref AS (SELECT ?::date AS as_of),',
  'balances AS (SELECT '+due+'::date AS due_date,('+balance+')::bigint AS amount '+source+'),',
  'classified AS (SELECT CASE',
  "WHEN b.due_date>=ref.as_of THEN 'not_due'",
  "WHEN ref.as_of-b.due_date<=30 THEN 'overdue_1_30'",
  "WHEN ref.as_of-b.due_date<=60 THEN 'overdue_31_60'",
  "WHEN ref.as_of-b.due_date<=90 THEN 'overdue_61_90'",
  "ELSE 'overdue_91_plus' END AS bucket,b.amount",
  'FROM balances b CROSS JOIN ref WHERE b.amount>0)',
  'SELECT bucket,COUNT(*)::int AS count,COALESCE(SUM(amount),0)::text AS value',
  'FROM classified GROUP BY bucket ORDER BY bucket',
 ].join(' ');
}
// Import statements are evidence, not real-time or reconciled balances.
// Matching is only active if no subsequent reversal targets the match event.
const bankQuery=[
 'WITH latest AS (SELECT DISTINCT ON (s.account_reference)',
 's.id,s.period_end,s.closing_balance FROM bank_statements s WHERE s.actor_id=?',
 'ORDER BY s.account_reference,s.period_end DESC,s.id DESC),',
 'coverage AS (SELECT latest.*,',
 '(SELECT COUNT(*)::int FROM bank_statement_lines l WHERE l.statement_id=latest.id',
 "AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events m WHERE m.line_id=l.id AND m.kind='match'",
 'AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=m.id))) AS pending',
 'FROM latest)',
 'SELECT COUNT(*)::int AS "accountCount",COALESCE(SUM(pending),0)::int AS "pendingLines",',
 "COUNT(*) FILTER (WHERE period_end::date < (?::date - INTERVAL '30 days') OR period_end::date > ?::date)::int AS \"staleAccounts\",",
 'MAX(period_end) AS "latestStatementEnd",',
 'CASE WHEN COUNT(*)=0 THEN NULL ELSE SUM(closing_balance)::text END AS "reportedBalanceScaled"',
 'FROM coverage',
].join(' ');

export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const asOf=new URL(request.url).searchParams.get('asOf')??new Date().toISOString().slice(0,10);
  if(!validAsOf.safeParse(asOf).success)throw new ApiError(400,'VALIDATION_FAILED','Referência de vencimento inválida.');
  const db=database();
  const result=await db.batch([
   db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').bind(),
   db.prepare(agingQuery('receivables')).bind(asOf,ctx.actorId),
   db.prepare(agingQuery('payables')).bind(asOf,ctx.actorId),
   db.prepare(bankQuery).bind(ctx.actorId,asOf,asOf),
  ]);
  const normalize=(rows:unknown[])=>{
   const map=new Map((rows as BucketRow[]).map(row=>[row.bucket,row]));
   return buckets.map(bucket=>{
    const r=map.get(bucket),valueScaled=String(r?.value??'0');
    if(!/^\d+$/.test(valueScaled))throw new Error('CISNE_FINANCE_OWNER_INVARIANT: negative outstanding');
    return {bucket,count:Number(r?.count??0),valueScaled};
   });
  };
  const bank=(result[3].results[0]??{}) as {
   accountCount?:number|string;pendingLines?:number|string;staleAccounts?:number|string;
   latestStatementEnd?:string|null;reportedBalanceScaled?:string|null;
  };
  const accountCount=Number(bank.accountCount??0);
  return respond({
   asOf,generatedAt:new Date().toISOString(),scope:'authenticated_owner',currency:'BRL',moneyScale:4,
   basis:'current_outstanding_by_due_date',
   receivables:{buckets:normalize(result[1].results),authority:'receivables.persistedSettlementLedger.v1'},
   payables:{buckets:normalize(result[2].results),authority:'payables.persistedPaymentLedger.v1'},
   bankCoverage:{
    accountCount,pendingLines:Number(bank.pendingLines??0),
    staleAccounts:Number(bank.staleAccounts??0),
    latestStatementEnd:bank.latestStatementEnd??null,
    reportedBalanceScaled:accountCount?String(bank.reportedBalanceScaled??'0'):null,
    availableCashScaled:null,consolidated:false,authority:'latest_imported_statement_per_account.v1',
   },
   warnings:[
    'Aging da posição atual por data de vencimento; não reconstitui o saldo histórico na data consultada.',
    'Soma de extratos distintos e possivelmente defasados não representa saldo disponível ou posição bancária consolidada.',
   ],
  },ctx);
 }catch(error){return failure(error,ctx);}
}
