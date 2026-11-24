import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { assertFinancePeriodOpen } from '../../../../lib/application/finance';
import { FISCAL_MANUAL_NOTICE, parseFiscalScaled, validateFiscalDate, validateFiscalPeriod } from '../../../../lib/domain/fiscal';

const originLabels = {
  customerId: 'Cliente',
  contractId: 'Contrato',
  orderId: 'Ordem de serviço',
  billingId: 'Faturamento',
  receivableId: 'Recebível',
  payableId: 'Obrigação',
} as const;
const optionalOrigin = z.string().trim().uuid().optional();
const money = z.string().trim().transform((value, context) => {
  try {
    return parseFiscalScaled(value);
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Valor fiscal inválido.' });
    return z.NEVER;
  }
});
const document = z.object({ id:z.string().uuid(), direction:z.enum(['inbound','outbound','service']), documentType:z.enum(['invoice','service_invoice','receipt','other']), number:z.string().trim().min(1).max(40), series:z.string().trim().max(20).optional(), accessKey:z.string().trim().max(80).optional(), issuedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period:z.string().regex(/^\d{4}-\d{2}$/), customerId:optionalOrigin, supplier:z.string().trim().max(200).optional(), clientName:z.string().trim().max(200).optional(), cfop:z.string().trim().max(20).optional(), nature:z.string().trim().max(160).optional(), municipality:z.string().trim().max(120).optional(), taxRegime:z.string().trim().max(80).optional(), grossAmount:money, taxBase:money.default('0'), issRate:money.default('0'), issAmount:money.default('0'), icmsRate:money.default('0'), icmsAmount:money.default('0'), ipiAmount:money.default('0'), pisAmount:money.default('0'), cofinsAmount:money.default('0'), withheldAmount:money.default('0'), sourceReference:z.string().trim().max(160).optional(), billingId:optionalOrigin, receivableId:optionalOrigin, payableId:optionalOrigin, contractId:optionalOrigin, orderId:optionalOrigin, notes:z.string().trim().max(4000).optional(), attachmentReference:z.string().trim().max(500).optional() }).strict();

export async function GET(request:Request){let context:RequestContext|undefined;try{context=requestContext(request);const u=new URL(request.url),q=(u.searchParams.get('q')??'').trim(),period=(u.searchParams.get('period')??'').trim(),status=(u.searchParams.get('status')??'').trim(),page=Math.max(1,Number(u.searchParams.get('page')??'1'));if(status&&!['registered','cancelled','reversed'].includes(status))throw new ApiError(400,'VALIDATION_FAILED','Situação fiscal inválida.');if(period&&!validateFiscalPeriod(period))throw new ApiError(400,'VALIDATION_FAILED','Competência fiscal inválida.');const db=database();const result=await db.prepare("SELECT id,direction,document_type AS \"documentType\",number,series,access_key AS \"accessKey\",issued_on AS \"issuedOn\",period,client_name AS \"clientName\",supplier,gross_amount::text AS \"grossAmountScaled\",tax_base::text AS \"taxBaseScaled\",status,billing_id AS \"billingId\",receivable_id AS \"receivableId\",payable_id AS \"payableId\",contract_id AS \"contractId\",order_id AS \"orderId\",integration_provider AS \"integrationProvider\",created_at AS \"createdAt\" FROM fiscal_documents WHERE actor_id=? AND (?='' OR period=?) AND (?='' OR status=?) AND (?='' OR number LIKE '%'||?||'%' OR COALESCE(client_name,'') LIKE '%'||?||'%') ORDER BY issued_on DESC,id DESC LIMIT 26 OFFSET ?").bind(context.actorId,period,period,status,status,q,q,q,(page-1)*25).all();return respond({items:result.results.slice(0,25),pageInfo:{hasMore:result.results.length>25},notice:FISCAL_MANUAL_NOTICE},context);}catch(e){return failure(e,context);}}

export async function POST(request:Request){let context:RequestContext|undefined;try{context=requestContext(request,true);const parsed=document.safeParse(await jsonBody(request));if(!parsed.success){
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof typeof originLabels;
    if (Object.hasOwn(originLabels, field)) {
      throw new ApiError(400, 'VALIDATION_FAILED', `${originLabels[field]}: informe o UUID completo do registro de origem.`);
    }
  }
  throw new ApiError(400,'VALIDATION_FAILED','Documento fiscal manual inválido.');
}const d=parsed.data;if(!validateFiscalDate(d.issuedOn)||!validateFiscalPeriod(d.period)||d.issuedOn.slice(0,7)!==d.period)throw new ApiError(400,'VALIDATION_FAILED','Data de emissão ou competência fiscal inválida.');if(BigInt(d.issRate)>1000000n||BigInt(d.icmsRate)>1000000n)throw new ApiError(400,'VALIDATION_FAILED','Alíquota fiscal fora do intervalo permitido.');const hash=await fingerprint({actor:context.actorId,data:d});const db=database();const result=await db.transaction(async query=>{const reserved=await query('INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING id',[d.id,context!.actorId,'fiscalDocument',d.id,'register',hash,'',context!.correlationId,new Date().toISOString()]);if(!reserved.rowCount){const old=await query('SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',[d.id]);const row=old.rows[0] as {actor_id:string;entity_type:string;entity_id:string;request_hash:string;result:string};if(!row||row.actor_id!==context!.actorId||row.entity_type!=='fiscalDocument'||row.entity_id!==d.id||row.request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador fiscal já utilizado.');if(!row.result)throw new ApiError(409,'IDEMPOTENCY_IN_PROGRESS','Comando fiscal ainda está em processamento.');return JSON.parse(row.result);}
 await assertFinancePeriodOpen(query,context!.actorId,d.issuedOn);
  // The source IDs are stored as text. Prefer exact matches, then resolve
  // copied UUIDs to a single stored case variant within the actor's context.
  const resolveOrigin = async (id: string | undefined, from: string, ownership: string, label: string) => {
    if (!id) return undefined;
    const { rows } = await query(
      `SELECT source.id FROM ${from} WHERE source.id IN ($1, $3, $4) AND ${ownership}`,
      [id, context!.actorId, id.toLowerCase(), id.toUpperCase()],
    );
    const match = rows.find(row => row.id === id) ?? (rows.length === 1 ? rows[0] : undefined);
    if (!match) {
      throw new ApiError(422, 'FISCAL_ORIGIN_NOT_FOUND', `${label}: origem não encontrada ou indisponível no contexto atual.`);
    }
    return String(match.id);
  };
  const assertRelation = async (sql: string, ids: string[], message: string) => {
    if (!(await query(sql, ids)).rowCount) throw new ApiError(422, 'FISCAL_ORIGIN_NOT_FOUND', message);
  };
  const customerId = await resolveOrigin(d.customerId, 'clients source', 'source.owner_id=$2', originLabels.customerId);
  const contractId = await resolveOrigin(d.contractId, 'contracts source', 'source.owner_id=$2', originLabels.contractId);
  const orderId = await resolveOrigin(d.orderId, 'service_orders source', 'source.owner_id=$2', originLabels.orderId);
  if (orderId && contractId) {
    await assertRelation('SELECT id FROM service_orders WHERE id=$1 AND contract_id=$2', [orderId, contractId], 'A OS informada não pertence ao contrato informado.');
  }
  if (orderId && customerId) {
    await assertRelation('SELECT id FROM service_orders WHERE id=$1 AND client_id=$2', [orderId, customerId], 'A OS informada não pertence ao cliente informado.');
  }
  const billingId = await resolveOrigin(d.billingId, 'invoices source JOIN service_orders o ON o.id=source.order_id', 'o.owner_id=$2', originLabels.billingId);
  if (billingId && orderId) {
    await assertRelation('SELECT id FROM invoices WHERE id=$1 AND order_id=$2', [billingId, orderId], 'O faturamento informado não pertence à OS informada.');
  }
  const receivableId = await resolveOrigin(d.receivableId, 'receivables source JOIN invoices i ON i.id=source.invoice_id JOIN service_orders o ON o.id=i.order_id', 'o.owner_id=$2', originLabels.receivableId);
  const payableId = await resolveOrigin(d.payableId, 'payables source', 'source.actor_id=$2', originLabels.payableId);
 const now=new Date().toISOString();await query('INSERT INTO fiscal_documents(id,direction,document_type,number,series,access_key,issued_on,period,customer_id,supplier,client_name,cfop,nature,municipality,tax_regime,gross_amount,tax_base,iss_rate,iss_amount,icms_rate,icms_amount,ipi_amount,pis_amount,cofins_amount,withheld_amount,status,source_reference,billing_id,receivable_id,payable_id,contract_id,order_id,notes,attachment_reference,integration_provider,created_at,updated_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)',[d.id,d.direction,d.documentType,d.number,d.series??null,d.accessKey??null,d.issuedOn,d.period,customerId??null,d.supplier??null,d.clientName??null,d.cfop??null,d.nature??null,d.municipality??null,d.taxRegime??null,d.grossAmount,d.taxBase,d.issRate,d.issAmount,d.icmsRate,d.icmsAmount,d.ipiAmount,d.pisAmount,d.cofinsAmount,d.withheldAmount,'registered',d.sourceReference??null,billingId??null,receivableId??null,payableId??null,contractId??null,orderId??null,d.notes??null,d.attachmentReference??null,'manual',now,now,context!.actorId,hash,context!.correlationId]);await query('INSERT INTO fiscal_document_events(id,document_id,action,actor_id,metadata,created_at,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),d.id,'registered',context!.actorId,JSON.stringify({integration:'manual',sourceReference:d.sourceReference??null}),now,context!.correlationId]);const response={id:d.id,replayed:false,notice:FISCAL_MANUAL_NOTICE};await query('UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',[JSON.stringify(response),d.id,context!.actorId]);return response;});return respond(result,context,201);}catch(e){const error=e as {code?:string};if(error.code==='23505')return failure(new ApiError(409,'FISCAL_DUPLICATE','Documento fiscal já existe para a mesma identidade empresarial.'),context);return failure(e,context);}}
