import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
import {pgConflict} from '../../../../lib/domain/accounting';

export const dynamic='force-dynamic';
const body=z.object({
  id:z.string().uuid(),
  fullName:z.string().trim().min(2).max(160),
  specialty:z.string().trim().min(2).max(120),
}).strict();

export async function GET(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const result=await database().prepare(
      'SELECT id,full_name AS "fullName",specialty,active,created_at AS "createdAt" FROM field_people WHERE owner_id=? ORDER BY full_name,id LIMIT 100',
    ).bind(context.actorId).all();
    return respond({items:result.results},context);
  }catch(error){return failure(error,context);}
}

export async function POST(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const parsed=body.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Nome e especialidade são obrigatórios.');
    const p=parsed.data;
    const hash=await fingerprint({actorId:context.actorId,payload:p});
    const result=await database().transaction(async query=>{
      const current=await query('SELECT owner_id,request_hash FROM field_people WHERE id=$1 FOR UPDATE',[p.id]);
      if(current.rows.length){
        if(current.rows[0].owner_id!==context!.actorId||current.rows[0].request_hash!==hash)
          throw new ApiError(409,'PERSON_CONFLICT','Identificador já utilizado para outro cadastro.');
        return {ok:true,replayed:true,personId:p.id};
      }
      await query(
        'INSERT INTO field_people(id,owner_id,full_name,specialty,request_hash) VALUES($1,$2,$3,$4,$5)',
        [p.id,context!.actorId,p.fullName,p.specialty,hash],
      );
      return {ok:true,replayed:false,personId:p.id};
    }).catch(pgConflict);
    return respond(result,context,result.replayed?200:201);
  }catch(error){return failure(error,context);}
}
