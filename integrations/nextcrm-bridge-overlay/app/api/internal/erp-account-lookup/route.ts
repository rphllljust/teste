import { NextRequest } from "next/server";
import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import { accountReadScopeWhere, mapLegacyRole } from "@/lib/authz";
import {
  NEXTCRM_ACCOUNT_LOOKUP_PATH,
  NEXTCRM_BRIDGE_MAX_BODY_BYTES,
  signBridgeResponseForPath,
  verifyBridgeRequestForPath,
} from "@/lib/erp-bridge/bridge-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const bodySchema = z.object({
  subjectId: uuid,
  erpClientId: uuid,
  tenantKey: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
  requestId: uuid,
}).strict();

async function smallBody(req: NextRequest): Promise<string | null> {
  const cl = req.headers.get("content-length");
  if (cl && (!/^\d{1,5}$/.test(cl) || Number(cl) > NEXTCRM_BRIDGE_MAX_BODY_BYTES)) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > NEXTCRM_BRIDGE_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(item.value);
    }
    const all = new Uint8Array(size);
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
  if (!/^[a-f0-9]{64,128}$/.test(secret) ||
      !/^[A-Za-z0-9_-]{3,128}$/.test(instanceKey)) {
    return Response.json({ error: "Unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (req.nextUrl.pathname !== NEXTCRM_ACCOUNT_LOOKUP_PATH ||
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
  if (!verifyBridgeRequestForPath(secret, raw, proof, NEXTCRM_ACCOUNT_LOOKUP_PATH)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const reply = (status: number, value: Record<string, unknown>) => {
    const body = JSON.stringify(value);
    return new Response(body, {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "X-Cisne-Bridge-Response-Signature":
          signBridgeResponseForPath(secret, body, status, proof, NEXTCRM_ACCOUNT_LOOKUP_PATH),
      },
    });
  };

  let input: unknown;
  try { input = JSON.parse(raw); } catch { return reply(404, { authorized: false }); }
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success || parsed.data.tenantKey !== instanceKey) {
    return reply(404, { authorized: false });
  }

  try {
    const { subjectId, erpClientId } = parsed.data;
    const user = await prismadb.users.findUnique({
      where: { id: subjectId },
      select: { id: true, role: true, userStatus: true, banned: true },
    });
    if (!user || user.userStatus !== "ACTIVE" || user.banned) {
      return reply(404, { authorized: false });
    }
    const actor = { id: user.id, role: mapLegacyRole(user.role) };
    const account = await prismadb.crm_Accounts.findFirst({
      where: {
        external_ref: erpClientId,
        ...accountReadScopeWhere(actor),
      },
      select: { id: true },
    });
    if (!account) return reply(404, { authorized: false });
    return reply(200, {
      authorized: true,
      accountId: account.id,
      erpClientId,
      tenantKey: instanceKey,
    });
  } catch {
    return reply(503, { error: "Unavailable" });
  }
}
