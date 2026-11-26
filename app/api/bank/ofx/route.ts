import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, type RequestContext } from '../../../../lib/api/http';
import { OfxImportError, parseOfxBankStatement } from '../../../../lib/domain/bank-ofx';
import { saveBankStatement } from '../statements/route';

const payloadSchema = z.object({ ofx: z.string().min(50).max(1_000_000) }).strict();

function uuidFromDigest(digest: string): string {
  const bytes = digest.slice(0, 32).match(/../g)!.map(value => parseInt(value, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const id = bytes.map(value => value.toString(16).padStart(2, '0')).join('');
  return [id.slice(0, 8), id.slice(8, 12), id.slice(12, 16), id.slice(16, 20), id.slice(20)].join('-');
}

/**
 * Enterprise bank-import contract: owner-scoped stable IDs, idempotent replay,
 * fiscal-period lock and authoritative DB transaction via saveBankStatement.
 * The original OFX text is never persisted in application tables or logs.
 */
export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    if (Number(request.headers.get('content-length') ?? '0') > 1_200_000)
      throw new ApiError(413, 'OFX_TOO_LARGE', 'Arquivo OFX superior ao limite de 1 MB.');
    const parsed = payloadSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'OFX_VALIDATION_FAILED', 'Informe um extrato OFX de até 1 MB.');
    const statement = parseOfxBankStatement(parsed.data.ofx);
    const stable = await fingerprint({ owner: context.actorId, statement });
    const id = uuidFromDigest(stable);
    const lines = await Promise.all(statement.lines.map(async line => ({
      ...line,
      id: uuidFromDigest(await fingerprint({ owner: context!.actorId, import: stable, fitid: line.externalKey })),
    })));
    return await saveBankStatement(context, {
      id,
      accountReference: statement.accountReference,
      sourceReference: 'OFX:' + stable.slice(0, 40),
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      openingBalance: statement.openingBalance,
      closingBalance: statement.closingBalance,
      lines,
    });
  } catch (error) {
    if (error instanceof OfxImportError)
      return failure(new ApiError(400, 'OFX_VALIDATION_FAILED', error.message), context);
    return failure(error, context);
  }
}
