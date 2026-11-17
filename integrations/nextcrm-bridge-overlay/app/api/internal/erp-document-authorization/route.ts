import { NextRequest } from "next/server";
import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import {
  accountReadScopeWhere,
  documentReadScopeWhere,
  mapLegacyRole,
} from "@/lib/authz";
import {
  NEXTCRM_BRIDGE_MAX_BODY_BYTES,
  NEXTCRM_BRIDGE_PATH,
  signBridgeResponse,
  verifyBridgeRequest,
} from "@/lib/erp-bridge/bridge-protocol";

// This route is part of an opt-in overlay for the pinned NextCRM source.
// It is NOT present in the upstream release image until a reviewed custom
// build installs the overlay. There is no browser or cookie-based fallback.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const bodySchema = z.object({
  documentId: uuid,
  subjectId: uuid,
  accountId: uuid,
  erpClientId: uuid,
  tenantKey: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
  requestId: uuid,
  // Explicit privileged operation, never inferred from the caller's URL.
  purpose: z.literal('file').optional(),
}).strict();

async function smallBody(req: NextRequest): Promise<string | null> {
  const cl = req.headers.get("content-length");
  if (cl && (!/^\d{1,5}$/.test(cl) || Number(cl) > NEXTCRM_BRIDGE_MAX_BODY_BYTES)) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      n += item.value.byteLength;
      if (n > NEXTCRM_BRIDGE_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(item.value);
    }
    const all = new Uint8Array(n);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.CISNE_NEXTCRM_BRIDGE_SECRET ?? "";
  const instanceKey = process.env.CISNE_NEXTCRM_INSTANCE_KEY ?? "";
  if (!/^[a-f0-9]{64,128}$/.test(secret) || !/^[A-Za-z0-9_-]{3,128}$/.test(instanceKey)) {
    return Response.json({ error: "Unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (req.nextUrl.pathname !== NEXTCRM_BRIDGE_PATH ||
      req.nextUrl.search || req.method !== "POST" ||
      req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const raw = await smallBody(req);
  if (!raw) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const proof = {
    timestamp: req.headers.get("x-cisne-bridge-timestamp") ?? "",
    nonce: req.headers.get("x-cisne-bridge-nonce") ?? "",
    signature: req.headers.get("x-cisne-bridge-signature") ?? "",
  };
  if (!verifyBridgeRequest(secret, raw, proof)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const reply = (status: number, value: Record<string, unknown>) => {
    const body = JSON.stringify(value);
    return new Response(body, {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "X-Cisne-Bridge-Response-Signature": signBridgeResponse(secret, body, status, proof),
      },
    });
  };
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return reply(404, { authorized: false }); }
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success || parsed.data.tenantKey !== instanceKey) {
    return reply(404, { authorized: false });
  }
  const { subjectId, accountId, erpClientId, documentId } = parsed.data;

  try {
    const user = await prismadb.users.findUnique({
      where: { id: subjectId },
      select: { id: true, role: true, userStatus: true, banned: true },
    });
    // Unlike a trusted service caller, a CRM subject must independently
    // exist, be active and not be suspended.
    if (!user || user.userStatus !== "ACTIVE" || user.banned) {
      return reply(404, { authorized: false });
    }
    const actor = { id: user.id, role: mapLegacyRole(user.role) };
    const account = await prismadb.crm_Accounts.findFirst({
      where: {
        id: accountId,
        external_ref: erpClientId,
        ...accountReadScopeWhere(actor),
      },
      select: { id: true },
    });
    if (!account) return reply(404, { authorized: false });

    // Check the real NextCRM document scope AND its exact linked account.
    // A broadly visible document in an unrelated account must not be linked.
    const document = await prismadb.documents.findFirst({
      where: {
        id: documentId,
        accounts: { some: { account_id: accountId } },
        ...documentReadScopeWhere(actor),
      },
      select: {
        id: true, version: true, content_hash: true,
        key: true, document_file_url: true,
      },
    });
    if (!document || !Number.isInteger(document.version) || document.version < 1) {
      return reply(404, { authorized: false });
    }
    const hash = document.content_hash;
    const sha256 = typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash) ? hash : null;
    const grant = {
      authorized: true, id: document.id, tenantKey: instanceKey,
      accountId, version: document.version, sha256,
    };
    if (parsed.data.purpose !== 'file') return reply(200, grant);

    // Requesting bytes has stricter requirements than document metadata:
    // a verified content digest and an actual private documents/ object.
    // Import MinIO lazily so metadata authorization does not require any
    // S3 configuration or leak a storage URL to ordinary callers.
    if (!sha256) return reply(404, { authorized: false });
    const [storage, keys] = await Promise.all([
      import('@/lib/minio'),
      import('@/lib/documents/file-key'),
    ]);
    const publicEndpoint = new URL(storage.MINIO_PUBLIC_URL);
    if (publicEndpoint.origin !== 'https://nextcrm-minio-staging.up.railway.app' ||
        publicEndpoint.pathname !== '/' || publicEndpoint.search ||
        publicEndpoint.hash || publicEndpoint.username ||
        publicEndpoint.password || storage.MINIO_BUCKET !== 'nextcrm') {
      return reply(503, { error: 'Unavailable' });
    }
    const key = document.key ||
      keys.keyFromUrl(document.document_file_url, storage.MINIO_BUCKET,
        [storage.MINIO_PUBLIC_URL, storage.MINIO_ENDPOINT]);
    if (typeof key !== 'string' || !key.startsWith('documents/') ||
        !keys.isDocumentKey(key) || key.split('/').some(part => !part)) {
      return reply(404, { authorized: false });
    }
    // AWS SigV4 covers the exact public HTTPS host; URLs are disclosed only
    // through a signed service-to-service response, NEVER to ERP browsers.
    const signed = new URL(await storage.presignGet(key, 60));
    if (signed.origin !== publicEndpoint.origin ||
        !signed.pathname.startsWith('/nextcrm/documents/') ||
        signed.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
        signed.searchParams.get('X-Amz-Expires') !== '60' ||
        !/^[a-f0-9]{64}$/i.test(signed.searchParams.get('X-Amz-Signature') || '') ||
        signed.hash || signed.username || signed.password) {
      return reply(503, { error: 'Unavailable' });
    }
    return reply(200, { ...grant, expiresIn: 60, fileUrl: signed.toString() });
  } catch {
    // Never return a signed success on Prisma failure. The ERP fails closed
    // on 503 and must never treat this as authorization.
    return reply(503, { error: "Unavailable" });
  }
}
