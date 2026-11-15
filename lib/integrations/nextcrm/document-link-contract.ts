import { z } from 'zod';

/**
 * Input contract only. This does not create a document link, access NextCRM,
 * or authorize access to either system. All authorization is a server concern.
 *
 * An authenticated ERP service must derive owner/tenant from its own session.
 * Never accept ownerId, tenantId, public URLs or file paths from the caller.
 */
export const nextcrmOrderDocumentLinkInput = z.object({
  serviceOrderId: z.string().uuid(),
  nextcrmDocumentId: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/, 'Invalid opaque NextCRM document ID'),
  documentKind: z.enum(['attachment', 'contract', 'photo', 'service_report', 'inspection', 'invoice']),
  version: z.number().int().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export type NextcrmOrderDocumentLinkInput = z.infer<typeof nextcrmOrderDocumentLinkInput>;

export function validateNextcrmOrderDocumentLinkInput(input: unknown): NextcrmOrderDocumentLinkInput {
  return nextcrmOrderDocumentLinkInput.parse(input);
}
