import {z} from 'zod';
import {database} from '../../../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../../../lib/api/http';
import {getServiceControlTower} from '../../../../../../../lib/application/service-control-tower';

export const dynamic='force-dynamic';
export async function GET(request:Request,route:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const {id}=await route.params;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
  const result=await database().transaction(q=>getServiceControlTower(q,{tenantId:id,actorId:ctx!.actorId}));
  return respond(result,ctx);
 }catch(error){return failure(error,ctx);}
}
