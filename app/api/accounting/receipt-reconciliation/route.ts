import {database} from '../../../../db/raw';
import {failure,requestContext,respond,type RequestContext} from '../../../../lib/api/http';

export const dynamic='force-dynamic';
const valid="l.id IS NOT NULL AND l.kind=s.kind AND l.amount=s.amount AND j.status='posted' AND j.effective_date=s.effective_date";
const source=
 'FROM receivable_settlements s JOIN receivables r ON r.id=s.receivable_id '+
 'JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id '+
 'LEFT JOIN accounting_settlement_links l ON l.settlement_id=s.id AND l.actor_id=o.owner_id '+
 'LEFT JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=o.owner_id '+
 'WHERE o.owner_id=?';

export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const [summary,items]=await Promise.all([
   database().prepare(
    'SELECT COUNT(*)::int AS "eventCount", '+
    'COUNT(*) FILTER (WHERE '+valid+')::int AS "postedEvents", '+
    'COUNT(*) FILTER (WHERE NOT ('+valid+'))::int AS "unpostedEvents", '+
    "COUNT(*) FILTER (WHERE s.kind='reversal')::int AS \"reversals\", "+
    "COALESCE(SUM(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END),0)::text AS \"netSettlementAmountScaled\", "+
    'COALESCE(SUM(CASE WHEN '+valid+
      " THEN CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END ELSE 0 END),0)::text AS \"netLedgerAmountScaled\" "+
    source,
   ).bind(ctx.actorId).first<{
    eventCount:number;postedEvents:number;unpostedEvents:number;reversals:number;
    netSettlementAmountScaled:string;netLedgerAmountScaled:string;
   }>(),
   database().prepare(
    'SELECT s.id AS "settlementId",s.receivable_id AS "receivableId",'+
    's.kind,s.amount::text AS "amountScaled",s.effective_date AS "effectiveDate",s.reference,'+
    'l.journal_id AS "journalId",('+valid+') AS "posted" '+
    source+' ORDER BY s.created_at DESC,s.id DESC LIMIT 25',
   ).bind(ctx.actorId).all(),
  ]);
  return respond({
   generatedAt:new Date().toISOString(),
   reconciliation:{
    scope:'owner_receivable_settlement_events',
    status:'OPT_IN_CASH_POSTING',
    note:'Total financeiro inclui eventos anteriores sem razão; ausência de vínculo não é contabilização automática. Reversões são eventos separados com partidas inversas.',
   },
   summary:{
    eventCount:summary?.eventCount??0,
    postedEvents:summary?.postedEvents??0,
    unpostedEvents:summary?.unpostedEvents??0,
    reversals:summary?.reversals??0,
    netSettlementAmountScaled:summary?.netSettlementAmountScaled??'0',
    netLedgerAmountScaled:summary?.netLedgerAmountScaled??'0',
   },items:items.results,
  },ctx);
 }catch(error){return failure(error,ctx);}
}
