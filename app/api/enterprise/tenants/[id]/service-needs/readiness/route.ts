import {z} from 'zod';
import {database} from '../../../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../../../lib/api/http';
import {serviceGoReadiness} from '../../../../../../../lib/application/service-go-readiness';

export const dynamic='force-dynamic';
export async function GET(request:Request,route:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const {id}=await route.params;
  if(!z.string().uuid().safeParse(id).success)
   throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
  const status=await database().transaction(q=>serviceGoReadiness(q,id,ctx!.actorId,process.env.CISNE_STAGING_AUTH_MODE??'shared'));
  return respond(status,ctx);
 }catch(error){return failure(error,ctx);}
}
