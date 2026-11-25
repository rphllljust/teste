import { database } from '../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic='force-dynamic';

// Verified means *a currently posted and unreversed* journal is linked by the
// append-only invoice link. Free-text source_reference never certifies posting.
const verified="l.id IS NOT NULL AND l.amount=i.amount AND j.status='posted' AND j.reversal_of IS NULL AND rev.id IS NULL";
const sources=
 'FROM invoices i JOIN service_orders o ON o.id=i.order_id '+
 'LEFT JOIN receivables r ON r.invoice_id=i.id '+
 'LEFT JOIN accounting_invoice_links l ON l.invoice_id=i.id AND l.actor_id=o.owner_id '+
 'LEFT JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=o.owner_id '+
 'LEFT JOIN journal_entries rev ON rev.reversal_of=j.id '+
 'WHERE o.owner_id=?';

export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const [summary,entries,items]=await Promise.all([
   database().prepare(
    'SELECT COUNT(*)::int AS "invoiceCount", '+
    'COALESCE(SUM(i.amount),0)::text AS "invoiceAmountScaled", '+
    'COUNT(*) FILTER (WHERE NOT ('+verified+'))::int AS "withoutVerifiedPostingCount", '+
    'COALESCE(SUM(i.amount) FILTER (WHERE NOT ('+verified+')),0)::text AS "withoutVerifiedPostingAmountScaled", '+
    'COUNT(*) FILTER (WHERE '+verified+')::int AS "verifiedPostingCount", '+
    "COUNT(*) FILTER (WHERE "+verified+" AND l.posting_mode='automatic_invoice')::int AS \"automaticPostingCount\", "+
    "COUNT(*) FILTER (WHERE "+verified+" AND l.posting_mode='manual_verified')::int AS \"manualVerifiedCount\", "+
    'COUNT(*) FILTER (WHERE r.id IS NULL)::int AS "missingReceivableCount" '+
    sources,
   ).bind(ctx.actorId).first<{
    invoiceCount:number;invoiceAmountScaled:string;verifiedPostingCount:number;automaticPostingCount:number;manualVerifiedCount:number;
    withoutVerifiedPostingCount:number;withoutVerifiedPostingAmountScaled:string;missingReceivableCount:number;
   }>(),
   database().prepare(
    "SELECT COUNT(*)::int AS \"journalCount\" FROM journal_entries WHERE actor_id=? AND status='posted'",
   ).bind(ctx.actorId).first<{journalCount:number}>(),
   database().prepare(
    'SELECT i.id AS "invoiceId",i.order_id AS "orderId",i.measurement_id AS "measurementId",'+
    'i.amount::text AS "amountScaled",i.due_date AS "dueDate",r.id AS "receivableId", '+
    'l.id AS "linkId",j.id AS "journalId",l.posting_mode AS "postingMode",('+verified+') AS "verifiedPosting", '+
    '(rev.id IS NOT NULL) AS "journalReversed" '+
    sources+' ORDER BY i.created_at DESC,i.id DESC LIMIT 20',
   ).bind(ctx.actorId).all(),
  ]);
  return respond({
   generatedAt:new Date().toISOString(),
   accountingLinkage:{
    status:'CONFIGURABLE_AUTO_POSTING',
    reason:'Contabilização automática somente para novas faturas com regra explícita ativa; vínculos manuais preservados. Publicação e estornos são verificados.',
   },
   summary:{
    invoiceCount:summary?.invoiceCount??0,
    invoiceAmountScaled:summary?.invoiceAmountScaled??'0',
    verifiedPostingCount:summary?.verifiedPostingCount??0,
    automaticPostingCount:summary?.automaticPostingCount??0,
    manualVerifiedCount:summary?.manualVerifiedCount??0,
    withoutVerifiedPostingCount:summary?.withoutVerifiedPostingCount??0,
    withoutVerifiedPostingAmountScaled:summary?.withoutVerifiedPostingAmountScaled??'0',
    missingReceivableCount:summary?.missingReceivableCount??0,
    standaloneJournalCount:entries?.journalCount??0,
   },
   items:items.results,
  },ctx);
 }catch(error){return failure(error,ctx);}
}
