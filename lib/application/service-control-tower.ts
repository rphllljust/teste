import {ApiError} from '../api/http';
import {isVerifiedOwner,memberRole,type Query} from './service-needs';

type Context={tenantId:string;actorId:string};
type Exception={needId:string;clientName:string;status:string;priority:string;requestedDate:string;reason:string;code:string};
function statusReason(r:Record<string,unknown>):{code:string;reason:string}|null{
 const status=String(r.status),pending=Number(r.pending_additions??0)>0;
 if(pending)return {code:'ADDITIONAL_PENDING',reason:'Adicional operacional aguardando decisão'};
 if(status==='review_pending')return {code:'FIELD_REVIEW_PENDING',reason:'Relatório de campo aguardando aceite'};
 if(status==='released'&&Number(r.assignments??0)===0)return {code:'ASSIGNMENT_MISSING',reason:'OS liberada ainda sem empregado responsável'};
 if(status==='released'&&Number(r.unconfirmed??0)>0)return {code:'ACK_PENDING',reason:'Empregado ainda não confirmou o recebimento'};
 if(status==='completed'&&Number(r.measurements??0)===0)return {code:'MEASUREMENT_MISSING',reason:'OS concluída sem medição vinculada'};
 if(status==='completed'&&Number(r.approved_unbilled??0)>0)return {code:'BILLING_PENDING',reason:'Medição aprovada aguardando faturamento'};
 if(status==='completed'&&Number(r.invoice_posting_gaps??0)>0)return {code:'INVOICE_GL_UNVERIFIED',reason:'Faturamento sem diário contábil publicado e comprovado'};
 if(status==='completed'&&Number(r.receipt_posting_gaps??0)>0)return {code:'RECEIPT_GL_UNVERIFIED',reason:'Baixa de recebível sem lançamento contábil íntegro'};
 if(status==='completed'&&Number(r.bank_match_gaps??0)>0)return {code:'BANK_RECONCILIATION_PENDING',reason:'Recebimentos registrados sem conciliação com extrato bancário'};
 if(status==='in_analysis')return {code:'DECISION_PENDING',reason:'Necessidade em análise aguardando decisão'};
 if(status==='converted')return {code:'PLAN_OR_RELEASE_PENDING',reason:'OS em preparação, ainda não liberada'};
 if(status==='received')return {code:'ANALYSIS_PENDING',reason:'Entrada aguardando análise administrativa'};
 if(!['completed','rejected'].includes(status)&&String(r.requested_date)<new Date().toISOString().slice(0,10))
  return {code:'SCHEDULE_OVERDUE',reason:'Data solicitada vencida'};
 return null;
}
export async function getServiceControlTower(q:Query,c:Context){
 await memberRole(q,c.tenantId,c.actorId);
 if(!await isVerifiedOwner(q,c.tenantId,c.actorId))
  throw new ApiError(403,'FORBIDDEN','Indicadores integrados são restritos aos controladores verificados.');
 const kpi=await q(`SELECT
  count(*)::int AS total,
  count(*) FILTER(WHERE status IN ('received','in_analysis','approved','converted','released','executing','review_pending'))::int AS open,
  count(*) FILTER(WHERE status='received')::int AS intake,
  count(*) FILTER(WHERE status IN ('approved','converted'))::int AS preparation,
  count(*) FILTER(WHERE status='released')::int AS released,
  count(*) FILTER(WHERE status='executing')::int AS executing,
  count(*) FILTER(WHERE status='review_pending')::int AS awaiting_review,
  count(*) FILTER(WHERE status='completed')::int AS completed,
  count(*) FILTER(WHERE status='rejected')::int AS rejected,
  count(*) FILTER(WHERE status NOT IN ('completed','rejected') AND requested_date<current_date::text)::int AS overdue
  FROM svc_needs WHERE tenant_id=$1`,[c.tenantId]);
 const financial=await q(`SELECT
  count(*) FILTER(WHERE n.status='completed' AND l.measurement_id IS NULL)::int AS not_measured,
  count(*) FILTER(WHERE l.measurement_id IS NOT NULL AND m.status='draft')::int AS measurements_draft,
  count(*) FILTER(WHERE l.measurement_id IS NOT NULL AND m.status='approved')::int AS awaiting_invoice,
  count(*) FILTER(WHERE l.measurement_id IS NOT NULL AND m.status='billed')::int AS billed,
  (COALESCE(sum(CASE WHEN m.status='billed' THEN m.amount ELSE 0 END),0)::bigint/100)::text AS billed_cents,
  (COALESCE(sum(COALESCE((SELECT sum(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END)
     FROM receivable_settlements s WHERE s.receivable_id=rec.id),0)),0)::bigint/100)::text AS received_cents,
  count(*) FILTER(WHERE rec.id IS NOT NULL AND rec.amount>COALESCE(
     (SELECT sum(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END) FROM receivable_settlements s WHERE s.receivable_id=rec.id),0))::int AS open_receivables,
  count(*) FILTER(WHERE rec.id IS NOT NULL AND rec.due_date<current_date::text AND rec.amount>COALESCE(
     (SELECT sum(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END) FROM receivable_settlements s WHERE s.receivable_id=rec.id),0))::int AS overdue_receivables
 FROM svc_needs n
 LEFT JOIN svc_measurement_links l ON l.tenant_id=n.tenant_id AND l.need_id=n.id
 LEFT JOIN measurements m ON m.id=l.measurement_id
 LEFT JOIN invoices i ON i.measurement_id=m.id
 LEFT JOIN receivables rec ON rec.invoice_id=i.id
 WHERE n.tenant_id=$1`,[c.tenantId]);
 const pending=await q(`SELECT count(*)::int AS n FROM svc_additional_requests r
 WHERE r.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM svc_additional_decisions d WHERE d.request_id=r.id)`,[c.tenantId]);
 const entries=await q(`SELECT n.id,n.client_name,n.status,n.priority,n.requested_date,
  (SELECT count(*)::int FROM svc_additional_requests a WHERE a.tenant_id=n.tenant_id AND a.need_id=n.id
   AND NOT EXISTS(SELECT 1 FROM svc_additional_decisions d WHERE d.request_id=a.id)) AS pending_additions,
  (SELECT count(*)::int FROM svc_assignments a WHERE a.tenant_id=n.tenant_id AND a.need_id=n.id) AS assignments,
  (SELECT count(*)::int FROM svc_assignments a WHERE a.tenant_id=n.tenant_id AND a.need_id=n.id
    AND NOT EXISTS(SELECT 1 FROM svc_inbox_events ev WHERE ev.assignment_id=a.id AND ev.event='received')) AS unconfirmed,
  (SELECT count(*)::int FROM svc_measurement_links m WHERE m.tenant_id=n.tenant_id AND m.need_id=n.id) AS measurements,
  (SELECT count(*)::int FROM svc_measurement_links link JOIN measurements m ON m.id=link.measurement_id
   WHERE link.tenant_id=n.tenant_id AND link.need_id=n.id AND m.status='approved') AS approved_unbilled,
  (SELECT count(*)::int FROM svc_measurement_links l
   JOIN invoices i ON i.measurement_id=l.measurement_id
   JOIN service_orders o ON o.id=i.order_id AND o.id=n.order_id
   LEFT JOIN accounting_invoice_links x ON x.invoice_id=i.id AND x.actor_id=o.owner_id
   LEFT JOIN journal_entries j ON j.id=x.journal_id AND j.actor_id=o.owner_id
   WHERE l.tenant_id=n.tenant_id AND l.need_id=n.id
    AND NOT COALESCE((x.id IS NOT NULL AND x.amount=i.amount AND j.status='posted'
      AND j.reversal_of IS NULL
      AND NOT EXISTS(SELECT 1 FROM journal_entries undo WHERE undo.reversal_of=j.id)
      AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=i.amount
      AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=i.amount),FALSE)
  ) AS invoice_posting_gaps,
  (SELECT count(*)::int FROM svc_measurement_links l
   JOIN invoices i ON i.measurement_id=l.measurement_id
   JOIN receivables rec ON rec.invoice_id=i.id
   JOIN receivable_settlements s ON s.receivable_id=rec.id
   JOIN service_orders o ON o.id=i.order_id AND o.id=n.order_id
   LEFT JOIN accounting_settlement_links x ON x.settlement_id=s.id AND x.actor_id=o.owner_id
   LEFT JOIN journal_entries j ON j.id=x.journal_id AND j.actor_id=o.owner_id
   WHERE l.tenant_id=n.tenant_id AND l.need_id=n.id
    AND NOT COALESCE((s.actor_id=o.owner_id AND x.id IS NOT NULL
      AND x.amount=s.amount AND x.kind=s.kind AND x.effective_date=s.effective_date
      AND j.status='posted' AND j.effective_date=s.effective_date
      AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=s.amount
      AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=s.amount
      AND ((s.kind='receipt' AND j.reversal_of IS NULL
        AND NOT EXISTS(SELECT 1 FROM journal_entries undo WHERE undo.reversal_of=j.id))
       OR (s.kind='reversal' AND j.reversal_of=(
        SELECT prior.journal_id FROM accounting_settlement_links prior
        WHERE prior.settlement_id=s.reverses_id AND prior.actor_id=o.owner_id)))),FALSE)
  ) AS receipt_posting_gaps,
  (SELECT count(*)::int FROM svc_measurement_links l
   JOIN invoices i ON i.measurement_id=l.measurement_id
   JOIN receivables rec ON rec.invoice_id=i.id
   JOIN receivable_settlements s ON s.receivable_id=rec.id AND s.kind='receipt'
   JOIN service_orders o ON o.id=i.order_id AND o.id=n.order_id
   WHERE l.tenant_id=n.tenant_id AND l.need_id=n.id AND s.actor_id=o.owner_id
     AND NOT EXISTS(SELECT 1 FROM receivable_settlements reverse
      WHERE reverse.reverses_id=s.id)
     AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events e
      JOIN bank_statement_lines line ON line.id=e.line_id AND line.amount=s.amount
      JOIN bank_statements bank ON bank.id=line.statement_id AND bank.actor_id=o.owner_id
      WHERE e.receipt_id=s.id AND e.actor_id=o.owner_id AND e.kind='match'
       AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=e.id))
  ) AS bank_match_gaps
 FROM svc_needs n WHERE n.tenant_id=$1 AND n.status<>'rejected'
 ORDER BY CASE n.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
 n.requested_date,n.created_at,n.id LIMIT 200`,[c.tenantId]);
 const financialIntegrity={
  invoiceJournalGaps:entries.rows.reduce((total,row)=>total+Number(row.invoice_posting_gaps??0),0),
  receiptJournalGaps:entries.rows.reduce((total,row)=>total+Number(row.receipt_posting_gaps??0),0),
  bankUnmatchedReceipts:entries.rows.reduce((total,row)=>total+Number(row.bank_match_gaps??0),0),
  sampleLimit:200,
  sampleLimited:Number(kpi.rows[0]?.total??0)>200,
  scope:'tenant_owned_service_needs_prioritized_sample',
  note:'As contagens mostram as primeiras 200 necessidades priorizadas, não o universo quando há truncamento. Diário e extrato são conferidos diretamente no PostgreSQL.',
 };
 const exceptions:Exception[]=entries.rows.map(row=>{
  const label=statusReason(row);
  return label?{needId:String(row.id),clientName:String(row.client_name),status:String(row.status),priority:String(row.priority),
   requestedDate:String(row.requested_date),code:label.code,reason:label.reason}:null;
 }).filter((x):x is Exception=>x!==null).slice(0,50);
 return {kpis:kpi.rows[0],finance:financial.rows[0],pendingAdditionals:Number(pending.rows[0]?.n??0),
  exceptions,financialIntegrity,scope:'verified_tenant_owners',generatedAt:new Date().toISOString(),
  note:'Indicadores derivados do PostgreSQL. Medição, faturamento e liquidação são estados distintos, nunca presumidos.'};
}
