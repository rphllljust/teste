import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { POST as registerClient } from '../../app/api/clients/route';
import { POST as registerProposal } from '../../app/api/proposals/route';
import { POST as proposalAction } from '../../app/api/proposals/[id]/commands/route';
import { POST as registerContract } from '../../app/api/contracts/route';
import { POST as contractAction } from '../../app/api/contracts/[id]/commands/route';
import { POST as registerOrder } from '../../app/api/orders/route';
import { POST as orderAction } from '../../app/api/commands/route';
import { POST as registerExecution } from '../../app/api/orders/[id]/execution/route';
import { GET as listExecution } from '../../app/api/orders/[id]/execution/route';
import { POST as registerMeasurement } from '../../app/api/orders/[id]/measurements/route';
import { POST as requestApproval } from '../../app/api/workflow/approvals/route';
import { POST as decideApproval } from '../../app/api/workflow/approvals/[id]/commands/route';
import { POST as registerAccount } from '../../app/api/accounting/accounts/route';
import { POST as configureRule } from '../../app/api/accounting/posting-rules/route';
import { POST as invoiceMeasurement } from '../../app/api/finance/billing/route';
import { POST as settleReceivable } from '../../app/api/finance/receivables/settlements/route';
import { POST as registerStatement } from '../../app/api/bank/statements/route';
import { POST as reconcileBank } from '../../app/api/bank/commands/route';
import { GET as bankDetails } from '../../app/api/bank/statements/[id]/route';
import { GET as ledger } from '../../app/api/accounting/ledger/route';
import { GET as closePreflight } from '../../app/api/finance/periods/preflight/route';
import { GET as listEnterpriseDossiers } from '../../app/api/enterprise/journeys/route';
import { GET as readEnterpriseDossier } from '../../app/api/enterprise/journeys/[id]/route';
import { GET as readOperationalCenter } from '../../app/api/enterprise/operations/route';
import { POST as closePeriod } from '../../app/api/finance/periods/close/route';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !databaseUrl)
  throw new Error('Fictitious end-to-end ERP test requires NODE_ENV=test and PostgreSQL.');
// A non-test Railway PostgreSQL is not safe for synthetic financial documents:
// enforce the exact throwaway databases provisioned by both GitHub CI workflows.
const parsedDatabase = new URL(databaseUrl);
if (!['localhost', '127.0.0.1'].includes(parsedDatabase.hostname) ||
    !['/cisne_test', '/cisne_ci'].includes(parsedDatabase.pathname) ||
    !['cisne_test', 'cisne_ci'].includes(parsedDatabase.username))
  throw new Error('NO-GO: refuses all non-disposable, non-loopback PostgreSQL databases.');

const db = new Pool({ connectionString: databaseUrl, max: 3 });
after(async () => {
  // Accounting links are immutable by design: the isolated CI container is
  // discarded after the job, with all fictional facts and audit events.
  await closeDatabase();
  await db.end();
});

const owner = randomUUID();
const approver = randomUUID();
const outsider = randomUUID();
const clientId = randomUUID();
const proposalId = randomUUID();
const contractId = randomUUID();
const orderId = randomUUID();
const reuseOrderId = randomUUID();
const reuseExecutionId = randomUUID();
const debitAccountId = randomUUID();
const revenueAccountId = randomUUID();
const bankAccountId = randomUUID();
const statementId = randomUUID();
const bankLineId = randomUUID();
const settlementKey = randomUUID();
const closeId = randomUUID();
const today = new Date().toISOString().slice(0, 10);
const firstDay = today.slice(0, 8) + '01';
const lastDay = new Date(Date.UTC(
  Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0,
)).toISOString().slice(0, 10);
const scaledAmount = 2_500_000; // R$ 250,0000 on CISNE's 1/10_000 unit.
const paths = (path: string) => ({ params: Promise.resolve({ id: path }) });
const req = (actor: string, path: string, payload?: unknown) =>
  setTestIdentity(new Request('http://localhost' + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }), actor);
const record = async <T = Record<string, unknown>>(
  response: Response, step: string, expected: number,
): Promise<T> => {
  const result = await response.json() as T & { error?: string; code?: string };
  assert.equal(response.status, expected,
    step + ' HTTP ' + response.status + ' ' + JSON.stringify(result));
  console.log('ORDER_TO_CASH PASS: ' + step + ' HTTP ' + response.status);
  return result;
};

test('ERP order-to-cash: fictitious customer -> accepted proposal -> signed contract -> '
  + 'service execution -> approved measurement -> invoice -> AR -> receipt -> bank -> ledger -> close',
async () => {
  // 1. Fictional customer; no real tax ID, e-mail, customer, payment or bank.
  await record(await registerClient(req(owner, '/api/clients', {
    id: clientId, data: {
      legalName: 'Cliente Fictício de Homologação CI',
      tradeName: 'SIMULACAO SEM VALOR COMERCIAL',
      document: null, email: null, phone: null,
    },
  })), '01 Cliente fictício persistido', 201);

  // 2. Commercial quotation with full entity identity, version and prices.
  await record(await registerProposal(req(owner, '/api/proposals', {
    id: proposalId, clientId, clientVersion: 1,
    data: { title: 'Proposta fictícia de serviço CI',
      scope: 'Apenas prova transacional da cadeia ERP; nenhum serviço real',
      validUntil: '2099-12-31',
      lines: [{ description: 'Serviço fictício', unit: 'un',
        quantity: '1', unitPrice: '250,00' }],
    },
  })), '02 Proposta comercial vinculada ao cliente', 201);
  await record(await proposalAction(req(owner, '/api/proposals/' + proposalId + '/commands',
    { key: randomUUID(), version: 1, command: 'issue' }), paths(proposalId)),
  '02a Proposta emitida', 200);
  await record(await proposalAction(req(owner, '/api/proposals/' + proposalId + '/commands',
    { key: randomUUID(), version: 2, command: 'accept',
      reference: 'ACEITE-FICTICIO-CI-SEM-ASSINATURA-REAL' }), paths(proposalId)),
  '02b Aceite declarativo fictício', 200);

  // 3. Signed-evidence field is deliberately a labeled synthetic reference.
  await record(await registerContract(req(owner, '/api/contracts', {
    id: contractId, proposalId, proposalVersion: 3,
    purchaseOrderId: null, reference: 'CONTRATO-FICTICIO-CI',
    terms: { scope: 'Serviço fictício de homologação sem efeitos jurídicos',
      startsOn: '2026-01-01', endsOn: '2099-12-31' },
  })), '03 Contrato com origem na proposta aceita', 201);
  await record(await contractAction(req(owner, '/api/contracts/' + contractId + '/commands',
    { key: randomUUID(), version: 1, command: 'activate',
      signedReference: 'ASSINATURA-FICTICIA-CI-SEM-VALIDADE' }), paths(contractId)),
  '03a Contrato ativado com referência simulada', 200);

  // 4. Contract-bound service order, authentic status transitions.
  await record(await registerOrder(req(owner, '/api/orders', {
    id: orderId, title: 'OS Fictícia - Auditoria Order to Cash',
    category: 'Serviços', description: 'Execução sintética sem deslocamento',
    dueDate: null, clientId, clientVersion: 1,
    contractId, contractVersion: 2,
  })), '04 OS vinculada ao contrato e cliente', 201);
  await record(await orderAction(req(owner, '/api/commands', {
    id: orderId, version: 1, key: randomUUID(), command: 'authorize',
  })), '04a OS autorizada', 201);
  await record(await orderAction(req(owner, '/api/commands', {
    id: orderId, version: 2, key: randomUUID(), command: 'start',
  })), '04b OS iniciada', 201);

  // 5. Real Field Service endpoint creates a persisted execution fact.
  const execution = await record<{ resource: { id: string } }>(
    await registerExecution(req(owner, '/api/orders/' + orderId + '/execution', {
      command: 'report', key: randomUUID(), version: 3,
      resourceKind: 'labor', description: 'Apontamento fictício da equipe CI',
      quantity: '2', unit: 'hora',
      resourceReference: 'CI-TESTE-NAO-REAL',
      effectiveDate: today, reference: 'EXECUCAO-CI-FAKE',
    }), paths(orderId)),
    '05 Execução operacional registrada', 201,
  );
  await record(await orderAction(req(owner, '/api/commands', {
    id: orderId, version: 3, key: randomUUID(), command: 'complete',
  })), '05a OS concluída', 201);

  // 6. Workflow approval is intentionally initiated from DRAFT, as this
  // existing API does not support approve-after-submission.
  const measurement = await record<{ resource: { id: string } }>(
    await registerMeasurement(req(owner, '/api/orders/' + orderId + '/measurements', {
      key: randomUUID(), executionId: execution.resource.id,
      description: 'Medição fictícia vinculada ao apontamento CI',
      amount: '250,00',
    }), paths(orderId)),
    '06 Medição originada de execução concluída', 201,
  );
  const approvalId = randomUUID();
  await record(await requestApproval(req(owner, '/api/workflow/approvals', {
    id: approvalId, entityId: measurement.resource.id, expectedVersion: 1,
    approverId: approver, entityType: 'measurement',
    command: 'approve_measurement', payload: {},
  })), '06a Aprovação solicitada para outro ator fictício', 201);
  await record(await decideApproval(req(approver,
    '/api/workflow/approvals/' + approvalId + '/commands', {
      key: randomUUID(), version: 1, command: 'approve',
    }), paths(approvalId)), '06b Medição aprovada com segregação de funções', 200);
  const rowMeasurement = await db.query(
    'SELECT status,amount,version,execution_entry_id FROM measurements WHERE id=$1',
    [measurement.resource.id],
  );
  assert.deepEqual({
    status: rowMeasurement.rows[0].status,
    amount: rowMeasurement.rows[0].amount,
    executionId: rowMeasurement.rows[0].execution_entry_id,
  }, { status: 'approved', amount: scaledAmount, executionId: execution.resource.id });

  // 7. Deliberately configure ledger recognition; production rules remain
  // untouched because the whole DB is a disposable local CI container.
  await record(await registerAccount(req(owner, '/api/accounting/accounts', {
    id: debitAccountId, code: 'AR-FAKE', name: 'Recebíveis - Teste CI',
    type: 'asset', active: true,
  })), '07a Conta de ativo fictícia cadastrada', 201);
  await record(await registerAccount(req(owner, '/api/accounting/accounts', {
    id: revenueAccountId, code: 'REV-FAKE', name: 'Receitas - Teste CI',
    type: 'revenue', active: true,
  })), '07b Conta de receita fictícia cadastrada', 201);
  await record(await registerAccount(req(owner, '/api/accounting/accounts', {
    id: bankAccountId, code: 'BANK-FAKE', name: 'Banco fictício - Teste CI',
    type: 'asset', active: true,
  })), '07c Conta bancária fictícia cadastrada', 201);
  await record(await configureRule(req(owner, '/api/accounting/posting-rules', {
    sourceType: 'invoice_billing', commandKey: randomUUID(), expectedVersion: 0,
    debitAccountId, creditAccountId: revenueAccountId, active: true,
  })), '07d Regra de reconhecimento de faturamento ativada', 201);
  const billingKey = randomUUID();
  const billing = await record<{ resource: {
    invoiceId: string; receivableId: string; amount: string;
    accounting: { status: string; journalId: string };
  }}>(await invoiceMeasurement(req(owner, '/api/finance/billing', {
    measurementId: measurement.resource.id, dueDate: '2099-01-01', commandKey: billingKey,
  })), '07 Fatura + recebível + diário atômicos', 201);
  assert.equal(billing.resource.accounting.status, 'auto_posted');
  assert.equal(billing.resource.amount, String(scaledAmount));
  assert.equal((await invoiceMeasurement(req(owner, '/api/finance/billing', {
    measurementId: measurement.resource.id, dueDate: '2099-01-01', commandKey: billingKey,
  }))).status, 200);

  // 8. Activate explicit cash/A/R posting rule; no real payment takes place.
  await record(await configureRule(req(owner, '/api/accounting/posting-rules', {
    sourceType: 'receivable_receipt', commandKey: randomUUID(), expectedVersion: 0,
    debitAccountId: bankAccountId, creditAccountId: debitAccountId, active: true,
  })), '07e Regra de baixa contábil ativada', 201);
  assert.equal((await settleReceivable(req(outsider,
    '/api/finance/receivables/settlements', {
      receivableId: billing.resource.receivableId, amount: String(scaledAmount),
      effectiveDate: today, reference: 'TENTATIVA-NAO-AUTORIZADA',
      commandKey: randomUUID(),
    }))).status, 404);
  const receipt = await record<{ resource: {
    id: string; balance: string; amount: string;
    accounting: { status: string; journalId: string };
  }}>(await settleReceivable(req(owner,
    '/api/finance/receivables/settlements', {
      receivableId: billing.resource.receivableId, amount: String(scaledAmount),
      effectiveDate: today, reference: 'RECEBIMENTO-FICTICIO-CI',
      commandKey: settlementKey,
    })), '08 Título recebido e saldo zerado', 201);
  assert.equal(receipt.resource.balance, '0');
  assert.equal(receipt.resource.id, settlementKey);
  assert.equal(receipt.resource.accounting.status, 'auto_posted');
  assert.ok(receipt.resource.accounting.journalId);
  const replayReceipt = await record<{ resource: { accounting: { journalId: string } } }>(
    await settleReceivable(req(owner, '/api/finance/receivables/settlements', {
      receivableId: billing.resource.receivableId, amount: String(scaledAmount),
      effectiveDate: today, reference: 'RECEBIMENTO-FICTICIO-CI',
      commandKey: settlementKey,
    })), '08a Baixa idempotente sem diário duplicado', 200,
  );
  assert.equal(replayReceipt.resource.accounting.journalId, receipt.resource.accounting.journalId);

  // 9. Manually imported *fabricated* bank statement, not a banking connector.
  await record(await registerStatement(req(owner, '/api/bank/statements', {
    id: statementId, accountReference: 'BANCO-FICTICIO-SEM-CONTA-REAL',
    sourceReference: 'EXTRATO-FICTICIO-CI', periodStart: firstDay,
    periodEnd: lastDay, openingBalance: '0', closingBalance: '250,00',
    lines: [{
      id: bankLineId, externalKey: 'MOVIMENTO-CI-SEM-TRANSFERENCIA',
      bookedDate: today, amount: '250,00',
      description: 'Crédito bancário fictício para conciliação CI',
    }],
  })), '09 Extrato bancário simulado importado', 201);
  await record(await reconcileBank(req(owner, '/api/bank/commands', {
    key: randomUUID(), statementId, lineId: bankLineId,
    command: 'match', version: 1, targetType: 'receipt',
    targetId: settlementKey,
  })), '10 Recebimento associado à linha bancária', 201);
  const bank = await record<{ summary: {
    total: number; matched: number; unmatched: number;
  }}>(await bankDetails(req(owner,
    '/api/bank/statements/' + statementId + '?state=matched'), paths(statementId)),
  '10a Conciliação bancária consultada', 200);
  assert.deepEqual(bank.summary, { total: 1, matched: 1, unmatched: 0 });
  assert.equal((await bankDetails(req(outsider,
    '/api/bank/statements/' + statementId), paths(statementId))).status, 404);

  // 11. Both source journals must appear in the real owner-scoped ledgers.
  const assetLedger = await record<{ items: Array<{ journalId: string }>;
    totals: { debitScaled: string; creditScaled: string } }>(
    await ledger(req(owner, '/api/accounting/ledger?accountId=' + debitAccountId)),
    '11 Razão contábil de ativo a receber', 200,
  );
  const revenueLedger = await record<{ items: Array<{ journalId: string }>;
    totals: { debitScaled: string; creditScaled: string } }>(
    await ledger(req(owner, '/api/accounting/ledger?accountId=' + revenueAccountId)),
    '11a Razão contábil de receita', 200,
  );
  assert.ok(assetLedger.items.some(item => item.journalId === billing.resource.accounting.journalId));
  assert.ok(assetLedger.items.some(item => item.journalId === receipt.resource.accounting.journalId));
  assert.equal(assetLedger.totals.debitScaled, String(scaledAmount));
  assert.equal(assetLedger.totals.creditScaled, String(scaledAmount));
  assert.equal(revenueLedger.totals.creditScaled, String(scaledAmount));
  const bankLedger = await record<{ items: Array<{ journalId: string }>;
    totals: { debitScaled: string; creditScaled: string } }>(
    await ledger(req(owner, '/api/accounting/ledger?accountId=' + bankAccountId)),
    '11b Razão bancário debitado pela baixa fictícia', 200,
  );
  assert.ok(bankLedger.items.some(item => item.journalId === receipt.resource.accounting.journalId));
  assert.equal(bankLedger.totals.debitScaled, String(scaledAmount));
  assert.equal(bankLedger.totals.creditScaled, '0');

  // A used execution stays in immutable history, but must disappear from the
  // measurement source picker. A second, free synthetic execution remains
  // selectable and can create exactly one measurement through the real UI API.
  await db.query(
    "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at) "+
    "VALUES($1,$2,'OS fictícia para reuso de origem','Cliente UAT','Serviços','Fixture de teste','completed',4,$3)",
    [reuseOrderId,owner,new Date().toISOString()],
  );
  await db.query(
    "INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id) "+
    "VALUES($1,$2,'report',3,$3,$4,'synthetic-uatreuse',$1)",
    [reuseExecutionId,reuseOrderId,new Date().toISOString(),owner],
  );
  await db.query(
    "INSERT INTO execution_entries(id,order_id,kind,resource_kind,description,quantity,unit,effective_date,reference,actor_id,created_at) "+
    "VALUES($1,$2,'report','labor','Origem livre fictícia',10000,'hora',$3,'EXECUCAO-LIVRE-UAT',$4,$5)",
    [reuseExecutionId,reuseOrderId,today,owner,new Date().toISOString()],
  );
  const sourcePath='/api/orders/'+reuseOrderId+'/execution?state=active';
  const sourceBefore=await record<{items:Array<{id:string}>}>(
    await listExecution(req(owner,sourcePath),paths(reuseOrderId)),
    '12 Origem fictícia livre listada para medição',200,
  );
  assert.deepEqual(sourceBefore.items.map(row=>row.id),[reuseExecutionId]);
  const syntheticMeasurement=await record<{resource:{id:string}}>(
    await orderAction(req(owner,'/api/commands',{
      id:reuseOrderId,version:4,key:randomUUID(),command:'measure',
      description:'Medição sintética UAT sem serviço real',amount:'1,00',evidenceIds:[reuseExecutionId],
    })),
    '12a Medição fictícia criada com origem disponível',201,
  );
  assert.ok(syntheticMeasurement.resource.id);
  const sourceAfter=await record<{items:Array<{id:string}>}>(
    await listExecution(req(owner,sourcePath),paths(reuseOrderId)),
    '12b Origem consumida removida do seletor',200,
  );
  assert.deepEqual(sourceAfter.items,[]);

  const existingJournals = await db.query(
    'SELECT COUNT(*)::int AS count FROM journal_entries WHERE actor_id=$1', [owner]);
  assert.equal(existingJournals.rows[0].count, 2,
    'Faturamento e baixa geram diários distintos, sem duplicação no replay');

  // 12. Verify both journals and cash reconciliation before period close.
  const previewPath = '/api/finance/periods/preflight?periodStart='
    + firstDay + '&periodEnd=' + lastDay;
  const preview = await record<{ canClose: boolean; blockingInvoices: number;
    invalidCashLinks: number; unpostedCashEvents: number }>(
    await closePreflight(req(owner, previewPath)),
    '12 Pré-fechamento com reconhecimento contábil verificado', 200,
  );
  assert.equal(preview.canClose, true);
  assert.equal(preview.blockingInvoices, 0);
  assert.equal(preview.invalidCashLinks, 0);
  assert.equal(preview.unpostedCashEvents, 0);
  await record(await closePeriod(req(owner, '/api/finance/periods/close', {
    id: closeId, periodStart: firstDay, periodEnd: lastDay,
    reference: 'FECHAMENTO-TESTE-FICTICIO-CI',
  })), '12a Período financeiro fechado', 201);

  // Direct relational evidence: each stage refers to the same persisted chain.
  const chain = await db.query(
    'SELECT c.id AS client_id, p.id AS proposal_id, ct.id AS contract_id, ' +
    'o.id AS order_id, ex.id AS execution_id, m.id AS measurement_id, ' +
    'i.id AS invoice_id, r.id AS receivable_id, st.id AS settlement_id, ' +
    'b.id AS statement_id, jl.id AS journal_id, sj.id AS receipt_journal_id, fc.id AS close_id, ' +
    'i.amount AS amount, st.amount AS received_amount, l.amount AS linked_amount ' +
    'FROM clients c ' +
    'JOIN proposals p ON p.client_id=c.id AND p.owner_id=c.owner_id ' +
    'JOIN contracts ct ON ct.proposal_id=p.id AND ct.client_id=c.id ' +
    'JOIN service_orders o ON o.contract_id=ct.id AND o.client_id=c.id ' +
    'JOIN execution_entries ex ON ex.order_id=o.id ' +
    'JOIN measurements m ON m.execution_entry_id=ex.id AND m.order_id=o.id ' +
    'JOIN invoices i ON i.measurement_id=m.id AND i.order_id=o.id ' +
    'JOIN receivables r ON r.invoice_id=i.id ' +
    "JOIN receivable_settlements st ON st.receivable_id=r.id AND st.kind='receipt' " +
    "JOIN bank_reconciliation_events br ON br.receipt_id=st.id AND br.kind='match' " +
    'JOIN bank_statement_lines bl ON bl.id=br.line_id ' +
    'JOIN bank_statements b ON b.id=bl.statement_id AND b.actor_id=o.owner_id ' +
    'JOIN accounting_invoice_links l ON l.invoice_id=i.id ' +
    'JOIN journal_entries jl ON jl.id=l.journal_id AND jl.actor_id=o.owner_id ' +
    "JOIN accounting_settlement_links sl ON sl.settlement_id=st.id AND sl.actor_id=o.owner_id AND sl.kind='receipt' " +
    "JOIN journal_entries sj ON sj.id=sl.journal_id AND sj.actor_id=o.owner_id AND sj.status='posted' " +
    "JOIN finance_period_closes fc ON fc.actor_id=o.owner_id AND fc.status='closed' " +
    'AND jl.effective_date BETWEEN fc.period_start AND fc.period_end ' +
    'WHERE c.id=$1 AND o.owner_id=$2', [clientId, owner],
  );
  assert.equal(chain.rows.length, 1, 'End-to-end foreign-key/origin chain must be unique.');
  const linked = chain.rows[0];
  assert.deepEqual({
    client: linked.client_id, proposal: linked.proposal_id,
    contract: linked.contract_id, order: linked.order_id,
    execution: linked.execution_id, measurement: linked.measurement_id,
    invoice: linked.invoice_id, receivable: linked.receivable_id,
    settlement: linked.settlement_id, bank: linked.statement_id,
    journal: linked.journal_id, receiptJournal: linked.receipt_journal_id,
    periodClose: linked.close_id,
    invoiceAmount: Number(linked.amount),
    settledAmount: Number(linked.received_amount),
    journalAmount: Number(linked.linked_amount),
  }, {
    client: clientId, proposal: proposalId, contract: contractId,
    order: orderId, execution: execution.resource.id,
    measurement: measurement.resource.id, invoice: billing.resource.invoiceId,
    receivable: billing.resource.receivableId, settlement: settlementKey,
    bank: statementId, journal: billing.resource.accounting.journalId,
    receiptJournal: receipt.resource.accounting.journalId,
    periodClose: closeId,
    invoiceAmount: scaledAmount, settledAmount: scaledAmount,
    journalAmount: scaledAmount,
  });

  // 13. New enterprise dossier is not decorative: it must reconstruct the
  // identical audited PostgreSQL graph and stay inaccessible to outsiders.
  const dossierPath = '/api/enterprise/journeys/' + orderId;
  const dossier = await record<{
    order: { id: string; title: string; status: string };
    stages: Array<{ key: string; state: string; items: Array<{ id: string }> }>;
    financials: { billedScaled: string; settledScaled: string; outstandingScaled: string };
    provenance: { ownerScoped: boolean; consistency: string };
  }>(await readEnterpriseDossier(req(owner,dossierPath),paths(orderId)),
    '13 Dossiê empresarial transversal no PostgreSQL real',200);
  assert.equal(dossier.order.id,orderId);
  assert.equal(dossier.order.status,'completed');
  assert.equal(dossier.provenance.ownerScoped,true);
  assert.equal(dossier.provenance.consistency,'repeatable_read');
  assert.equal(dossier.financials.billedScaled,String(scaledAmount));
  assert.equal(dossier.financials.settledScaled,String(scaledAmount));
  assert.equal(dossier.financials.outstandingScaled,'0');
  const documents = new Map(dossier.stages.map(stage=>[stage.key,stage]));
  const exactDocuments = [
    ['client',clientId],['proposal',proposalId],['contract',contractId],
    ['order',orderId],['execution',execution.resource.id],['measurement',measurement.resource.id],
    ['billing',billing.resource.invoiceId],['receivable',billing.resource.receivableId],
    ['receipt',settlementKey],['accounting',billing.resource.accounting.journalId],
    ['close',closeId],
  ] as const;
  for(const [stage,id] of exactDocuments){
    const item=documents.get(stage);
    assert.equal(item?.state,'linked',stage+' missing from persisted owner-scoped dossier');
    assert.ok(item?.items.some(evidence=>evidence.id===id),stage+' ID was not the exact stored document');
  }
  assert.ok(documents.get('accounting')?.items.some(row=>row.id===receipt.resource.accounting.journalId),
    'both financial journals must be independently linked');
  assert.equal(documents.get('bank')?.state,'linked');
  assert.equal(documents.get('crm')?.state,'not_linked',
    'no fictitious CRM opportunity must be manufactured');
  assert.equal(documents.get('purchaseOrder')?.state,'not_linked',
    'no fictitious customer PO must be manufactured');

  const ownerList = await record<{
    items: Array<{ id: string; billedScaled: string; settledScaled: string }>;
    pageInfo: { total: number; hasMore: boolean };
  }>(await listEnterpriseDossiers(req(owner,
    '/api/enterprise/journeys?status=completed&q=Auditoria&pageSize=20')),
    '13a Fila paginada de processos com valores persistidos',200);
  assert.ok(ownerList.items.some(item=>item.id===orderId
    && item.billedScaled===String(scaledAmount)
    && item.settledScaled===String(scaledAmount)));
  const byOrderNumber = await record<{items:Array<{id:string}>}>(
    await listEnterpriseDossiers(req(owner,'/api/enterprise/journeys?q='+orderId.slice(0,8))),
    '13c Busca empresarial pelo identificador persistido da OS',200);
  assert.ok(byOrderNumber.items.some(item=>item.id===orderId));
  assert.equal((await readEnterpriseDossier(req(outsider,dossierPath),paths(orderId))).status,404,
    'outsider must never receive dossier documents');
  const outsiderList = await record<{ items: Array<{ id: string }> }>(
    await listEnterpriseDossiers(req(outsider,'/api/enterprise/journeys')),
    '13b Usuário externo sem acesso à cadeia',200);
  assert.ok(!outsiderList.items.some(item=>item.id===orderId));
  assert.equal((await readEnterpriseDossier(req(owner,'/api/enterprise/journeys/'+randomUUID()),
    paths(randomUUID()))).status,404);
  assert.equal((await readEnterpriseDossier(req(owner,'/api/enterprise/journeys/invalid'),
    paths('invalid'))).status,400);
  assert.equal((await listEnterpriseDossiers(req(owner,'/api/enterprise/journeys?pageSize=200'))).status,400,
    'unbounded query must be rejected, never cause full-table extraction');

  // 14. Control Tower must read the same persisted owner-scoped order,
  // never treating anonymous/legacy records as authorized documents.
  const controlTower=await record<{
    items:Array<{id:string;status:string;evidence:{measurements:number;invoices:number}}>;
    summary:{total:number;unmeasured:number};
    pageInfo:{total:number;hasMore:boolean};
    source:string;
  }>(await readOperationalCenter(req(owner,
    '/api/enterprise/operations?queue=all&q='+orderId.slice(0,8))),
    '14 Centro de comando com documentos persistidos',200);
  assert.equal(controlTower.source,'postgres_owner_scoped_operations');
  assert.equal(controlTower.pageInfo.total,1);
  assert.ok(controlTower.items.some(item=>item.id===orderId && item.status==='completed'
    && item.evidence.measurements===1 && item.evidence.invoices===1));
  assert.equal(controlTower.summary.unmeasured,0);
  const unauthorizedTower=await record<{
    items:Array<{id:string}>;summary:{total:number};
  }>(await readOperationalCenter(req(outsider,
    '/api/enterprise/operations?queue=all')),
    '14a Centro operacional não expõe OS de outro usuário',200);
  assert.equal(unauthorizedTower.summary.total,0);
  assert.deepEqual(unauthorizedTower.items,[]);
  assert.equal((await readOperationalCenter(req(owner,
    '/api/enterprise/operations?pageSize=999'))).status,400);
  assert.equal((await readOperationalCenter(req(owner,
    '/api/enterprise/operations?queue=invalid'))).status,400);

  console.log(JSON.stringify({
    event: 'CISNE_ORDER_TO_CASH_FICTITIOUS_CI',
    state: 'CHAIN_LINKS_VERIFIED_WITH_CASH_LEDGER',
    realCustomerRecordsCreated: 0, realBankOperations: 0,
    fictionalAmountScaled: String(scaledAmount),
    linkedStages: 12,
    bankMatches: bank.summary.matched,
    journalCount: existingJournals.rows[0].count,
    caveat: 'Synthetic bank matching and explicit accounting rules only; no real transfer or fiscal transmission.',
  }));
});
