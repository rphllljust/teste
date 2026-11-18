import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,requestContext,respond,validDate,type RequestContext} from '../../../../lib/api/http';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const u=new URL(request.url),raw=Object.fromEntries(u.searchParams);
    const parsed=z.object({
      accountId:z.string().uuid(),page:z.coerce.number().int().min(1).max(100000).default(1),
      from:z.string().optional(),to:z.string().optional(),
    }).strict().safeParse(raw);
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Consulta do razão inválida.');
    const p=parsed.data;
    if((p.from&&!validDate(p.from))||(p.to&&!validDate(p.to))||
      (p.from&&p.to&&p.from>p.to))
      throw new ApiError(400,'VALIDATION_FAILED','Intervalo do razão inválido.');
    const account=await database().prepare(
      'SELECT id,code,name,type FROM chart_accounts WHERE id=? AND actor_id=?',
    ).bind(p.accountId,context.actorId).first();
    if(!account)throw new ApiError(404,'NOT_FOUND','Conta contábil não encontrada.');
    const base=[
      'FROM journal_lines l JOIN journal_entries j ON j.id=l.entry_id',
      "WHERE l.account_id=? AND j.actor_id=? AND j.status='posted'",
    ].join(' ');
    const within=" AND (CAST(? AS text) IS NULL OR j.effective_date>=?) AND (CAST(? AS text) IS NULL OR j.effective_date<=?)";
    const params=[p.accountId,context.actorId,p.from??null,p.from??null,p.to??null,p.to??null];
    const results=await database().batch([
      database().prepare(
        'SELECT COALESCE(SUM(l.debit-l.credit),0)::text AS balance '+base+
        ' AND (CAST(? AS text) IS NOT NULL AND j.effective_date<?)',
      ).bind(p.accountId,context.actorId,p.from??null,p.from??null),
      database().prepare(
        'SELECT COUNT(*)::int AS total,COALESCE(SUM(l.debit),0)::text AS debit,'+
        'COALESCE(SUM(l.credit),0)::text AS credit '+base+within,
      ).bind(...params),
      database().prepare(
        'SELECT l.id,j.id AS "journalId",j.effective_date AS "effectiveDate",'+
        'j.source_reference AS "sourceReference",j.description,'+
        'l.debit::text AS "debitScaled",l.credit::text AS "creditScaled",'+
        'j.reversal_of AS "reversalOf" '+base+within+
        ' ORDER BY j.effective_date,j.id,l.id LIMIT ? OFFSET ?',
      ).bind(...params,26,(p.page-1)*25),
      database().prepare('SELECT COUNT(*)::int AS total '+base).bind(p.accountId,context.actorId),
    ]);
    const opening=BigInt(String((results[0].results[0] as {balance:string}).balance));
    const current=results[1].results[0] as {total:number;debit:string;credit:string};
    const total=Number(current.total);
    const rows=results[2].results;
    const sourceTotal=Number((results[3].results[0] as {total:number}).total);
    return respond({
      account,items:rows.slice(0,25),
      pageInfo:{page:p.page,total,hasMore:rows.length>25},
      totals:{openingScaled:opening.toString(),debitScaled:current.debit,
        creditScaled:current.credit,
        closingScaled:(opening+BigInt(current.debit)-BigInt(current.credit)).toString()},
      emptyState:sourceTotal===0?'source-empty':total===0?'period-empty':rows.length===0?'page-empty':null,
      warnings:[],generatedAt:new Date().toISOString(),
    },context);
  }catch(error){return failure(error,context);}
}
