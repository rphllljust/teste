import { databasePool } from '../../db/raw';
import { ApiError } from '../api/http';
import type { PoolClient } from 'pg';

export type DossierStageKey =
  'crm'|'client'|'proposal'|'purchaseOrder'|'contract'|'order'|'execution'|'measurement'|'billing'|
  'receivable'|'receipt'|'bank'|'accounting'|'close';

export type DossierEvidence = {
  id: string;
  reference: string;
  state: string;
  createdAt: string | null;
  amountScaled?: string;
  module: string;
};
export type DossierStage = {
  key: DossierStageKey;
  title: string;
  module: string;
  state: 'linked'|'not_linked';
  items: DossierEvidence[];
  truncated: boolean;
};
export type DossierAlert = { code: string; severity: 'info'|'warning'; message: string };

type Row = Record<string, unknown>;
type ReadQuery = (sql: string, params?: unknown[]) => Promise<Row[]>;
const asText = (v: unknown) => v === null || v === undefined ? '' : String(v);
const asCount = (v: unknown) => Math.max(0, Number(v ?? 0));
const scaled = (v: unknown) => asText(v || '0');
const readOnlyLimit = 51;
const evidence = (row: Row, module: string, reference: string, state: string, amount?: unknown): DossierEvidence => ({
  id: asText(row.id), reference, state,
  createdAt: row.created_at ? asText(row.created_at) : null,
  module, ...(amount === undefined || amount === null ? {} : { amountScaled: scaled(amount) }),
});
const group = (key: DossierStageKey, title: string, module: string, records: DossierEvidence[]): DossierStage => ({
  key, title, module, state: records.length ? 'linked' : 'not_linked',
  items: records.slice(0, 50), truncated: records.length > 50,
});

/**
 * An enterprise process is a read-model of persisted facts, NOT a second
 * workflow engine. Repeatable-read prevents mixing different financial
 * versions within one dossier. Authorization is checked before any related
 * document is queried; relations are always scoped to that owned order.
 */
async function snapshot<T>(work: (read: ReadQuery) => Promise<T>): Promise<T> {
  const client: PoolClient = await databasePool().connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const read: ReadQuery = async (sql, params = []) => (await client.query(sql, params)).rows as Row[];
    const result = await work(read);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type DossierListFilter = { q: string; status: string; page: number; pageSize: number };
export async function listEnterpriseDossiers(actorId: string, filter: DossierListFilter) {
  return snapshot(async read => {
    const where = `o.owner_id=$1
      AND ($2='' OR o.title ILIKE $2 OR o.client ILIKE $2)
      AND ($3='' OR o.status=$3)`;
    const q = filter.q ? '%' + filter.q.replace(/[%_\\]/g, '\\$&') + '%' : '';
    const count = await read(`SELECT count(*)::int AS total FROM service_orders o WHERE ${where}`, [actorId, q, filter.status]);
    const rows = await read(`SELECT o.id,o.title,o.client,o.status,o.created_at,o.due_date,
      (SELECT count(*)::int FROM execution_entries e WHERE e.order_id=o.id AND e.kind='report'
       AND NOT EXISTS(SELECT 1 FROM execution_entries undo WHERE undo.reverses_id=e.id)) AS executions,
      (SELECT count(*)::int FROM measurements m WHERE m.order_id=o.id) AS measurements,
      (SELECT count(*)::int FROM invoices i WHERE i.order_id=o.id) AS invoices,
      (SELECT count(*)::int FROM receivables r JOIN invoices i ON i.id=r.invoice_id
       WHERE i.order_id=o.id) AS receivables,
      (SELECT coalesce(sum(i.amount),0)::text FROM invoices i WHERE i.order_id=o.id) AS billed_scaled,
      (SELECT coalesce(sum(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END),0)::text
       FROM receivable_settlements s JOIN receivables r ON r.id=s.receivable_id
       JOIN invoices i ON i.id=r.invoice_id
       WHERE i.order_id=o.id AND s.actor_id=$1) AS settled_scaled
      FROM service_orders o WHERE ${where}
      ORDER BY o.created_at DESC,o.id DESC LIMIT $4 OFFSET $5`,
      [actorId, q, filter.status, filter.pageSize, (filter.page - 1) * filter.pageSize]);
    const total = asCount(count[0]?.total);
    return {
      items: rows.map(row => ({
        id: asText(row.id), title: asText(row.title), client: asText(row.client),
        state: asText(row.status), createdAt: asText(row.created_at),
        dueDate: row.due_date ? asText(row.due_date) : null,
        evidence: {
          executions: asCount(row.executions), measurements: asCount(row.measurements),
          invoices: asCount(row.invoices), receivables: asCount(row.receivables),
        },
        billedScaled: scaled(row.billed_scaled), settledScaled: scaled(row.settled_scaled),
      })),
      pageInfo: {
        page: filter.page, pageSize: filter.pageSize, total,
        hasMore: filter.page * filter.pageSize < total,
      },
      source: 'postgres_owned_service_orders' as const,
    };
  });
}

export async function getEnterpriseDossier(actorId: string, orderId: string) {
  return snapshot(async read => {
    const order = (await read(`SELECT id,title,client,status,version,client_id,contract_id,
      category,description,created_at,due_date FROM service_orders
      WHERE id=$1 AND owner_id=$2 LIMIT 1`, [orderId, actorId]))[0];
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Dossiê empresarial não encontrado.');
    const alerts: DossierAlert[] = [];
    const clientId = asText(order.client_id);
    const contractId = asText(order.contract_id);
    const client = clientId ? (await read(`SELECT id,legal_name,status,created_at
      FROM clients WHERE id=$1 AND owner_id=$2 LIMIT 1`, [clientId, actorId]))[0] : undefined;
    if (clientId && !client) alerts.push({
      code: 'CLIENT_LINK_UNAVAILABLE', severity:'warning',
      message:'A OS informa um cliente, mas o vínculo cadastral não está disponível neste contexto.',
    });
    if (!clientId) alerts.push({
      code:'HISTORICAL_CLIENT',severity:'info',
      message:'Esta ordem usa o cliente histórico informado, sem vínculo com cadastro empresarial.',
    });

    const contract = contractId ? (await read(`SELECT id,client_id,proposal_id,
      purchase_order_id,reference,status,created_at
      FROM contracts WHERE id=$1 AND owner_id=$2 LIMIT 1`, [contractId, actorId]))[0] : undefined;
    if (contractId && (!contract || (clientId && asText(contract.client_id) !== clientId)))
      alerts.push({code:'CONTRACT_LINK_UNAVAILABLE',severity:'warning',
        message:'O contrato informado não foi confirmado no mesmo contexto e cliente da OS.'});
    const trustedContract = contract && (!clientId || asText(contract.client_id) === clientId) ? contract : undefined;

    const proposal = trustedContract ? (await read(`SELECT id,title,status,total::text AS total,
      client_id,created_at FROM proposals
      WHERE id=$1 AND owner_id=$2 AND client_id=$3 LIMIT 1`,
      [trustedContract.proposal_id,actorId,trustedContract.client_id]))[0] : undefined;
    if (trustedContract && !proposal) alerts.push({
      code:'PROPOSAL_LINK_UNAVAILABLE',severity:'warning',
      message:'A proposta de origem do contrato não está disponível no escopo autorizado.',
    });
    const purchaseOrder = trustedContract && trustedContract.purchase_order_id
      ? (await read(`SELECT id,reference,status,created_at FROM purchase_orders
          WHERE id=$1 AND owner_id=$2 AND proposal_id=$3 LIMIT 1`,
        [trustedContract.purchase_order_id, actorId, trustedContract.proposal_id]))[0]
      : undefined;
    const crmOpportunity = proposal ? (await read(`SELECT opp.id,opp.title,opp.stage AS status,opp.created_at
      FROM crm_opportunity_proposals origin
      JOIN crm_opportunities opp ON opp.id=origin.opportunity_id AND opp.owner_id=origin.owner_id
      WHERE origin.owner_id=$1 AND origin.proposal_id=$2 LIMIT 1`,
      [actorId,proposal.id]))[0] : undefined;

    const [execution, measurements, invoices, settlements, bankMatches, events] = await Promise.all([
      read(`SELECT e.id,e.reference,e.resource_kind,e.created_at FROM execution_entries e
        WHERE e.order_id=$1 AND e.kind='report' AND NOT EXISTS
        (SELECT 1 FROM execution_entries reversed WHERE reversed.reverses_id=e.id)
        ORDER BY e.created_at DESC,e.id DESC LIMIT ${readOnlyLimit}`,[orderId]),
      read(`SELECT m.id,m.description,m.status,m.amount::text AS amount_scaled,m.created_at
        FROM measurements m WHERE m.order_id=$1
        ORDER BY m.created_at DESC,m.id DESC LIMIT ${readOnlyLimit}`,[orderId]),
      read(`SELECT i.id,i.amount::text AS amount_scaled,i.due_date,i.created_at,
        m.status AS measurement_status,m.id AS measurement_id,
        r.id AS receivable_id,r.amount::text AS receivable_amount,
        ail.journal_id AS journal_id,j.status AS journal_status,j.effective_date AS journal_date
        FROM invoices i
        JOIN measurements m ON m.id=i.measurement_id AND m.order_id=i.order_id
        LEFT JOIN receivables r ON r.invoice_id=i.id
        LEFT JOIN accounting_invoice_links ail ON ail.invoice_id=i.id AND ail.actor_id=$2
        LEFT JOIN journal_entries j ON j.id=ail.journal_id AND j.actor_id=$2
        WHERE i.order_id=$1 ORDER BY i.created_at DESC,i.id DESC LIMIT ${readOnlyLimit}`,
        [orderId,actorId]),
      read(`SELECT s.id,s.kind,s.amount::text AS amount_scaled,s.reference,s.created_at,
        s.effective_date,s.receivable_id,asl.journal_id,j.status AS journal_status,
        j.effective_date AS journal_date
        FROM receivable_settlements s
        JOIN receivables r ON r.id=s.receivable_id
        JOIN invoices i ON i.id=r.invoice_id
        LEFT JOIN accounting_settlement_links asl ON asl.settlement_id=s.id AND asl.actor_id=$2
        LEFT JOIN journal_entries j ON j.id=asl.journal_id AND j.actor_id=$2
        WHERE i.order_id=$1 AND s.actor_id=$2
        ORDER BY s.created_at DESC,s.id DESC LIMIT ${readOnlyLimit}`,[orderId,actorId]),
      read(`SELECT e.id,statement.id AS statement_id,statement.source_reference,
        line.booked_date AS created_at,s.id AS receipt_id
        FROM bank_reconciliation_events e
        JOIN receivable_settlements s ON s.id=e.receipt_id AND s.actor_id=$2 AND s.kind='receipt'
        JOIN receivables r ON r.id=s.receivable_id
        JOIN invoices i ON i.id=r.invoice_id
        JOIN bank_statement_lines line ON line.id=e.line_id
        JOIN bank_statements statement ON statement.id=line.statement_id AND statement.actor_id=$2
        WHERE i.order_id=$1 AND e.actor_id=$2 AND e.kind='match'
          AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=e.id)
        ORDER BY e.created_at DESC,e.id DESC LIMIT ${readOnlyLimit}`,[orderId,actorId]),
      read(`SELECT id,command,created_at,actor_id FROM order_events WHERE order_id=$1
        ORDER BY created_at DESC,id DESC LIMIT 30`,[orderId]),
    ]);

    const journalById = new Map<string,DossierEvidence>();
    const journalIds: string[] = [];
    for (const row of [...invoices,...settlements]) {
      const journalId = asText(row.journal_id);
      if (!journalId) continue;
      journalIds.push(journalId);
      if (!journalById.has(journalId)) journalById.set(journalId,
        {id:journalId,reference:'Lançamento '+journalId.slice(0,8).toUpperCase(),
         state:asText(row.journal_status)||'vínculo não confirmado',
         createdAt:row.journal_date?asText(row.journal_date):null,module:'Contabilidade'});
    }
    const periods = journalIds.length ? await read(`SELECT DISTINCT p.id,p.period_start,p.period_end,
      p.status,p.closed_at AS created_at FROM finance_period_closes p
      WHERE p.actor_id=$1 AND EXISTS (
        SELECT 1 FROM journal_entries j
        WHERE j.actor_id=$1 AND j.id=ANY($2::text[])
        AND j.effective_date BETWEEN p.period_start AND p.period_end
      ) ORDER BY p.closed_at DESC,p.id DESC LIMIT ${readOnlyLimit}`,
      [actorId,[...new Set(journalIds)]]) : [];

    if (!contractId) alerts.push({code:'NO_CONTRACT_ORIGIN',severity:'info',
      message:'Nenhum contrato está diretamente vinculado a esta OS.'});
    if (invoices.some(row => !row.receivable_id)) alerts.push({
      code:'AR_LINK_MISSING',severity:'warning',
      message:'Existe faturamento sem vínculo recuperável com um recebível neste dossiê.',
    });
    if (invoices.some(row => !row.journal_id)) alerts.push({
      code:'INVOICE_JOURNAL_UNVERIFIED',severity:'info',
      message:'Existem faturas sem vínculo de escrituração comprovado; isso não implica lançamento automático.',
    });
    if (settlements.some(row => !row.journal_id)) alerts.push({
      code:'RECEIPT_JOURNAL_UNVERIFIED',severity:'info',
      message:'Existem baixas sem vínculo contábil comprovado neste escopo.',
    });
    const matchedReceiptIds=new Set(bankMatches.map(v=>asText(v.receipt_id)));
    if (settlements.some(v=>v.kind==='receipt'&&!matchedReceiptIds.has(asText(v.id))))
      alerts.push({code:'BANK_MATCH_UNVERIFIED',severity:'info',
        message:'Há recebimentos sem conciliação bancária ativa identificada neste dossiê.'});

    const stages: DossierStage[] = [
      group('crm','Origem CRM','CRM e Vendas',crmOpportunity ?
        [evidence(crmOpportunity,'CRM e Vendas',asText(crmOpportunity.title),asText(crmOpportunity.status))]:[]),
      group('client','Cliente','Clientes e propostas',client ?
        [evidence(client,'Clientes e propostas',asText(client.legal_name),asText(client.status))]:[]),
      group('proposal','Proposta comercial','Propostas e PO',proposal ?
        [evidence(proposal,'Propostas e PO',asText(proposal.title),asText(proposal.status),proposal.total)]:[]),
      group('purchaseOrder','Pedido do cliente','Propostas e PO',purchaseOrder ?
        [evidence(purchaseOrder,'Propostas e PO',asText(purchaseOrder.reference),asText(purchaseOrder.status))]:[]),
      group('contract','Contrato','Contratos',trustedContract ?
        [evidence(trustedContract,'Contratos',asText(trustedContract.reference),asText(trustedContract.status))]:[]),
      group('order','Ordem de serviço','Ordens de serviço',[
        evidence(order,'Ordens de serviço',asText(order.title),asText(order.status))]),
      group('execution','Apontamentos de execução','Execução',execution.map(v=>
        evidence(v,'Execução',asText(v.reference),asText(v.resource_kind)))),
      group('measurement','Medições','Medições',measurements.map(v=>
        evidence(v,'Medições',asText(v.description),asText(v.status),v.amount_scaled))),
      group('billing','Faturas','Faturamento',invoices.map(v=>
        evidence(v,'Faturamento','Fatura '+asText(v.id).slice(0,8).toUpperCase(),'registrada',v.amount_scaled))),
      group('receivable','Títulos a receber','Financeiro',invoices.filter(v=>v.receivable_id).map(v=>({
        id:asText(v.receivable_id), reference:'Recebível '+asText(v.receivable_id).slice(0,8).toUpperCase(),
        state:'registrado',createdAt:asText(v.created_at),module:'Financeiro',
        amountScaled:scaled(v.receivable_amount),
      }))),
      group('receipt','Recebimentos e estornos','Tesouraria',settlements.map(v=>
        evidence(v,'Tesouraria',asText(v.reference),asText(v.kind),v.amount_scaled))),
      group('bank','Conciliação bancária','Caixa e conciliação',bankMatches.map(v=>({
        id:asText(v.id),reference:asText(v.source_reference),state:'conciliação ativa',
        createdAt:asText(v.created_at),module:'Caixa e conciliação',
      }))),
      group('accounting','Lançamentos de origem','Contabilidade',[...journalById.values()]),
      group('close','Fechamentos relacionados','Fechamentos',periods.map(v=>({
        id:asText(v.id),reference:asText(v.period_start)+' a '+asText(v.period_end),
        state:asText(v.status),createdAt:asText(v.created_at),module:'Fechamentos',
      }))),
    ];
    const billedScaled = invoices.reduce((sum,row)=>sum+BigInt(scaled(row.amount_scaled)),0n).toString();
    const settledScaled = settlements.reduce((sum,row)=>
      sum+(row.kind==='receipt'?1n:-1n)*BigInt(scaled(row.amount_scaled)),0n).toString();
    return {
      order: {
        id:asText(order.id),title:asText(order.title),status:asText(order.status),
        version:asCount(order.version),client:asText(order.client),
        category:asText(order.category),description:asText(order.description),
        createdAt:asText(order.created_at),dueDate:order.due_date?asText(order.due_date):null,
      },
      financials: {
        billedScaled,settledScaled,outstandingScaled:(BigInt(billedScaled)-BigInt(settledScaled)).toString(),
        note:'Valores em unidades de 1/10.000 de real; o saldo é apenas da cadeia faturada identificada.',
      },
      stages, alerts,
      history:events.map(v=>({id:asText(v.id),command:asText(v.command),createdAt:asText(v.created_at)})),
      provenance: {
        source:'postgres_read_only_snapshot',ownerScoped:true,consistency:'repeatable_read',
        warning:'Vínculo recuperado não equivale a conclusão ou autorização da próxima transação.',
      },
    };
  });
}
