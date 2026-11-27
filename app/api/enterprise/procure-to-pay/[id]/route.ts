import {z} from 'zod';
import {requestContext,respond,failure,ApiError,type RequestContext} from '../../../../../lib/api/http';
import {getProcureToPayDossier} from '../../../../../lib/application/procure-to-pay-dossier';
export const dynamic='force-dynamic';
/** Full source-to-ledger dossier of a verified owned procurement order. Strictly read-only. */
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const id=(await params).id;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Pedido inválido.');
  return respond(await getProcureToPayDossier(context.actorId,id),context);
 }catch(error){return failure(error,context);}
}
