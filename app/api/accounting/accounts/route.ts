import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { database } from '../../../../db/raw';

export const dynamic='force-dynamic';
export async function GET(request:Request){let context:RequestContext|undefined;try{context=requestContext(request);const result=await database().prepare(`SELECT id,code,name,type,active FROM chart_accounts WHERE actor_id=? ORDER BY code,id`).bind(context.actorId).all();return respond({items:result.results},context);}catch(error){return failure(error,context);}}
export async function POST(request:Request){let context:RequestContext|undefined;try{context=requestContext(request,true);throw new ApiError(501,'ACCOUNTING_COMMAND_UNAVAILABLE','Cadastro de contas contábeis ainda não está habilitado neste ambiente.');}catch(error){return failure(error,context);}}
