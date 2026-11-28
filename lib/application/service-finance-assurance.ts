import {getServiceMeasurementDossier} from './service-measurements';
import type {Query} from './service-needs';

type Context={tenantId:string;needId:string;actorId:string;correlationId:string};
type Step={code:string;label:string;done:boolean;detail:string};
const s=(v:unknown)=>String(v??'');
const b=(v:unknown)=>v===true||v==='t'||v===1;
/**
 * Strict read-only service-need to GL/cash/bank proof. Tenant authorization
 * executes in getServiceMeasurementDossier BEFORE any downstream query.
 *
 * Payments belong to the canonical OS owner; the co-owner sees only aggregate
 * proof, never executes a transaction in the financial owner's ledger.
 */
export async function getServiceFinancialAssurance(q:Query,c:Context){
 const dossier=await getServiceMeasurementDossier(q,c);
 const measurement=dossier.measurements[0] as Record<string,unknown>|undefined;
 const orderId=s(dossier.orderId);
 const canonical=orderId?(await q(`SELECT o.owner_id,o.status FROM service_orders o
  JOIN svc_needs n ON n.order_id=o.id
  WHERE n.tenant_id=$1 AND n.id=$2 AND o.id=$3`,[c.tenantId,c.needId,orderId])).rows[0]:undefined;
 const ownerId=s(canonical?.owner_id),orderStatus=s(canonical?.status);
 const measurementId=s(measurement?.measurementId),invoiceId=s(measurement?.invoiceId);
 const preparedBy=s(measurement?.preparedByActorId),approvedBy=s(measurement?.approvedByActorId);
 const approvalVerified=!!measurementId&&!!preparedBy&&!!approvedBy&&preparedBy!==approvedBy&&
  ['approved','billed'].includes(s(measurement?.status));
 const invoice=invoiceId&&orderId&&ownerId? (await q(`
 SELECT i.id,i.amount::text AS amount_scaled,r.id AS receivable_id,
  r.amount::text AS receivable_amount_scaled,
  COALESCE((l.id IS NOT NULL AND l.actor_id=$3 AND l.amount=i.amount
   AND j.actor_id=$3 AND j.status='posted' AND j.reversal_of IS NULL
   AND NOT EXISTS(SELECT 1 FROM journal_entries undo WHERE undo.reversal_of=j.id)
   AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=i.amount
   AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=i.amount
   AND EXISTS(SELECT 1 FROM journal_lines ar
      JOIN chart_accounts a ON a.id=ar.account_id AND a.actor_id=$3 AND a.type='asset'
      WHERE ar.entry_id=j.id AND ar.debit=i.amount AND ar.credit=0)
   AND EXISTS(SELECT 1 FROM journal_lines rev
      JOIN chart_accounts a ON a.id=rev.account_id AND a.actor_id=$3 AND a.type='revenue'
      WHERE rev.entry_id=j.id AND rev.credit=i.amount AND rev.debit=0)
  ),FALSE) AS ledger_verified
 FROM invoices i
 JOIN measurements m ON m.id=i.measurement_id AND m.order_id=i.order_id
 LEFT JOIN receivables r ON r.invoice_id=i.id
 LEFT JOIN accounting_invoice_links l ON l.invoice_id=i.id AND l.actor_id=$3
 LEFT JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=$3
 WHERE i.id=$1 AND i.order_id=$2 AND m.id=$4
 LIMIT 1`,[invoiceId,orderId,ownerId,measurementId])).rows[0]:undefined;
 const receivableId=s(invoice?.receivable_id);
 const receiptRows=receivableId&&ownerId?(await q(`
 SELECT s.id,s.kind,s.amount::text AS amount_scaled,s.reverses_id,
  (sl.id IS NOT NULL AND sl.actor_id=$2 AND sl.amount=s.amount
   AND sl.kind=s.kind AND sl.effective_date=s.effective_date
   AND j.actor_id=$2 AND j.status='posted' AND j.effective_date=s.effective_date
   AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=s.amount
   AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=s.amount
   AND ((s.kind='receipt' AND j.reversal_of IS NULL
     AND NOT EXISTS(SELECT 1 FROM journal_entries undo WHERE undo.reversal_of=j.id))
   OR (s.kind='reversal' AND j.reversal_of=(
      SELECT prior.journal_id FROM accounting_settlement_links prior
      WHERE prior.settlement_id=s.reverses_id AND prior.actor_id=$2)))
  ) AS ledger_verified,
  (s.kind='receipt' AND NOT EXISTS(
    SELECT 1 FROM receivable_settlements reverse WHERE reverse.reverses_id=s.id)
   AND EXISTS(
    SELECT 1 FROM bank_reconciliation_events e
    JOIN bank_statement_lines line ON line.id=e.line_id AND line.amount=s.amount
    JOIN bank_statements stmt ON stmt.id=line.statement_id AND stmt.actor_id=$2
    WHERE e.receipt_id=s.id AND e.actor_id=$2 AND e.kind='match'
     AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events undone WHERE undone.reverses_id=e.id)
   )) AS bank_matched
 FROM receivable_settlements s
 LEFT JOIN accounting_settlement_links sl ON sl.settlement_id=s.id AND sl.actor_id=$2
 LEFT JOIN journal_entries j ON j.id=sl.journal_id AND j.actor_id=$2
 WHERE s.receivable_id=$1 AND s.actor_id=$2
 ORDER BY s.created_at,s.id LIMIT 501`,[receivableId,ownerId])).rows:[];
 const truncated=receiptRows.length>500;
 const receipts=receiptRows.slice(0,500);
 let settled=0n,events=0,posted=0,activeReceipts=0,bankMatched=0,ledgerFailures=0;
 for(const r of receipts){
  const amount=BigInt(s(r.amount_scaled));
  const kind=s(r.kind);
  if(amount<=0n||!['receipt','reversal'].includes(kind))throw Error('INVALID_FINANCIAL_EVENT');
  settled+=kind==='receipt'?amount:-amount;
  events++;
  if(b(r.ledger_verified))posted++;else ledgerFailures++;
  if(kind==='receipt'){
   const reversed=receipts.some(x=>s(x.reverses_id)===s(r.id));
   if(!reversed){activeReceipts++;if(b(r.bank_matched))bankMatched++;}
  }
 }
 const invoiceAmount=BigInt(s(invoice?.amount_scaled)||'0');
 const receivableAmount=BigInt(s(invoice?.receivable_amount_scaled)||'0');
 const arVerified=!!receivableId&&invoiceAmount>0n&&receivableAmount===invoiceAmount;
 const cashInBounds=!truncated&&settled>=0n&&settled<=receivableAmount;
 const ledgerVerified=b(invoice?.ledger_verified);
 const allCashPosted=events>0&&!truncated&&ledgerFailures===0;
 const bankVerified=activeReceipts>0&&!truncated&&bankMatched===activeReceipts;
 const paid=arVerified&&cashInBounds&&settled===receivableAmount;
 const steps:Step[]=[
  {code:'OPERATION_ACCEPTED',label:'Aceite e conclusão operacional',done:dossier.status==='completed'&&orderStatus==='completed',detail:'OS canônica concluída após revisão do relatório de campo'},
  {code:'MEASUREMENT_LINKED',label:'Medição vinculada ao relatório',done:!!measurementId,detail:'Medição registrada com origem operacional imutável'},
  {code:'FOUR_EYES_MEASUREMENT',label:'Aprovação independente da medição',done:approvalVerified,detail:'Preparador e aprovador são controladores distintos'},
  {code:'INVOICE_PERSISTED',label:'Fatura vinculada à medição',done:!!invoiceId&&!!invoice,detail:'Cobrança registrada na OS, não equivalendo a nota fiscal autorizada'},
  {code:'INVOICE_GL_VERIFIED',label:'Reconhecimento contábil da fatura',done:ledgerVerified,detail:'Diário publicado e balanceado com receitas e contas a receber do titular'},
  {code:'RECEIVABLE_VERIFIED',label:'Título a receber íntegro',done:arVerified,detail:'Título da fatura com valor original preservado'},
  {code:'RECEIPTS_GL_VERIFIED',label:'Recebimentos e estornos contabilizados',done:allCashPosted&&cashInBounds,detail:'Todas as baixas têm diário compatível; origem financeira não é inferida de comprovante'},
  {code:'BANK_RECONCILED',label:'Recebimentos conciliados a extrato',done:bankVerified,detail:'Conciliação com extrato importado e correspondência por valor; não há conexão bancária em tempo real'},
  {code:'RECEIVABLE_PAID',label:'Saldo integralmente liquidado',done:paid,detail:'Liquidação líquida de estornos, calculada em unidades exatas de 1/10.000'},
 ];
 return {
  status:steps.every(x=>x.done)?'EVIDENCE_COMPLETE':'PENDING',
  steps,summary:{invoiceAmountScaled:invoiceAmount.toString(),
   receivableAmountScaled:receivableAmount.toString(),
   settledScaled:settled.toString(),
   outstandingScaled:(receivableAmount>settled?receivableAmount-settled:0n).toString(),
   cashEvents:events,cashEventsWithPostedGL:posted,unpostedCashEvents:ledgerFailures,
   activeReceipts,bankMatchedReceipts:bankMatched,truncated,
  },
  orderId:orderId||null,measurementId:measurementId||null,invoiceId:invoiceId||null,
  source:'tenant_scoped_service_need_canonical_order_ar_gl_bank_facts',
  readOnly:true,
  caution:'Evidência técnica documental; não é homologação humana, confirmação bancária externa, emissão de NFe ou autorização automática para produção.',
  checkedAt:new Date().toISOString(),
 };
}
