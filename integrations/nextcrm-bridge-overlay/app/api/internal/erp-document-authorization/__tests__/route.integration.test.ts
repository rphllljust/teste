import { NextRequest } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { prismaBase } from "@/lib/prisma-base";
import {
  signBridgeRequest,
  verifyBridgeResponse,
  NEXTCRM_BRIDGE_PATH,
} from "@/lib/erp-bridge/bridge-protocol";
import { POST } from "../route";

// Separate from mocked-Jest contract tests: this test uses original Prisma
// Client and PostgreSQL 17 with actual NextCRM migrations. CI database ONLY.
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/nextcrm_ci" ||
    process.env.NODE_ENV !== "test") {
  throw new Error("NO-GO: refusing to run NextCRM Prisma fixture against any non-ephemeral database");
}
const secret = randomBytes(32).toString("hex");
const tenantKey = "cisne-prisma-ci";
const erpClientId = randomUUID();
const ownerId = randomUUID();
const outsiderId = randomUUID();
const accountId = randomUUID();
const documentId = randomUUID();
process.env.CISNE_NEXTCRM_BRIDGE_SECRET = secret;
process.env.CISNE_NEXTCRM_INSTANCE_KEY = tenantKey;

const basePayload = {
  documentId,
  subjectId: ownerId,
  accountId,
  erpClientId,
  tenantKey,
  requestId: randomUUID(),
};

async function authorize(payload: Record<string, unknown> = basePayload, forge = false) {
  const body = JSON.stringify(payload);
  const proof = signBridgeRequest(secret, body);
  const request = new NextRequest("http://localhost" + NEXTCRM_BRIDGE_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cisne-bridge-timestamp": proof.timestamp,
      "x-cisne-bridge-nonce": proof.nonce,
      "x-cisne-bridge-signature": forge ? "v1=" + "0".repeat(64) : proof.signature,
    },
    body,
  });
  const response = await POST(request);
  const raw = await response.text();
  if (response.status === 200 || response.status === 404 || response.status === 503) {
    expect(verifyBridgeResponse(secret, raw, response.status, proof,
      response.headers.get("x-cisne-bridge-response-signature") ?? "")).toBe(true);
  }
  return { status: response.status, body: JSON.parse(raw) };
}

afterAll(async () => {
  delete process.env.CISNE_NEXTCRM_BRIDGE_SECRET;
  delete process.env.CISNE_NEXTCRM_INSTANCE_KEY;
  await prismaBase.$disconnect();
});

it("validates signed document authorization against REAL PostgreSQL and original Prisma scopes", async () => {
  try {
    await prismaBase.users.createMany({
      data: [
        { id: ownerId, email: "owner-" + ownerId + "@example.invalid", role: "user", userStatus: "ACTIVE" },
        { id: outsiderId, email: "outsider-" + outsiderId + "@example.invalid", role: "user", userStatus: "ACTIVE" },
      ],
    });
    await prismaBase.crm_Accounts.create({
      data: { id: accountId, v: 0, name: "CI isolated company", external_ref: erpClientId, assigned_to: ownerId },
    });
    await prismaBase.documents.create({
      data: {
        id: documentId,
        document_name: "CI no-real-data document",
        document_file_url: "s3://nonexistent/ci-fake",
        document_file_mimeType: "application/pdf",
        connected_documents: [],
        created_by_user: ownerId,
        version: 1,
        content_hash: "a".repeat(64),
      },
    });
    await prismaBase.documentsToAccounts.create({ data: { document_id: documentId, account_id: accountId } });

    const permitted = await authorize();
    expect(permitted.status).toBe(200);
    expect(permitted.body).toEqual({
      authorized: true, id: documentId, accountId, tenantKey, version: 1, sha256: "a".repeat(64),
    });
    expect(JSON.stringify(permitted.body)).not.toContain("s3://");

    expect((await authorize(basePayload, true)).status).toBe(401);
    expect((await authorize({ ...basePayload, subjectId: outsiderId })).status).toBe(404);
    expect((await authorize({ ...basePayload, erpClientId: randomUUID() })).status).toBe(404);
    expect((await authorize({ ...basePayload, accountId: randomUUID() })).status).toBe(404);
    expect((await authorize({ ...basePayload, tenantKey: "foreign-instance" })).status).toBe(404);

    await prismaBase.users.update({ where: { id: ownerId }, data: { userStatus: "PENDING" } });
    expect((await authorize()).status).toBe(404);
    await prismaBase.users.update({ where: { id: ownerId }, data: { userStatus: "ACTIVE", banned: true } });
    expect((await authorize()).status).toBe(404);
    await prismaBase.users.update({ where: { id: ownerId }, data: { banned: false } });

    await prismaBase.documentsToAccounts.delete({
      where: { document_id_account_id: { document_id: documentId, account_id: accountId } },
    });
    expect((await authorize()).status).toBe(404);
    await prismaBase.documentsToAccounts.create({ data: { document_id: documentId, account_id: accountId } });

    await prismaBase.documents.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
    expect((await authorize()).status).toBe(404);
    await prismaBase.documents.update({ where: { id: documentId }, data: { deletedAt: null, version: 2 } });
    const revision = await authorize();
    expect(revision.status).toBe(200);
    expect(revision.body.version).toBe(2);

    await prismaBase.crm_Accounts.update({ where: { id: accountId }, data: { external_ref: null } });
    expect((await authorize()).status).toBe(404);
  } finally {
    // Remove ONLY synthetic data, only in the throwaway 127.0.0.1/nextcrm_ci DB.
    await prismaBase.documentsToAccounts.deleteMany({ where: { document_id: documentId } }).catch(() => {});
    await prismaBase.documents.deleteMany({ where: { id: documentId } }).catch(() => {});
    await prismaBase.crm_Accounts.deleteMany({ where: { id: accountId } }).catch(() => {});
    await prismaBase.users.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } }).catch(() => {});
  }
});
