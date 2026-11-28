import {z} from 'zod';
import {database} from '../../../../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../../../../lib/api/http';
import {getServiceLogistics} from '../../../../../../../../lib/application/service-logistics';
export const dynamic='force-dynamic';
export async function GET(request:Request,route:{params:Promise<{id:string;needId:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);const {id,needId}=await route.params;
  if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(needId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Empresa ou necessidade inválida.');
  const result=await database().transaction(q=>getServiceLogistics(q,{
   tenantId:id,needId,actorId:ctx!.actorId,
  }));
  return respond(result,ctx);
 }catch(e){return failure(e,ctx);}
}
