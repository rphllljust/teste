import {z} from 'zod';
import {database} from '../../../../../../../../db/raw';
import {ApiError,failure,jsonBody,requestContext,respond,type RequestContext} from '../../../../../../../../lib/api/http';
import {
 prepareServiceMeasurementInput,approveServiceMeasurementInput,
 prepareServiceMeasurement,approveServiceMeasurement,getServiceMeasurementDossier
} from '../../../../../../../../lib/application/service-measurements';

export const dynamic='force-dynamic';
const bodySchema=z.discriminatedUnion('action',[
 prepareServiceMeasurementInput.extend({action:z.literal('prepare')}),
 approveServiceMeasurementInput.extend({action:z.literal('approve'),measurementId:z.string().uuid()}),
]);
type Route={params:Promise<{id:string;needId:string}>};
async function tenantNeed(route:Route){
 const {id,needId}=await route.params;
 if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(needId).success)
  throw new ApiError(400,'VALIDATION_FAILED','Identificador empresarial ou operacional inválido.');
 return {id,needId};
}
export async function GET(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);const {id,needId}=await tenantNeed(route);
  const result=await database().transaction(q=>getServiceMeasurementDossier(q,{
   tenantId:id,needId,actorId:ctx!.actorId,correlationId:ctx!.correlationId,
  }));
  return respond(result,ctx);
 }catch(e){return failure(e,ctx);}
}
export async function POST(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);const {id,needId}=await tenantNeed(route);
  const input=bodySchema.safeParse(await jsonBody(request));
  if(!input.success)throw new ApiError(400,'VALIDATION_FAILED','Comando de medição inválido.');
  const result=await database().transaction<{ok:boolean;replayed?:boolean;measurementId:string;status:string;amountCents?:number;authorizedCeilingCents?:string;version?:number}>(async q=>{
   const c={tenantId:id,needId,actorId:ctx!.actorId,correlationId:ctx!.correlationId};
   if(input.data.action==='prepare'){
    const {action:_action,...p}=input.data;void _action;
    return prepareServiceMeasurement(q,c,p);
   }
   const {action:_action,measurementId,...p}=input.data;void _action;
   return approveServiceMeasurement(q,c,measurementId,p);
  });
  return respond(result,ctx,('replayed' in result&&result.replayed)?200:201);
 }catch(e){return failure(e,ctx);}
}
