import {z} from 'zod';
import {ApiError} from '../api/http';
import {database} from '../../db/raw';
const history=z.object({historyPage:z.coerce.number().int().min(1).max(100000).default(1)}).strict();
export function parseHistoryPage(request:Request){const parsed=history.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Página de histórico inválida.');return parsed.data.historyPage;}
export function financialHistory(kind:'receivables'|'payables',id:string,page:number){
 const db=database(),table=kind==='receivables'?'receivable_settlements':'payable_payments',parent=kind==='receivables'?'receivable_id':'payable_id',normal=kind==='receivables'?'receipt':'payment',matchField=kind==='receivables'?'receipt_id':'payment_id';
 const reversible=`s.kind='${normal}' AND NOT EXISTS(SELECT 1 FROM ${table} x WHERE x.reverses_id=s.id) AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events m WHERE m.${matchField}=s.id AND m.kind='match' AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id))`;
 return [
  db.prepare(`SELECT s.id,s.kind,CAST(s.amount AS TEXT) amountScaled,s.effective_date effectiveDate,s.reference,s.reverses_id reversesId,s.created_at createdAt,EXISTS(SELECT 1 FROM ${table} x WHERE x.reverses_id=s.id) reversed,CASE WHEN ${reversible} THEN 1 ELSE 0 END canReverse FROM ${table} s WHERE s.${parent}=? ORDER BY s.created_at DESC,s.id DESC LIMIT 50 OFFSET ?`).bind(id,(page-1)*50),
  db.prepare(`SELECT COUNT(*) total FROM ${table} s WHERE s.${parent}=? AND ${reversible}`).bind(id),
 ];
}
export function historyPageInfo(page:number,total:number){return {page,limit:50,offset:(page-1)*50,total,hasMore:page*50<total};}
