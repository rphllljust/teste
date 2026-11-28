import {z} from 'zod';
import {database} from '../../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../../lib/api/http';
import {employeeInbox} from '../../../../../../lib/application/service-needs';

export const dynamic='force-dynamic';
export async function GET(request:Request,route:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);const {id}=await route.params;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
  const items=await database().transaction(q=>employeeInbox(q,{tenantId:id,actorId:ctx!.actorId,correlationId:ctx!.correlationId}));
  return respond({items},ctx);
 }catch(e){return failure(e,ctx);}
}
