import { z } from 'zod';
import { databasePool } from '../../../../../../db/raw';
import { ApiError, failure, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../lib/api/http';
import { createPostgresNextcrmLinkDependencies } from '../../../../../../lib/integrations/nextcrm/postgres-mapped-dependencies';
import { authorizeAndPersistOrderDocumentLink, OrderDocumentLinkConflict } from '../../../../../../lib/integrations/nextcrm/postgres-document-link';
import { OrderDocumentLinkDenied } from '../../../../../../lib/integrations/nextcrm/document-link-preflight';
import { NextcrmBridgeUnavailable, type NextcrmBridgeConfig } from '../../../../../../lib/integrations/nextcrm/nextcrm-http-document-verifier';
import { completeNextcrmUpload, requestNextcrmUploadTicket } from '../../../../../../lib/integrations/nextcrm/nextcrm-upload-ticket';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
const uuid=z.string().uuid();
const kind=z.enum(['attachment','contract','photo','service_report','inspection','invoice']);
const base=z.object({key:uuid,name:z.string().trim().min(1).max(160),contentType:z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),size:z.number().int().positive().max(8*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const intent=z.discriminatedUnion('action',[
 base.extend({action:z.literal('prepare')}),
 base.extend({action:z.literal('complete'),documentId:uuid,documentKind:kind,version:z.literal(1)}),
]);
function bridgeConfig():NextcrmBridgeConfig{return {baseUrl:'http://nextcrm-web.railway.internal:3000',secret:process.env.CISNE_NEXTCRM_BRIDGE_SECRET??'',instanceKey:process.env.CISNE_NEXTCRM_INSTANCE_KEY??'',minioPublicOrigin:process.env.CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN||'https://nextcrm-minio-staging.up.railway.app',timeoutMs:3000};}
function safe(error:unknown,context?:RequestContext){
 if(error instanceof OrderDocumentLinkDenied)return failure(new ApiError(404,'NOT_FOUND','Vínculo documental não autorizado.'),context);
 if(error instanceof OrderDocumentLinkConflict)return failure(new ApiError(409,'IDEMPOTENCY_CONFLICT','Vínculo documental já registrado.'),context);
 if(error instanceof NextcrmBridgeUnavailable)return failure(new ApiError(503,'NEXTCRM_UNAVAILABLE','O serviço documental do NextCRM está indisponível.'),context);
 return failure(error,context);
}
export async function POST(request:Request,{params}:RouteContext){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);const {id}=await params;
  if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Identificador da OS inválido.');
  const parsed=intent.safeParse(await jsonBody(request));if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Dados de upload inválidos.');
  const input=parsed.data;const db=databasePool();const config=bridgeConfig();const deps=createPostgresNextcrmLinkDependencies(db,context.actorId,config);
  const owned=await deps.findOwnedOrder(id,context.actorId);if(!owned?.clientId)throw new ApiError(404,'NOT_FOUND','Ordem de serviço não encontrada.');
  const identity=await deps.resolveMappedIdentity(context.actorId);if(!identity)throw new ApiError(409,'CRM_IDENTITY_REQUIRED','Identidade NextCRM não vinculada ao operador.');
  const account=await deps.findAccountMapping(owned.clientId,identity.tenantKey);if(!account)throw new ApiError(409,'CRM_ACCOUNT_REQUIRED','Cliente sem conta NextCRM vinculada.');
  if(input.action==='prepare'){
   const ticket=await requestNextcrmUploadTicket(config,{subjectId:identity.nextcrmSubjectId,accountId:account.accountId,erpClientId:owned.clientId,tenantKey:identity.tenantKey,name:input.name,contentType:input.contentType,size:input.size,sha256:input.sha256,requestId:input.key});
   return respond({upload:{documentId:ticket.documentId,uploadUrl:ticket.uploadUrl,expiresIn:ticket.expiresIn,version:ticket.version,sha256:ticket.sha256},refreshPolicy:['serviceOrders.documents']},context,201);
  }
  const verified=await completeNextcrmUpload(config,{documentId:input.documentId,subjectId:identity.nextcrmSubjectId,accountId:account.accountId,erpClientId:owned.clientId,tenantKey:identity.tenantKey,name:input.name,contentType:input.contentType,size:input.size,sha256:input.sha256});
  const linked=await authorizeAndPersistOrderDocumentLink({payload:{serviceOrderId:id,nextcrmDocumentId:verified.documentId,documentKind:input.documentKind,version:verified.version,sha256:verified.sha256},trustedErpActorId:context.actorId,idempotencyKey:input.key,correlationId:context.correlationId,db,dependencies:deps});
  return respond({resource:{type:'orderDocumentLink',id:linked.id},created:linked.created,documentId:verified.documentId,refreshPolicy:['serviceOrders.documents']},context,linked.created?201:200);
 }catch(error){return safe(error,context);}
}
