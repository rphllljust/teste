import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { assertFinancePeriodOpen } from '../../../../../lib/application/finance';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const command = z.object({ command: z.literal('cancel'), key: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).strict();
const notice = 'DOCUMENTO REGISTRADO MANUALMENTE. NÃO TRANSMITIDO À SEFAZ OU À PREFEITURA.';

export async function GET(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador fiscal inválido.');
    const db = database();
    const document = await db.prepare(`SELECT id,direction,document_type AS "documentType",number,series,access_key AS "accessKey",issued_on AS "issuedOn",period,customer_id AS "customerId",client_name AS "clientName",supplier,cfop,nature,municipality,tax_regime AS "taxRegime",gross_amount::text AS "grossAmountScaled",tax_base::text AS "taxBaseScaled",iss_rate::text AS "issRateScaled",iss_amount::text AS "issAmountScaled",icms_rate::text AS "icmsRateScaled",icms_amount::text AS "icmsAmountScaled",ipi_amount::text AS "ipiAmountScaled",pis_amount::text AS "pisAmountScaled",cofins_amount::text AS "cofinsAmountScaled",withheld_amount::text AS "withheldAmountScaled",status,source_reference AS "sourceReference",billing_id AS "billingId",receivable_id AS "receivableId",payable_id AS "payableId",contract_id AS "contractId",order_id AS "orderId",notes,attachment_reference AS "attachmentReference",integration_provider AS "integrationProvider",created_at AS "createdAt",updated_at AS "updatedAt" FROM fiscal_documents WHERE id=? AND actor_id=?`).bind(id, context.actorId).first();
    if (!document) throw new ApiError(404, 'NOT_FOUND', 'Documento fiscal não encontrado.');
    const events = await db.prepare(`SELECT id,action,actor_id AS "actorId",metadata,created_at AS "createdAt",correlation_id AS "correlationId" FROM fiscal_document_events WHERE document_id=? AND actor_id=? ORDER BY created_at DESC,id DESC`).bind(id, context.actorId).all();
    return respond({ document, events: events.results, notice }, context);
  } catch (error) { return failure(error, context); }
}

export async function POST(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador fiscal inválido.');
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Comando fiscal inválido.');
    const hash = await fingerprint({ actor: context.actorId, entity: id, data: parsed.data });
    const db = database();
    const result = await db.transaction(async query => {
      const existing = await query('SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1', [parsed.data.key]);
      if (existing.rows[0]) {
        const old = existing.rows[0] as { actor_id: string; entity_type: string; entity_id: string; request_hash: string; result: string | null };
        if (old.actor_id !== context!.actorId || old.entity_type !== 'fiscalDocument' || old.entity_id !== id || old.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave de comando fiscal já utilizada.');
        if (!old.result) throw new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Comando fiscal ainda está em processamento.');
        return JSON.parse(old.result);
      }
      await query(`INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [parsed.data.key, context!.actorId, 'fiscalDocument', id, 'cancel', hash, '', context!.correlationId, new Date().toISOString()]);
      const row = await query('SELECT status,issued_on AS "issuedOn",integration_provider AS "integrationProvider" FROM fiscal_documents WHERE id=$1 AND actor_id=$2 FOR UPDATE', [id, context!.actorId]);
      const document = row.rows[0] as { status: string; issuedOn: string; integrationProvider: string } | undefined;
      if (!document) throw new ApiError(404, 'NOT_FOUND', 'Documento fiscal não encontrado.');
      if (document.integrationProvider !== 'manual') throw new ApiError(409, 'INVALID_STATE', 'Somente documentos fiscais manuais podem ser cancelados por este comando.');
      if (document.status !== 'registered') throw new ApiError(409, 'INVALID_STATE', 'Somente documentos fiscais registrados podem ser cancelados.');
      await assertFinancePeriodOpen(query, context!.actorId, document.issuedOn);
      const now = new Date().toISOString();
      await query('UPDATE fiscal_documents SET status=$1,updated_at=$2 WHERE id=$3 AND actor_id=$4', ['cancelled', now, id, context!.actorId]);
      await query('INSERT INTO fiscal_document_events(id,document_id,action,actor_id,metadata,created_at,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [crypto.randomUUID(), id, 'cancelled', context!.actorId, JSON.stringify({ reason: parsed.data.reason, integration: 'manual' }), now, context!.correlationId]);
      const response = { resource: { id, status: 'cancelled' }, notice: 'Documento fiscal cancelado manualmente. Nenhuma transmissão para SEFAZ ou prefeitura foi realizada.' };
      await query('UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3', [JSON.stringify(response), parsed.data.key, context!.actorId]);
      return response;
    });
    return respond(result, context);
  } catch (error) { return failure(error, context); }
}
