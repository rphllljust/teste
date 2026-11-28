import {z} from 'zod';
import {database} from '../../../../../../../../../db/raw';
import {ApiError,failure,requestContext,type RequestContext} from '../../../../../../../../../lib/api/http';
import {readServiceEvidence} from '../../../../../../../../../lib/application/service-evidence';

export const dynamic='force-dynamic';
export async function GET(request:Request,route:{params:Promise<{id:string;needId:string;fileId:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const {id,needId,fileId}=await route.params;
  const uuid=z.string().uuid();
  if(!uuid.safeParse(id).success||!uuid.safeParse(needId).success||!uuid.safeParse(fileId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Identificador inválido.');
  const result=await database().transaction(q=>readServiceEvidence(q,{tenantId:id,needId,actorId:ctx!.actorId},fileId));
  const extension=result.mimeType==='application/pdf'?'pdf':result.mimeType==='image/png'?'png':result.mimeType==='image/webp'?'webp':'jpg';
  return new Response(new Uint8Array(result.contents),{
   status:200,
   headers:{
    'Content-Type':'application/octet-stream',
    'Content-Length':String(result.contents.length),
    'Content-Disposition':'attachment; filename="cisne-evidence-'+fileId.slice(0,8)+'.'+extension+'"',
    'Cache-Control':'private, no-store',
    'Content-Security-Policy':'sandbox',
    'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff',
   },
  });
 }catch(error){return failure(error,ctx);}
}
