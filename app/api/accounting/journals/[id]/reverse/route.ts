import {z} from 'zod';
import {database} from '../../../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../../../lib/api/http';
import {assertAccountingDate,assertAccountingPeriodOpen,pgConflict} from '../../../../../../lib/domain/accounting';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
const input=z.object({
  key:z.string().uuid(),effectiveDate:z.string(),
  sourceReference:z.string().trim().min(3).max(160),
  description:z.string().trim().min(3).max(4000),
}).strict();

export async function POST(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const {id}=await params;
    if(!z.string().uuid().safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Lançamento original inválido.');
    const parsed=input.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Revise os dados do estorno.');
    const p=parsed.data;
    assertAccountingDate(p.effectiveDate);
    if(p.key===id)throw new ApiError(400,'VALIDATION_FAILED','Use outro identificador para o estorno.');
    const hash=await fingerprint({actorId:context.actorId,reverseId:id,payload:p});
    let replayed=false;
    await database().transaction(async query=>{
      const original=await query(
        'SELECT id,effective_date,status,reversal_of FROM journal_entries WHERE id=$1 AND actor_id=$2 FOR UPDATE',
        [id,context!.actorId],
      );
      if(!original.rows.length)throw new ApiError(404,'NOT_FOUND','Lançamento não encontrado.');
      if(original.rows[0].status!=='posted'||original.rows[0].reversal_of)
        throw new ApiError(409,'INVALID_STATE','Somente lançamentos originais postados podem ser estornados.');
      if(p.effectiveDate<original.rows[0].effective_date)
        throw new ApiError(409,'INVALID_DATE','O estorno não pode anteceder o lançamento original.');
      const prior=await query(
        'SELECT id,actor_id,request_hash FROM journal_entries WHERE reversal_of=$1 OR id=$2 FOR UPDATE',
        [id,p.key],
      );
      if(prior.rows.length){
        if(prior.rows.length===1&&prior.rows[0].id===p.key&&
          prior.rows[0].actor_id===context!.actorId&&prior.rows[0].request_hash===hash){
          replayed=true;
          return;
        }
        throw new ApiError(409,'ALREADY_REVERSED','A operação já foi registrada ou estornada.');
      }
      await assertAccountingPeriodOpen(query,context!.actorId,p.effectiveDate);
      const rows=await query('SELECT account_id,debit,credit FROM journal_lines WHERE entry_id=$1 ORDER BY id',[id]);
      if(rows.rows.length<2)throw new ApiError(409,'JOURNAL_INVARIANT','O lançamento original não tem partidas válidas.');
      let debits=0n,credits=0n;
      for(const l of rows.rows) {
        debits+=BigInt(String(l.debit));credits+=BigInt(String(l.credit));
      }
      if(debits!==credits||debits===0n)
        throw new ApiError(409,'JOURNAL_INVARIANT','O lançamento original está desequilibrado.');
      await query(
        "INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id,reversal_of) VALUES($1,$2,$3,$4,'posted',$5,$6,$7,$8,$9,$10)",
        [p.key,p.effectiveDate,p.sourceReference,p.description,rows.rows.length,
          new Date().toISOString(),context!.actorId,hash,context!.correlationId,id],
      );
      for(const l of rows.rows)await query(
        'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,$5)',
        [crypto.randomUUID(),p.key,l.account_id,l.credit,l.debit],
      );
    }).catch(pgConflict);
    return respond({ok:true,replayed,resource:{type:'journalReversal',id:p.key,reversesId:id}},
      context,replayed?200:201);
  }catch(error){return failure(error,context);}
}
