import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
import {pgConflict} from '../../../../lib/domain/accounting';

export const dynamic='force-dynamic';

const input=z.object({
  id:z.string().uuid(),code:z.string().trim().regex(/^[A-Za-z0-9._-]{2,32}$/),
  name:z.string().trim().min(3).max(160),
  type:z.enum(['asset','liability','equity','revenue','expense']),
}).strict();

export async function GET(request:Request){
  let context:RequestContext|undefined;
  try {
    context=requestContext(request);
    const r=await database().prepare(
      'SELECT id,code,name,type,active FROM chart_accounts WHERE actor_id=? ORDER BY code,id',
    ).bind(context.actorId).all();
    return respond({items:r.results},context);
  } catch(error){return failure(error,context);}
}

export async function POST(request:Request){
  let context:RequestContext|undefined;
  try {
    context=requestContext(request,true);
    const parsed=input.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Revise os dados da conta contábil.');
    const value=parsed.data;
    const hash=await fingerprint({actorId:context.actorId,account:value});
    let replayed=false;
    await database().transaction(async query=>{
      const existing=await query('SELECT actor_id,request_hash FROM chart_accounts WHERE id=$1 FOR UPDATE',[value.id]);
      if(existing.rows.length){
        if(existing.rows[0].actor_id!==context!.actorId||existing.rows[0].request_hash!==hash)
          throw new ApiError(409,'ACCOUNT_CONFLICT','A conta já existe com outro conteúdo.');
        replayed=true;
        return;
      }
      const code=await query('SELECT id FROM chart_accounts WHERE code=$1 LIMIT 1',[value.code]);
      if(code.rows.length)throw new ApiError(409,'CODE_CONFLICT','Código de conta já cadastrado.');
      await query(
        'INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,$3,$4,1,$5,$6,$7)',
        [value.id,value.code,value.name,value.type,new Date().toISOString(),context!.actorId,hash],
      );
    }).catch(pgConflict);
    return respond({ok:true,item:{...value,active:1},replayed},context,replayed?200:201);
  } catch(error){return failure(error,context);}
}
