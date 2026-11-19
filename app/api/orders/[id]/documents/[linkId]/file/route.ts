import { createHash } from 'node:crypto';
import { z } from 'zod';
import { database, databasePool } from '../../../../../../../db/raw';
import {
  ApiError, failure, requestContext, type RequestContext,
} from '../../../../../../../lib/api/http';
import {
  createPostgresNextcrmLinkDependencies,
} from '../../../../../../../lib/integrations/nextcrm/postgres-mapped-dependencies';
import {
  requestNextcrmFileTicket,
} from '../../../../../../../lib/integrations/nextcrm/nextcrm-private-file-ticket';
import {
  NextcrmBridgeUnavailable,
} from '../../../../../../../lib/integrations/nextcrm/nextcrm-http-document-verifier';

export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();
const FILE_MAX_BYTES = 8 * 1024 * 1024;
type Params = { params: Promise<{ id: string; linkId: string }> };

type Link = {
  nextcrm_document_id: string;
  nextcrm_account_id: string;
  document_version: number;
  sha256: string | null;
};

/**
 * Browser receives bytes only, never an S3 key, presigned URL or CRM cookie.
 * The private bridge checks current NextCRM ACL for EVERY download request.
 * Staging-only until OIDC/SSO and production MinIO allowlist are approved.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id, linkId } = await params;
    if (!uuid.safeParse(id).success || !uuid.safeParse(linkId).success)
      throw new ApiError(400, 'VALIDATION_FAILED', 'Documento inválido.');
    if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging')
      throw new ApiError(503, 'DOWNLOAD_NOT_CONFIGURED', 'Download externo indisponível.');

    const config = {
      baseUrl: 'http://nextcrm-web.railway.internal:3000',
      secret: process.env.CISNE_NEXTCRM_BRIDGE_SECRET ?? '',
      instanceKey: getNextcrmInstanceKey(),
      minioPublicOrigin: process.env.CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN ?? '',
      minioBucket: process.env.CISNE_NEXTCRM_MINIO_BUCKET ?? '',
      timeoutMs: 3000,
    };
    const deps = createPostgresNextcrmLinkDependencies(databasePool(), context.actorId, config);
    const owned = await deps.findOwnedOrder(id, context.actorId);
    if (!owned?.clientId)
      throw new ApiError(404, 'NOT_FOUND', 'Documento não autorizado.');
    const identity = await deps.resolveMappedIdentity(context.actorId);
    if (!identity || identity.tenantKey !== config.instanceKey)
      throw new ApiError(404, 'NOT_FOUND', 'Documento não autorizado.');
    const account = await deps.findAccountMapping(owned.clientId, identity.tenantKey);
    if (!account)
      throw new ApiError(404, 'NOT_FOUND', 'Documento não autorizado.');

    const link = await database().prepare(
      `SELECT nextcrm_document_id,nextcrm_account_id,document_version,sha256
       FROM nextcrm_order_document_links
       WHERE id=? AND service_order_id=? AND owner_id=? AND erp_client_id=?
         AND tenant_key=? AND nextcrm_account_id=?
       LIMIT 1`,
    ).bind(linkId, id, context.actorId, owned.clientId, identity.tenantKey, account.accountId)
      .first<Link>();
    if (!link?.sha256)
      throw new ApiError(404, 'NOT_FOUND', 'Documento não disponível para download.');

    const approved = await deps.verifyDocumentForLink(
      link.nextcrm_document_id, identity.nextcrmSubjectId, account.accountId,
      owned.clientId, identity.tenantKey,
    );
    if (!approved?.canLink || approved.id !== link.nextcrm_document_id ||
        approved.accountId !== link.nextcrm_account_id ||
        approved.version !== link.document_version || approved.sha256 !== link.sha256)
      throw new ApiError(404, 'NOT_FOUND', 'Documento não autorizado.');

    const ticket = await requestNextcrmFileTicket(config, {
      documentId: link.nextcrm_document_id,
      subjectId: identity.nextcrmSubjectId,
      accountId: account.accountId,
      erpClientId: owned.clientId,
      tenantKey: identity.tenantKey,
      expectedVersion: link.document_version,
      expectedSha256: link.sha256,
    });
    if (!ticket)
      throw new ApiError(404, 'NOT_FOUND', 'Documento não autorizado.');

    // URL was authenticated by HMAC and checked against the exact MinIO
    // origin/bucket by requestNextcrmFileTicket. Never follow redirects.
    let source: Response;
    try {
      source = await fetch(ticket, {
        method: 'GET', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
    } catch { throw new NextcrmBridgeUnavailable(); }
    if (source.status !== 200 || !source.body)
      throw new NextcrmBridgeUnavailable();
    const length = source.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > FILE_MAX_BYTES))
      throw new ApiError(413, 'FILE_TOO_LARGE', 'Arquivo excede o limite de homologação.');
    const reader = source.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        total += item.value.byteLength;
        if (total > FILE_MAX_BYTES)
          throw new ApiError(413, 'FILE_TOO_LARGE', 'Arquivo excede o limite de homologação.');
        chunks.push(Buffer.from(item.value));
      }
    } finally {
      reader.releaseLock();
    }
    const contents = Buffer.concat(chunks);
    if (createHash('sha256').update(contents).digest('hex') !== link.sha256)
      throw new NextcrmBridgeUnavailable();

    return new Response(new Uint8Array(contents), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="nextcrm-${link.nextcrm_document_id.slice(0, 8)}.bin"`,
        'Content-Length': String(contents.length),
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const safe = error instanceof NextcrmBridgeUnavailable
      ? new ApiError(503, 'NEXTCRM_UNAVAILABLE', 'Arquivo indisponível. Tente novamente.')
      : error;
    return failure(safe, context);
  }
}
