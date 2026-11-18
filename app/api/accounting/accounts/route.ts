import { databasePool } from '../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
export async function GET(request:Request):Promise<Response>{let context:RequestContext|undefined;try{context=requestContext(request);const r=await databasePool().query('SELECT id,code,name,type,active FROM chart_accounts WHERE actor_id=$1 ORDER BY code,id',[context.actorId]);return respond({items:r.rows},context);}catch(error){return failure(error,context);}}
