import { z } from 'zod';
import { database, databasePool } from '../../../../../db/raw';
import {
  ApiError, failure, jsonBody, requestContext, respond, type RequestContext,
} from '../../../../../lib/api/http';
import {
  authorizeAndPersistOrderDocumentLink, OrderDocumentLinkConflict,
} from '../../../../../lib/integrations/nextcrm/postgres-document-link';
import {
  OrderDocumentLinkDenied,
} from '../../../../../lib/integrations/nextcrm/document-link-preflight';
import {
  createPostgresNextcrmLinkDependencies,
} from '../../../../../lib/integrations/nextcrm/postgres-mapped-dependencies';
import {
  NextcrmBridgeUnavailable,
} from '../../../../../lib/integrations/nextcrm/nextcrm-http-document-verifier';
import type { NextcrmBridgeConfig } from '../../../../../lib/integrations/nextcrm/nextcrm-http-document-verifier';
import { publicNextcrmLinkedDocument } from '../../../../../lib/integrations/nextcrm/public-document-projection';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const uuid = z.string().uuid();
const intent = z.object({
  key: uuid,
  nextcrmDocumentId: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
  documentKind: z.enum(['attachment','contract','photo','service_report','inspection','invoice']),
  version: z.number().int().min(1).max(1_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

function bridgeConfig(): NextcrmBridgeConfig {
  // Source URL cannot be supplied by the browser or Railway variables:
  // the HMAC secret must NEVER reach the NextCRM public Caddy gateway.
  return {
    baseUrl: 'http://nextcrm-web.railway.internal:3000',
    secret: process.env.CISNE_NEXTCRM_BRIDGE_SECRET ?? '',
    instanceKey: getNextcrmInstanceKey(),
    timeoutMs: 3000,
  };
}
function safeFailure(error: unknown, context?: RequestContext): Response {
  if(error instanceof OrderDocumentLinkDenied)
    return failure(new ApiError(404,'NOT_FOUND','Vínculo documental não autorizado.'),context);
  if(error instanceof OrderDocumentLinkConflict)
    return failure(new ApiError(409,'IDEMPOTENCY_CONFLICT','Vínculo já registrado de outra forma.'),context);
  if(error instanceof NextcrmBridgeUnavailable)
    return failure(new ApiError(503,'NEXTCRM_UNAVAILABLE','A autorização documental do NextCRM está indisponível.'),context);
  return failure(error,context);
}

/**
 * ERP -> NextCRM document link metadata only.
 * No browser-supplied actor/tenant/client/account identity, download URLs,
 * credentials, cookies or document content may cross this boundary.
 */
export async function POST(request: Request, {params}: RouteContext) {
  let context:RequestContext|undefined;
  try {
    context=requestContext(request,true);
    const {id}=await params;
    if(!uuid.safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador da OS inválido.');
    const parsed=intent.safeParse(await jsonBody(request));
    if(!parsed.success)
      throw new ApiError(400,'VALIDATION_FAILED','Dados documentais inválidos.');
    const {key,...document}=parsed.data;
    const config=bridgeConfig();
    const dependencies=createPostgresNextcrmLinkDependencies(
      databasePool(),context.actorId,config);
    const linked=await authorizeAndPersistOrderDocumentLink({
      payload:{serviceOrderId:id,...document},
      trustedErpActorId:context.actorId,
      idempotencyKey:key,
      correlationId:context.correlationId,
      db:databasePool(),
      dependencies,
    });
    return respond({
      resource:{type:'orderDocumentLink',id:linked.id},
      created:linked.created,
      refreshPolicy:['serviceOrders.detail','serviceOrders.documents'],
    },context,linked.created?201:200);
  }catch(error){return safeFailure(error,context);}
}

/**
 * Existing document links are reauthorized against the current NextCRM
 * account/document ACL before any document metadata is returned. Revoked
 * documents are omitted; transport failure rejects the entire read.
 */
export async function GET(request: Request, {params}: RouteContext) {
  let context:RequestContext|undefined;
  try {
    context=requestContext(request);
    const {id}=await params;
    if(!uuid.safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador da OS inválido.');
    const config=bridgeConfig();
    const dependencies=createPostgresNextcrmLinkDependencies(
      databasePool(),context.actorId,config);
    const owned=await dependencies.findOwnedOrder(id,context.actorId);
    if(!owned||!owned.clientId)
      throw new ApiError(404,'NOT_FOUND','Ordem de serviço não encontrada.');
    const identity=await dependencies.resolveMappedIdentity(context.actorId);
    if(!identity)
      return respond({enabled:false,items:[],reason:'IDENTITY_MAPPING_REQUIRED'},context);
    const account=await dependencies.findAccountMapping(owned.clientId,identity.tenantKey);
    if(!account)
      return respond({enabled:false,items:[],reason:'ACCOUNT_MAPPING_REQUIRED'},context);

    const links=await database().prepare(`SELECT id,nextcrm_document_id,document_kind,
      document_version,sha256,created_at FROM nextcrm_order_document_links
      WHERE service_order_id=? AND owner_id=? AND erp_client_id=? AND tenant_key=?
      AND nextcrm_account_id=? ORDER BY created_at DESC,id DESC LIMIT 50`)
      .bind(id,context.actorId,owned.clientId,identity.tenantKey,account.accountId)
      .all<{id:string;nextcrm_document_id:string;document_kind:string;
        document_version:number;sha256:string|null;created_at:string}>();
    const items=[];
    for(const link of links.results) {
      const approved=await dependencies.verifyDocumentForLink(
        link.nextcrm_document_id,identity.nextcrmSubjectId,account.accountId,
        owned.clientId,identity.tenantKey);
      if(!approved||!approved.canLink||
        approved.id!==link.nextcrm_document_id||
        approved.accountId!==account.accountId||
        approved.version!==link.document_version||
        (link.sha256!==null&&approved.sha256!==link.sha256))continue;
      items.push(publicNextcrmLinkedDocument(link,approved.sha256));
    }
    return respond({enabled:true,items,limit:50},context);
  }catch(error){return safeFailure(error,context);}
}
