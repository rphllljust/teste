import {z} from 'zod';
import {database} from '../../../../../../../../db/raw';
import {ApiError,failure,jsonBody,requestContext,respond,type RequestContext} from '../../../../../../../../lib/api/http';
import {needCommand,runNeedCommand} from '../../../../../../../../lib/application/service-needs';

export const dynamic='force-dynamic';
export async function POST(request:Request,route:{params:Promise<{id:string;needId:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);const {id,needId}=await route.params;
  if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(needId).success)throw new ApiError(400,'VALIDATION_FAILED','Identificador inválido.');
  const p=needCommand.safeParse(await jsonBody(request));
  if(!p.success)throw new ApiError(400,'VALIDATION_FAILED','Comando inválido.');
  const r=await database().transaction(q=>runNeedCommand(q,{tenantId:id,actorId:ctx!.actorId,correlationId:ctx!.correlationId},needId,p.data));
  return respond(r,ctx);
 }catch(e){return failure(e,ctx);}
}
