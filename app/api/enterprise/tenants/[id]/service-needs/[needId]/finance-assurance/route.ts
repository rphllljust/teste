import {z} from 'zod';
import {database} from '../../../../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../../../../lib/api/http';
import {getServiceFinancialAssurance} from '../../../../../../../../lib/application/service-finance-assurance';
export const dynamic='force-dynamic';
/** No writes or bank/fiscal activity. All identities are checked by service dossier. */
export async function GET(request:Request,route:{params:Promise<{id:string;needId:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const {id,needId}=await route.params;
  if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(needId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Empresa ou processo inválido.');
  const result=await database().transaction(q=>getServiceFinancialAssurance(q,{
    tenantId:id,needId,actorId:ctx!.actorId,correlationId:ctx!.correlationId,
  }));
  return respond(result,ctx);
 }catch(e){return failure(e,ctx);}
}
