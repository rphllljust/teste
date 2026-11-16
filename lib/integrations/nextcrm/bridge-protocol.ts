import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const NEXTCRM_BRIDGE_PATH = '/api/internal/erp-document-authorization';
export const NEXTCRM_BRIDGE_MAX_SKEW_MS = 30_000;
export const NEXTCRM_BRIDGE_MAX_BODY_BYTES = 2_048;

function key(secret: string): Buffer {
  if (!/^[a-f0-9]{64,128}$/.test(secret)) {
    throw new Error('NEXTCRM_BRIDGE_SECRET_INVALID');
  }
  return Buffer.from(secret, 'hex');
}
function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function mac(secret: string, parts: string[]): string {
  return 'v1=' + createHmac('sha256', key(secret)).update(
    ['cisne-nextcrm-bridge', 'v1', ...parts].join('\n'), 'utf8',
  ).digest('hex');
}
function equal(a: string, b: string): boolean {
  if (!/^v1=[a-f0-9]{64}$/.test(a) || !/^v1=[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a.slice(3), 'hex'), Buffer.from(b.slice(3), 'hex'));
}
export type BridgeRequestProof = { timestamp: string; nonce: string };
export function signBridgeRequest(
  secret: string, body: string,
  proof: BridgeRequestProof = {
    timestamp: String(Date.now()), nonce: randomBytes(16).toString('hex'),
  },
) {
  if (Buffer.byteLength(body, 'utf8') > NEXTCRM_BRIDGE_MAX_BODY_BYTES ||
      !/^\d{13}$/.test(proof.timestamp) || !/^[a-f0-9]{32}$/.test(proof.nonce)) {
    throw new Error('NEXTCRM_BRIDGE_REQUEST_INVALID');
  }
  return { ...proof, signature: mac(secret,
    ['request', proof.timestamp, proof.nonce, 'POST', NEXTCRM_BRIDGE_PATH, digest(body)]),
  };
}
export function verifyBridgeRequest(
  secret: string, body: string,
  proof: BridgeRequestProof & { signature: string },
  now: number = Date.now(),
): boolean {
  if (typeof body !== 'string' ||
      Buffer.byteLength(body, 'utf8') > NEXTCRM_BRIDGE_MAX_BODY_BYTES ||
      !/^\d{13}$/.test(proof.timestamp) ||
      !/^[a-f0-9]{32}$/.test(proof.nonce) ||
      !Number.isFinite(now) ||
      Math.abs(now - Number(proof.timestamp)) > NEXTCRM_BRIDGE_MAX_SKEW_MS) return false;
  const expected = mac(secret,
    ['request', proof.timestamp, proof.nonce, 'POST', NEXTCRM_BRIDGE_PATH, digest(body)]);
  return equal(proof.signature, expected);
}
export function signBridgeResponse(
  secret: string, responseBody: string, status: number, proof: BridgeRequestProof,
): string {
  return mac(secret,
    ['response', proof.timestamp, proof.nonce, 'POST', NEXTCRM_BRIDGE_PATH, String(status), digest(responseBody)]);
}
export function verifyBridgeResponse(
  secret: string, responseBody: string, status: number,
  proof: BridgeRequestProof, signature: string,
): boolean {
  return equal(signature, signBridgeResponse(secret, responseBody, status, proof));
}
