import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
import {assertAccountingDate,assertAccountingPeriodOpen,balancedJournalLines,pgConflict} from '../../../../lib/domain/accounting';

export const dynamic='force-dynamic';

const line=z.object({
  id:z.string().uuid(),accountId:z.string().uuid(),side:z.enum(['debit','credit']),
  amount:z.string().min(1).max(24),
}).strict();
const entry=z.object({
  id:z.string().uuid(),effectiveDate:z.string(),sourceReference:z.string().trim().min(3).max(160),
  description:z.string().trim().min(3).max(4000),lines:z.array(line).min(2).max(100),
}).strict();

export async function GET(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const u=new URL(request.url);
    const page=Number(u.searchParams.get('page')??'1');
    if(!Number.isInteger(page)||page<1||page>100000)
      throw new ApiError(400,'VALIDATION_FAILED','Página contábil inválida.');
    const limit=25,offset=(page-1)*limit;
    const sql=[
      'SELECT j.id,j.effective_date AS "effectiveDate",j.source_reference AS "sourceReference",',
      'j.description,j.status,j.reversal_of AS "reversalOf",',
      'r.id AS "reversalId",COALESCE(SUM(l.debit),0)::text AS "debitScaled",',
      'COALESCE(SUM(l.credit),0)::text AS "creditScaled"',
      'FROM journal_entries j LEFT JOIN journal_lines l ON l.entry_id=j.id',
      'LEFT JOIN journal_entries r ON r.reversal_of=j.id AND r.actor_id=j.actor_id',
      "WHERE j.actor_id=? AND j.status='posted'",
      'GROUP BY j.id,r.id ORDER BY j.effective_date DESC,j.id DESC LIMIT ? OFFSET ?',
    ].join(' ');
    const rows=await database().prepare(sql).bind(context.actorId,limit+1,offset).all();
    const items=rows.results.slice(0,limit);
    return respond({items,pageInfo:{page,hasMore:rows.results.length>limit}},context);
  }catch(error){return failure(error,context);}
}

export async function POST(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const parsed=entry.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Revise data, origem e partidas contábeis.');
    const p=parsed.data;
    assertAccountingDate(p.effectiveDate);
    const lines=balancedJournalLines(p.lines);
    const hash=await fingerprint({actorId:context.actorId,entry:p});
    let replayed=false;
    await database().transaction(async query=>{
      const prior=await query('SELECT actor_id,request_hash,status FROM journal_entries WHERE id=$1 FOR UPDATE',[p.id]);
      if(prior.rows.length){
        if(prior.rows[0].actor_id!==context!.actorId||prior.rows[0].request_hash!==hash||prior.rows[0].status!=='posted')
          throw new ApiError(409,'JOURNAL_CONFLICT','O lançamento já existe com outro conteúdo.');
        replayed=true;
        return;
      }
      await assertAccountingPeriodOpen(query,context!.actorId,p.effectiveDate);
      const accountIds=[...new Set(lines.map(l=>l.accountId))];
      const owned=await query(
        'SELECT id FROM chart_accounts WHERE id=ANY($1::text[]) AND actor_id=$2 AND active=1',
        [accountIds,context!.actorId],
      );
      if(owned.rows.length!==accountIds.length)
        throw new ApiError(409,'ACCOUNT_UNAVAILABLE','Uma ou mais contas estão inativas ou não pertencem ao seu contexto.');
      await query(
        "INSERT INTO journal_entries (id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id,reversal_of) VALUES($1,$2,$3,$4,'posted',$5,$6,$7,$8,$9,NULL)",
        [p.id,p.effectiveDate,p.sourceReference,p.description,lines.length,
          new Date().toISOString(),context!.actorId,hash,context!.correlationId],
      );
      for(const l of lines) {
        await query(
          'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,$5)',
          [l.id,p.id,l.accountId,l.debit,l.credit],
        );
      }
    }).catch(pgConflict);
    return respond({ok:true,resource:{type:'journalEntry',id:p.id},replayed},context,replayed?200:201);
  }catch(error){return failure(error,context);}
}
