import {z} from 'zod';
import {database} from '../../../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../../../lib/api/http';
import {needDetail} from '../../../../../../../lib/application/service-needs';

export const dynamic='force-dynamic';
export async function GET(request:Request,route:{params:Promise<{id:string;needId:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);const {id,needId}=await route.params;
  if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(needId).success)throw new ApiError(400,'VALIDATION_FAILED','Identificador inválido.');
  const d=await database().transaction(q=>needDetail(q,{tenantId:id,actorId:ctx!.actorId,correlationId:ctx!.correlationId},needId));
  return respond(d,ctx);
 }catch(e){return failure(e,ctx);}
}
