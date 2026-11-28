import {z} from 'zod';
import {database} from '../../../../../../db/raw';
import {ApiError,failure,jsonBody,requestContext,respond,type RequestContext} from '../../../../../../lib/api/http';
import {linkEmployee,linkEmployeeProfessional} from '../../../../../../lib/application/service-needs';

export const dynamic='force-dynamic';
export async function POST(request:Request,route:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);const {id}=await route.params;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
  const p=linkEmployee.safeParse(await jsonBody(request));
  if(!p.success)throw new ApiError(400,'VALIDATION_FAILED','Dados do vínculo inválidos.');
  const r=await database().transaction(q=>linkEmployeeProfessional(q,{tenantId:id,actorId:ctx!.actorId,correlationId:ctx!.correlationId},p.data));
  return respond(r,ctx,201);
 }catch(e){return failure(e,ctx);}
}
