import { NextRequest } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import {
  signBridgeRequest,
  verifyBridgeResponse,
  NEXTCRM_BRIDGE_PATH,
} from "@/lib/erp-bridge/bridge-protocol";

jest.mock("@/lib/prisma", () => ({
  prismadb: {
    users: { findUnique: jest.fn() },
    crm_Accounts: { findFirst: jest.fn() },
    documents: { findFirst: jest.fn() },
  },
}));
jest.mock("@/lib/minio", () => ({
  MINIO_BUCKET: "nextcrm",
  MINIO_ENDPOINT: "http://nextcrm-minio.railway.internal:9000",
  MINIO_PUBLIC_URL: "https://nextcrm-minio-staging.up.railway.app",
  presignGet: jest.fn(async () => "https://nextcrm-minio-staging.up.railway.app/nextcrm/documents/ci-private.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=60&X-Amz-Signature=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
}));
jest.mock("@/lib/authz", () => ({
  mapLegacyRole: jest.fn((x: string) => x),
  accountReadScopeWhere: jest.fn(() => ({ deletedAt: null })),
  documentReadScopeWhere: jest.fn(() => ({ deletedAt: null })),
}));
import { prismadb } from "@/lib/prisma";
import { POST } from "../route";

const db = prismadb as unknown as {
  users: {findUnique: jest.Mock},
  crm_Accounts: {findFirst: jest.Mock},
  documents: {findFirst: jest.Mock},
};
const secret = randomBytes(32).toString("hex");
const tenantKey = "cisne-hml-1";
const payload = {
  documentId: randomUUID(),
  subjectId: randomUUID(),
  accountId: randomUUID(),
  erpClientId: randomUUID(),
  tenantKey,
  requestId: randomUUID(),
};
const doRequest = (data: object = payload, valid = true) => {
  const body = JSON.stringify(data);
  const proof = signBridgeRequest(secret, body);
  const req = new NextRequest("http://localhost" + NEXTCRM_BRIDGE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cisne-bridge-timestamp": proof.timestamp,
      "x-cisne-bridge-nonce": proof.nonce,
      "x-cisne-bridge-signature": valid ? proof.signature : "v1=" + "0".repeat(64),
    },
    body,
  });
  return { req, proof };
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CISNE_NEXTCRM_BRIDGE_SECRET = secret;
  process.env.CISNE_NEXTCRM_INSTANCE_KEY = tenantKey;
  db.users.findUnique.mockResolvedValue({
    id: payload.subjectId, role: "user", userStatus: "ACTIVE", banned: false,
  });
  db.crm_Accounts.findFirst.mockResolvedValue({ id: payload.accountId });
  db.documents.findFirst.mockResolvedValue({
    id: payload.documentId, version: 2, content_hash: "a".repeat(64),
    key: "documents/ci-private.pdf", document_file_url: "",
  });
});
afterAll(() => {
  delete process.env.CISNE_NEXTCRM_BRIDGE_SECRET;
  delete process.env.CISNE_NEXTCRM_INSTANCE_KEY;
});

describe("NextCRM ERP signed document verifier overlay", () => {
  it("requires signed private request and returns tamper-evident authorization", async () => {
    const { req, proof } = doRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({
      authorized: true, id: payload.documentId, accountId: payload.accountId,
      tenantKey, version: 2,
    });
    expect(verifyBridgeResponse(secret, body, res.status, proof,
      res.headers.get("x-cisne-bridge-response-signature") || "")).toBe(true);
    expect(db.users.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: payload.subjectId },
      select: { id: true, role: true, userStatus: true, banned: true },
    }));
    expect(db.crm_Accounts.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: payload.accountId, external_ref: payload.erpClientId }),
    }));
    expect(db.documents.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: payload.documentId,
        accounts: { some: { account_id: payload.accountId } },
      }),
    }));
  });
  it("issues a 60-second private ticket ONLY for an ACL-verified document", async () => {
    const { req, proof } = doRequest({ ...payload, purpose: "file" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(verifyBridgeResponse(secret, raw, 200, proof,
      res.headers.get("x-cisne-bridge-response-signature") ?? "")).toBe(true);
    expect(JSON.parse(raw)).toMatchObject({
      authorized:true,id:payload.documentId,accountId:payload.accountId,
      tenantKey,version:2,sha256:"a".repeat(64),
      expiresIn:60,fileUrl:expect.stringContaining("X-Amz-Signature="),
    });
  });
  it("fails closed for files without a digest or private documents/ key", async () => {
    for(const wrong of [
      {content_hash:null,key:"documents/ci-private.pdf"},
      {content_hash:"a".repeat(64),key:"avatars/public.jpg"},
      {content_hash:"a".repeat(64),key:"documents/../private.txt"},
      {content_hash:"a".repeat(64),key:null,document_file_url:"https://evil.invalid/file"},
    ]){
      db.documents.findFirst.mockResolvedValueOnce({
        id:payload.documentId,version:2,document_file_url:"",...wrong,
      });
      const res=await POST(doRequest({...payload,purpose:"file"}).req);
      expect(res.status).toBe(404);
    }
  });
  it("rejects forged file ticket signatures before querying Prisma", async () => {
    db.documents.findFirst.mockClear();
    const res=await POST(doRequest({...payload,purpose:"file"},false).req);
    expect(res.status).toBe(401);
    expect(db.documents.findFirst).not.toHaveBeenCalled();
  });
  it("rejects missing/forged signature before touching Prisma", async () => {
    const {req}=doRequest(payload,false);
    expect((await POST(req)).status).toBe(401);
    expect(db.users.findUnique).not.toHaveBeenCalled();
  });
  it("rejects missing subject, inactive/banned users and mismatched instance", async () => {
    db.users.findUnique.mockResolvedValue(null);
    expect((await POST(doRequest().req)).status).toBe(404);
    db.users.findUnique.mockResolvedValue({
      id: payload.subjectId,role: "user",userStatus: "PENDING",banned: false,
    });
    expect((await POST(doRequest().req)).status).toBe(404);
    db.users.findUnique.mockResolvedValue({
      id: payload.subjectId,role: "user",userStatus: "ACTIVE",banned: true,
    });
    expect((await POST(doRequest().req)).status).toBe(404);
    db.users.findUnique.mockClear();
    expect((await POST(doRequest({ ...payload, tenantKey: "foreign-instance" }).req)).status).toBe(404);
    expect(db.users.findUnique).not.toHaveBeenCalled();
  });
  it("rejects account not matching external ERP customer and documents not linked to account", async () => {
    db.crm_Accounts.findFirst.mockResolvedValue(null);
    expect((await POST(doRequest().req)).status).toBe(404);
    expect(db.documents.findFirst).not.toHaveBeenCalled();
    db.crm_Accounts.findFirst.mockResolvedValue({id:payload.accountId});
    db.documents.findFirst.mockResolvedValue(null);
    expect((await POST(doRequest().req)).status).toBe(404);
  });
  it("returns signed unavailable for database errors, never positive permission", async () => {
    db.users.findUnique.mockRejectedValue(new Error("database offline"));
    const {req,proof}=doRequest();
    const res=await POST(req);
    expect(res.status).toBe(503);
    const raw=await res.text();
    expect(verifyBridgeResponse(secret,raw,503,proof,
      res.headers.get("x-cisne-bridge-response-signature") || "")).toBe(true);
  });
});
