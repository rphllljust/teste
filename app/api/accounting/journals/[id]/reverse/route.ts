import { z } from 'zod';
import { databasePool } from '../../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../lib/api/http';

const input=z.object({key:z.string().uuid(),effectiveDate:z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),sourceReference:z.string().trim().min(3).max(160),description:z.string().trim().min(3).max(4000)}).strict();

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}):Promise<Response>{
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const {id}=await params;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Lançamento inválido.');
  const parsed=input.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Dados do estorno inválidos.');
  const p=parsed.data,hash=await fingerprint({actor:context.actorId,scope:'journalEntry',command:'reverse',payload:{originalId:id,...p}});
  const db=databasePool(),client=await db.connect();
  try{
   await client.query('BEGIN');
   const original=await client.query('SELECT id,status,reversal_of FROM journal_entries WHERE id=$1 AND actor_id=$2 FOR UPDATE',[id,context.actorId]);
   if(!original.rowCount)throw new ApiError(404,'NOT_FOUND','Lançamento não encontrado.');
   if(original.rows[0].status!=='posted'||original.rows[0].reversal_of)throw new ApiError(409,'INVALID_STATE','Somente lançamento postado original pode ser estornado.');
   const already=await client.query('SELECT id FROM journal_entries WHERE reversal_of=$1 LIMIT 1',[id]);
   if(already.rowCount)throw new ApiError(409,'ALREADY_REVERSED','Este lançamento já possui estorno.');
   const lines=await client.query('SELECT id,account_id,debit,credit FROM journal_lines WHERE entry_id=$1 ORDER BY id',[id]);
   const reversalId=crypto.randomUUID(),now=new Date().toISOString();
   await client.query('INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id,reversal_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[reversalId,p.effectiveDate,p.sourceReference,p.description,'posted',lines.rowCount,now,context.actorId,hash,context.correlationId,id]);
   for(const line of lines.rows)await client.query('INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),reversalId,line.account_id,line.credit,line.debit]);
   await client.query('COMMIT');
   return respond({entry:{id:reversalId,reversalOf:id,status:'posted'}},context,201);
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }catch(error){return failure(error,context);}
}
