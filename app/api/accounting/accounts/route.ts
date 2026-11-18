import { z } from 'zod';
import { databasePool } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

const input=z.object({id:z.string().uuid(),code:z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9._-]+$/),name:z.string().trim().min(3).max(160),type:z.enum(['asset','liability','equity','revenue','expense'])}).strict();

export async function GET(request:Request):Promise<Response>{let context:RequestContext|undefined;try{context=requestContext(request);const r=await databasePool().query('SELECT id,code,name,type,active FROM chart_accounts WHERE actor_id=$1 ORDER BY code,id',[context.actorId]);return respond({items:r.rows},context);}catch(error){return failure(error,context);}}

export async function POST(request:Request):Promise<Response>{let context:RequestContext|undefined;try{context=requestContext(request,true);const parsed=input.safeParse(await jsonBody(request));if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Dados da conta contábil inválidos.');const p=parsed.data;const hash=await fingerprint({actor:context.actorId,scope:'chartAccount',command:'create',payload:p});const db=databasePool();const existing=await db.query('SELECT id,code,name,type,active FROM chart_accounts WHERE id=$1 AND actor_id=$2',[p.id,context.actorId]);if(existing.rowCount)return respond({account:existing.rows[0]},context,200);const row=await db.query('INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,$3,$4,1,$5,$6,$7) RETURNING id,code,name,type,active',[p.id,p.code,p.name,p.type,new Date().toISOString(),context.actorId,hash]);return respond({account:row.rows[0]},context,201);}catch(error){return failure(error,context);}}
