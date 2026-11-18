import { z } from 'zod';
import { databasePool } from '../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

const params=z.object({accountId:z.string().uuid(),from:z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),to:z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)});

export async function GET(request:Request):Promise<Response>{
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const parsed=params.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros do razão inválidos.');
  const p=parsed.data,db=databasePool(),account=await db.query('SELECT id,code,name,type FROM chart_accounts WHERE id=$1 AND actor_id=$2 AND active=1 LIMIT 1',[p.accountId,context.actorId]);
  if(!account.rowCount)throw new ApiError(404,'NOT_FOUND','Conta contábil não encontrada.');
  const filters=['e.actor_id=$1','l.account_id=$2','e.status=$3'],values:[string|number]=[context.actorId,p.accountId,'posted'];let next=4;
  if(p.from){filters.push(`e.effective_date >= $${next++}`);values.push(p.from);}
  if(p.to){filters.push(`e.effective_date <= $${next++}`);values.push(p.to);}
  const where=filters.join(' AND '),offset=(p.page-1)*p.pageSize;
  const total=await db.query(`SELECT COUNT(*)::int AS total FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE ${where}`,values);
  const totals=await db.query(`SELECT COALESCE(SUM(CASE WHEN e.effective_date < $4 THEN l.debit-l.credit ELSE 0 END),0)::text AS opening,
COALESCE(SUM(CASE WHEN e.effective_date >= $4 THEN l.debit ELSE 0 END),0)::text AS debit,COALESCE(SUM(CASE WHEN e.effective_date >= $4 THEN l.credit ELSE 0 END),0)::text AS credit FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.actor_id=$1 AND l.account_id=$2 AND e.status=$3`,[context.actorId,p.accountId,'posted',p.from??'9999-12-31']);
  const rows=await db.query(`SELECT l.id,l.entry_id AS "journalId",e.effective_date AS "effectiveDate",e.source_reference AS "sourceReference",e.description,l.debit::text AS "debitScaled",l.credit::text AS "creditScaled",e.reversal_of AS "reversalOf"
FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE ${where} ORDER BY e.effective_date ASC,e.id ASC,l.id ASC LIMIT $${next} OFFSET $${next+1}`,[...values,p.pageSize,offset]);
  const opening=Number(totals.rows[0]?.opening??0),debit=Number(totals.rows[0]?.debit??0),credit=Number(totals.rows[0]?.credit??0);
  return respond({account:account.rows[0],items:rows.rows,pageInfo:{page,pageSize:p.pageSize,total:total.rows[0]?.total??0,hasMore:offset+rows.rows.length<(total.rows[0]?.total??0)},totals:{openingScaled:String(opening),debitScaled:String(debit),creditScaled:String(credit),closingScaled:String(opening+debit-credit)},emptyState:rows.rowCount?'':total.rows[0]?.total?'page-empty':'source-empty',warnings:[],generatedAt:new Date().toISOString()},context);
 }catch(error){return failure(error,context);}
}
