import {z} from 'zod';
import {database} from '../../../../../../db/raw';
import {ApiError,failure,jsonBody,requestContext,respond,type RequestContext} from '../../../../../../lib/api/http';
import {createNeed,createServiceNeed,listNeeds} from '../../../../../../lib/application/service-needs';

export const dynamic='force-dynamic';
type Route={params:Promise<{id:string}>};
async function tenant(route:Route){const id=(await route.params).id;if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');return id;}

export async function GET(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);const tenantId=await tenant(route);
  const items=await database().transaction(q=>listNeeds(q,{tenantId,actorId:ctx!.actorId,correlationId:ctx!.correlationId}));
  return respond({items,source:'service_need_queue'},ctx);
 }catch(e){return failure(e,ctx);}
}
export async function POST(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);const tenantId=await tenant(route);
  const p=createNeed.safeParse(await jsonBody(request));
  if(!p.success)throw new ApiError(400,'VALIDATION_FAILED','Dados da necessidade inválidos.');
  const r=await database().transaction(q=>createServiceNeed(q,{tenantId,actorId:ctx!.actorId,correlationId:ctx!.correlationId},p.data));
  return respond(r,ctx,201);
 }catch(e){return failure(e,ctx);}
}
