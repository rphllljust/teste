import { NextRequest } from "next/server";
import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import { accountReadScopeWhere, mapLegacyRole } from "@/lib/authz";
import { writeAuditLog } from "@/lib/audit-log";
import {
  NEXTCRM_BRIDGE_MAX_BODY_BYTES,
  signBridgeResponseForPath,
  verifyBridgeRequestForPath,
} from "@/lib/erp-bridge/bridge-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PATH = "/api/internal/erp-account-create";
const uuid = z.string().uuid();
const fields = {
  officePhone: "office_phone", website: "website", fax: "fax",
  email: "email", companyId: "company_id", vat: "vat",
  billingStreet: "billing_street", billingPostalCode: "billing_postal_code",
  billingCity: "billing_city", billingState: "billing_state",
  billingCountry: "billing_country", shippingStreet: "shipping_street",
  shippingPostalCode: "shipping_postal_code", shippingCity: "shipping_city",
  shippingState: "shipping_state", shippingCountry: "shipping_country",
  description: "description", annualRevenue: "annual_revenue", memberOf: "member_of",
} as const;
const profileSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,40}$/),
  z.string().max(500).nullable(),
).superRefine((profile, ctx) => {
  for (const key of Object.keys(profile)) {
    if (!(key in fields)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unsupported account field", path: [key] });
  }
});
const bodySchema = z.object({
  subjectId: uuid, erpClientId: uuid, requestId: uuid,
  tenantKey: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
  name: z.string().trim().min(2).max(100),
  profile: profileSchema,
}).strict();

async function smallBody(req: NextRequest): Promise<string | null> {
  const length = req.headers.get("content-length");
  if (length && (!/^\d{1,5}$/.test(length) || Number(length) > NEXTCRM_BRIDGE_MAX_BODY_BYTES)) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > NEXTCRM_BRIDGE_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export async function POST(req: NextRequest) {
  const secret = process.env.CISNE_NEXTCRM_BRIDGE_SECRET ?? "";
  const instanceKey = process.env.CISNE_NEXTCRM_INSTANCE_KEY ?? "";
  if (!/^[a-f0-9]{64,128}$/.test(secret) || !/^[A-Za-z0-9_-]{3,128}$/.test(instanceKey)) {
    return Response.json({ error: "Unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (req.nextUrl.pathname !== PATH || req.nextUrl.search ||
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
  if (!verifyBridgeRequestForPath(secret, raw, proof, PATH)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const reply = (status: number, payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    return new Response(body, { status, headers: {
      "Content-Type": "application/json", "Cache-Control": "private, no-store",
      "X-Cisne-Bridge-Response-Signature": signBridgeResponseForPath(secret, body, status, proof, PATH),
    } });
  };
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return reply(404, { authorized: false }); }
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success || parsed.data.tenantKey !== instanceKey) return reply(404, { authorized: false });

  const { subjectId, erpClientId, name, profile } = parsed.data;
  try {
    const user = await prismadb.users.findUnique({
      where: { id: subjectId }, select: { id: true, role: true, userStatus: true, banned: true },
    });
    if (!user || user.userStatus !== "ACTIVE" || user.banned) return reply(404, { authorized: false });
    const actor = { id: user.id, role: mapLegacyRole(user.role) };
    // Serialize same ERP ID across requests. Repeated requests reuse the original
    // CRM account, even if the caller had a network timeout after creation.
    const result = await prismadb.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", erpClientId);
      const existing = await tx.crm_Accounts.findFirst({
        where: { external_ref: erpClientId, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        const visible = await tx.crm_Accounts.findFirst({
          where: { id: existing.id, deletedAt: null, ...accountReadScopeWhere(actor) },
          select: { id: true },
        });
        if (!visible) return { conflict: true as const };
        return { id: visible.id, created: false as const };
      }
      // The bridge creates only accounts for the trusted ERP identity.
      // Administrative fields (owner, status, assigned user) are server-owned.
      const account = await tx.crm_Accounts.create({
        data: {
          name, external_ref: erpClientId, v: 0,
          createdBy: user.id, updatedBy: user.id, status: "Active",
          assigned_to: actor.role === "partner" ? null : user.id,
          partnerUserId: actor.role === "partner" ? user.id : undefined,
          office_phone: profile.officePhone ?? null,
          website: profile.website ?? null, fax: profile.fax ?? null,
          email: profile.email ?? null, company_id: profile.companyId ?? null,
          vat: profile.vat ?? null,
          billing_street: profile.billingStreet ?? null,
          billing_postal_code: profile.billingPostalCode ?? null,
          billing_city: profile.billingCity ?? null,
          billing_state: profile.billingState ?? null,
          billing_country: profile.billingCountry ?? null,
          shipping_street: profile.shippingStreet ?? null,
          shipping_postal_code: profile.shippingPostalCode ?? null,
          shipping_city: profile.shippingCity ?? null,
          shipping_state: profile.shippingState ?? null,
          shipping_country: profile.shippingCountry ?? null,
          description: profile.description ?? null,
          annual_revenue: profile.annualRevenue ?? null,
          member_of: profile.memberOf ?? null,
        },
        select: { id: true },
      });
      return { id: account.id, created: true as const };
    });
    if ("conflict" in result) return reply(409, { error: "Account mapping conflict" });
    if (result.created) {
      // Audit is best-effort here: a failure must not cause a second account.
      try {
        await writeAuditLog({ entityType: "account", entityId: result.id, action: "created", changes: null, userId: user.id });
      } catch (error) { console.error("[ERP_ACCOUNT_CREATE_AUDIT]", error); }
    }
    return reply(200, {
      authorized: true, accountId: result.id, erpClientId,
      tenantKey: instanceKey, created: result.created,
    });
  } catch {
    return reply(503, { error: "Unavailable" });
  }
}
