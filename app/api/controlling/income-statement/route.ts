import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
import {assembleIncomeStatement,incomeStatementBoundaries} from '../../../../lib/domain/income-statement.mjs';
export const dynamic='force-dynamic';
const input=z.object({periodMonth:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)}).strict();
type InputRow={id:string;code:string;name:string;type:'revenue'|'expense';currentScaled:string;priorScaled:string;
 currentLineCount:number;priorLineCount:number};
/** Managerial result comes exclusively from posted owner-scoped journal lines.
 * Both periods are sampled within a single read-only repeatable-read snapshot.
 * No revenue or expenditure is inferred from invoices, cash, budget, or zero bank extracts.
 */
export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const params=new URL(request.url).searchParams;
  const parsed=input.safeParse(Object.fromEntries(params));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Informe uma competência válida (AAAA-MM).');
  const period=incomeStatementBoundaries(parsed.data.periodMonth);
  const sql=[
   'WITH movements AS (',
    'SELECT l.account_id,',
    "COALESCE(SUM(CASE WHEN j.effective_date >= $2 THEN CASE WHEN c.type='revenue' ",
    'THEN l.credit::numeric-l.debit::numeric ELSE l.debit::numeric-l.credit::numeric END ELSE 0 END),0)::text AS current_scaled,',
    "COALESCE(SUM(CASE WHEN j.effective_date < $2 THEN CASE WHEN c.type='revenue' ",
    'THEN l.credit::numeric-l.debit::numeric ELSE l.debit::numeric-l.credit::numeric END ELSE 0 END),0)::text AS prior_scaled,',
    'COUNT(*) FILTER (WHERE j.effective_date >= $2)::int AS current_count,',
    'COUNT(*) FILTER (WHERE j.effective_date < $2)::int AS prior_count',
    'FROM journal_entries j JOIN journal_lines l ON l.entry_id=j.id',
    'JOIN chart_accounts c ON c.id=l.account_id AND c.actor_id=j.actor_id',
    "AND c.type IN ('revenue','expense')",
    "WHERE j.actor_id=$1 AND j.status='posted'",
    'AND j.effective_date >= $4 AND j.effective_date < $3 GROUP BY l.account_id',
   ')',
   'SELECT c.id,c.code,c.name,c.type,',
   "COALESCE(m.current_scaled,'0') AS \"currentScaled\",",
   "COALESCE(m.prior_scaled,'0') AS \"priorScaled\",",
   'COALESCE(m.current_count,0)::int AS "currentLineCount",',
   'COALESCE(m.prior_count,0)::int AS "priorLineCount"',
   'FROM chart_accounts c LEFT JOIN movements m ON m.account_id=c.id',
   "WHERE c.actor_id=$1 AND c.type IN ('revenue','expense') ORDER BY c.type DESC,c.code,c.id"
  ].join(' ');
  const rows=await database().transaction(async query=>{
   await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const result=await query(sql,[ctx!.actorId,period.from,period.toExclusive,period.priorFrom]);
   return result.rows as InputRow[];
  });
  return respond({...assembleIncomeStatement(rows,period.periodMonth,period.priorMonth),
   generatedAt:new Date().toISOString()},ctx);
 }catch(e){return failure(e,ctx);}
}
