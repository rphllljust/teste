import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,requestContext,respond,failure,validDate,type RequestContext} from '../../../../lib/api/http';

export const dynamic='force-dynamic';
type Account={id:string;code:string;name:string;type:'asset'|'expense'|'liability'|'equity'|'revenue'};
type RawTotal={periodCount:number|string;sourceCount:number|string;priorDebit:string;priorCredit:string;periodDebit:string;periodCredit:string};
const input=z.object({
 accountId:z.string().uuid(),
 from:z.string().refine(validDate).optional(),
 to:z.string().refine(validDate).optional(),
 page:z.coerce.number().int().min(1).max(100000).default(1),
}).strict().refine(p=>!p.from||!p.to||p.from<=p.to);

export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const search=new URL(request.url).searchParams;
  if(!search.get('accountId')){
   return respond({
    items:[],pageInfo:{page:1,total:0,hasMore:false},
    totals:{openingScaled:'0',debitScaled:'0',creditScaled:'0',closingScaled:'0'},
    emptyState:'source-empty',warnings:[],generatedAt:new Date().toISOString(),
   },context);
  }
  const parsed=input.safeParse(Object.fromEntries(search));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Conta, período ou paginação inválidos.');
  const p=parsed.data,from=p.from??'',to=p.to??'';
  const source='FROM journal_lines l JOIN journal_entries j ON j.id=l.entry_id '+
   "WHERE l.account_id=? AND j.actor_id=? AND j.status='posted'";
  const rowsSql=[
   'SELECT l.id,j.id AS "journalId",j.effective_date AS "effectiveDate",',
   'j.source_reference AS "sourceReference",j.description,',
   'l.debit::text AS "debitScaled",l.credit::text AS "creditScaled",',
   'j.reversal_of AS "reversalOf"',
   source,
   "AND (?::text='' OR j.effective_date>=?) AND (?::text='' OR j.effective_date<=?)",
   'ORDER BY j.effective_date DESC,j.id DESC,l.id DESC LIMIT ? OFFSET ?',
  ].join(' ');
  const totalSql=[
   'WITH params AS (SELECT NULLIF(?::text,\'\')::date AS date_from,NULLIF(?::text,\'\')::date AS date_to),',
   'movements AS (SELECT j.effective_date::date AS day,l.debit,l.credit '+source+'),',
   'period AS (SELECT m.*,p.date_from,p.date_to FROM movements m CROSS JOIN params p)',
   'SELECT COUNT(*)::int AS "sourceCount",',
   'COUNT(*) FILTER (WHERE (date_from IS NULL OR day>=date_from) AND (date_to IS NULL OR day<=date_to))::int AS "periodCount",',
   'COALESCE(SUM(debit) FILTER (WHERE date_from IS NOT NULL AND day<date_from),0)::text AS "priorDebit",',
   'COALESCE(SUM(credit) FILTER (WHERE date_from IS NOT NULL AND day<date_from),0)::text AS "priorCredit",',
   'COALESCE(SUM(debit) FILTER (WHERE (date_from IS NULL OR day>=date_from) AND (date_to IS NULL OR day<=date_to)),0)::text AS "periodDebit",',
   'COALESCE(SUM(credit) FILTER (WHERE (date_from IS NULL OR day>=date_from) AND (date_to IS NULL OR day<=date_to)),0)::text AS "periodCredit"',
   'FROM period',
  ].join(' ');
  const db=database();
  const results=await db.batch([
   db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').bind(),
   db.prepare('SELECT id,code,name,type FROM chart_accounts WHERE id=? AND actor_id=?').bind(p.accountId,context.actorId),
   db.prepare(rowsSql).bind(p.accountId,context.actorId,from,from,to,to,26,(p.page-1)*25),
   db.prepare(totalSql).bind(from,to,p.accountId,context.actorId),
  ]);
  const account=results[1].results[0] as Account|undefined;
  if(!account){
   return respond({
    items:[],pageInfo:{page:p.page,total:0,hasMore:false},
    totals:{openingScaled:'0',debitScaled:'0',creditScaled:'0',closingScaled:'0'},
    emptyState:'source-empty',warnings:[],generatedAt:new Date().toISOString(),
   },context);
  }
  const t=(results[3].results[0]??{}) as Partial<RawTotal>;
  const debitNormal=account.type==='asset'||account.type==='expense';
  const balance=(debit:bigint,credit:bigint)=>debitNormal?debit-credit:credit-debit;
  const opening=balance(BigInt(t.priorDebit??'0'),BigInt(t.priorCredit??'0'));
  const periodDebit=BigInt(t.periodDebit??'0');
  const periodCredit=BigInt(t.periodCredit??'0');
  const closing=opening+balance(periodDebit,periodCredit);
  const total=Number(t.periodCount??0),sourceCount=Number(t.sourceCount??0);
  return respond({
   account,items:results[2].results.slice(0,25),
   pageInfo:{page:p.page,total,hasMore:total>p.page*25},
   totals:{
    openingScaled:String(opening),debitScaled:String(periodDebit),
    creditScaled:String(periodCredit),closingScaled:String(closing),
    normalSide:debitNormal?'debit':'credit',moneyScale:4,
   },
   period:{from:from||null,to:to||null},
   emptyState:sourceCount===0?'source-empty':total===0?'period-empty':results[2].results.length<=((p.page-1)*25)?'page-empty':null,
   warnings:['Saldos por natureza da conta e competência efetiva. Estornos publicados compõem o movimento com sinal contábil próprio.'],
   generatedAt:new Date().toISOString(),
  },context);
 }catch(error){return failure(error,context);}
}
