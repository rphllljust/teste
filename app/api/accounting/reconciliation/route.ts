import { database } from '../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic='force-dynamic';

/**
 * Read-only and fail-closed. A human-readable journal source_reference is not an
 * invoice linkage; until a persisted source relation exists, report every
 * invoice as lacking *verified* accounting posting.
 */
export async function GET(request:Request){
  let ctx:RequestContext|undefined;
  try{
    ctx=requestContext(request);
    const [summary,entries,items]=await Promise.all([
      database().prepare(
        'SELECT COUNT(*)::int AS "invoiceCount", '+
        'COALESCE(SUM(i.amount),0)::text AS "invoiceAmountScaled", '+
        'COUNT(*) FILTER (WHERE r.id IS NULL)::int AS "missingReceivableCount" '+
        'FROM invoices i JOIN service_orders o ON o.id=i.order_id '+
        'LEFT JOIN receivables r ON r.invoice_id=i.id '+
        'WHERE o.owner_id=?',
      ).bind(ctx.actorId).first<{invoiceCount:number;invoiceAmountScaled:string;missingReceivableCount:number}>(),
      database().prepare(
        "SELECT COUNT(*)::int AS \"journalCount\" FROM journal_entries WHERE actor_id=? AND status='posted'",
      ).bind(ctx.actorId).first<{journalCount:number}>(),
      database().prepare(
        'SELECT i.id AS "invoiceId",i.order_id AS "orderId",i.measurement_id AS "measurementId",'+
        'i.amount::text AS "amountScaled",i.due_date AS "dueDate",r.id AS "receivableId" '+
        'FROM invoices i JOIN service_orders o ON o.id=i.order_id '+
        'LEFT JOIN receivables r ON r.invoice_id=i.id '+
        'WHERE o.owner_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 20',
      ).bind(ctx.actorId).all(),
    ]);
    const invoiceCount=summary?.invoiceCount??0;
    return respond({
      generatedAt:new Date().toISOString(),
      accountingLinkage:{status:'NOT_SUPPORTED',reason:'Sem vínculo contábil persistido por fatura. Referência textual do diário não é prova de contabilização.'},
      summary:{
        invoiceCount,
        withoutVerifiedPostingCount:invoiceCount,
        withoutVerifiedPostingAmountScaled:summary?.invoiceAmountScaled??'0',
        missingReceivableCount:summary?.missingReceivableCount??0,
        standaloneJournalCount:entries?.journalCount??0,
      },
      items:items.results,
    },ctx);
  }catch(error){return failure(error,ctx);}
}
