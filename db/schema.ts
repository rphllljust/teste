import { sql } from 'drizzle-orm';
import { pgTable, text, integer, bigint, foreignKey, check, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
export const orders = pgTable('service_orders', {
 contractId:text('contract_id'),clientId:text('client_id'),ownerId:text('owner_id'),id: text('id').primaryKey(), title: text('title').notNull(), client: text('client').notNull(),
 category: text('category').notNull(), description: text('description').notNull(),
 dueDate: text('due_date'), createdAt: text('created_at').notNull(),
 status: text('status').notNull().default('draft'), version:integer('version').notNull().default(1),
},t=>[check('order_status_valid',sql`${t.status} IN ('draft','authorized','executing','completed','cancelled')`),check('order_version_valid',sql`${t.version}>0`),index('orders_created_idx').on(t.createdAt),index('orders_status_idx').on(t.status)]);
export const events=pgTable('order_events',{id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>orders.id),command:text('command').notNull(),version:integer('version').notNull(),createdAt:text('created_at').notNull(),actorId:text('actor_id'),requestHash:text('request_hash'),targetId:text('target_id'),result:text('result'),correlationId:text('correlation_id')});
export const measurements=pgTable('measurements',{id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>orders.id),executionEntryId:text('execution_entry_id').references(()=>executionEntries.id),description:text('description').notNull(),amount:integer('amount').notNull(),status:text('status').notNull().default('draft'),version:integer('version').notNull().default(1),submittedAt:text('submitted_at'),submittedBy:text('submitted_by'),cancelledAt:text('cancelled_at'),cancelledBy:text('cancelled_by'),cancellationReason:text('cancellation_reason'),createdAt:text('created_at').notNull()},t=>[check('measurement_amount_positive',sql`${t.amount}>0`),check('measurement_status_valid',sql`${t.status} IN ('draft','submitted','approved','billed','cancelled')`),check('measurement_version_valid',sql`${t.version}>0`),index('measurements_order_idx').on(t.orderId),index('measurements_order_status_idx').on(t.orderId,t.status,t.createdAt)]);
export const invoices=pgTable('invoices',{id:text('id').primaryKey(),measurementId:text('measurement_id').notNull().unique().references(()=>measurements.id),orderId:text('order_id').notNull().references(()=>orders.id),amount:integer('amount').notNull(),dueDate:text('due_date').notNull(),createdAt:text('created_at').notNull()},t=>[check('invoice_amount_positive',sql`${t.amount}>0`)]);
export const receivables=pgTable('receivables',{id:text('id').primaryKey(),invoiceId:text('invoice_id').notNull().unique().references(()=>invoices.id),amount:integer('amount').notNull(),dueDate:text('due_date').notNull(),createdAt:text('created_at').notNull()},t=>[check('receivable_amount_positive',sql`${t.amount}>0`),index('receivables_due_id').on(t.dueDate,t.id),index('receivables_created_id').on(t.createdAt,t.id)]);
export const receivableSettlements=pgTable('receivable_settlements',{id:text('id').primaryKey(),receivableId:text('receivable_id').notNull().references(()=>receivables.id),kind:text('kind').notNull(),amount:integer('amount').notNull(),effectiveDate:text('effective_date').notNull(),reference:text('reference').notNull(),reversesId:text('reverses_id').unique(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('settlement_kind_valid',sql`${t.kind} IN ('receipt','reversal')`),check('settlement_amount_positive',sql`${t.amount}>0`),index('settlements_receivable_idx').on(t.receivableId,t.createdAt,t.id)]);
export const payables=pgTable('payables',{id:text('id').primaryKey(),supplier:text('supplier').notNull(),sourceReference:text('source_reference').notNull(),description:text('description').notNull(),amount:integer('amount').notNull(),dueDate:text('due_date').notNull(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('payable_amount_positive',sql`${t.amount}>0`),index('payables_due_id').on(t.dueDate,t.id),index('payables_created_id').on(t.createdAt,t.id)]);
export const payablePayments=pgTable('payable_payments',{id:text('id').primaryKey(),payableId:text('payable_id').notNull().references(()=>payables.id),kind:text('kind').notNull(),amount:integer('amount').notNull(),effectiveDate:text('effective_date').notNull(),reference:text('reference').notNull(),reversesId:text('reverses_id').unique(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('payment_kind_valid',sql`${t.kind} IN ('payment','reversal')`),check('payment_amount_positive',sql`${t.amount}>0`),index('payable_payments_parent').on(t.payableId,t.createdAt,t.id)]);
export const bankStatements=pgTable('bank_statements',{id:text('id').primaryKey(),accountReference:text('account_reference').notNull(),sourceReference:text('source_reference').notNull(),periodStart:text('period_start').notNull(),periodEnd:text('period_end').notNull(),openingBalance:integer('opening_balance').notNull(),closingBalance:integer('closing_balance').notNull(),expectedCount:integer('expected_count').notNull(),status:text('status').notNull(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[uniqueIndex('bank_statement_account_source').on(t.accountReference,t.sourceReference)]);
export const bankStatementLines=pgTable('bank_statement_lines',{id:text('id').primaryKey(),statementId:text('statement_id').notNull().references(()=>bankStatements.id),externalKey:text('external_key').notNull(),bookedDate:text('booked_date').notNull(),description:text('description').notNull(),amount:integer('amount').notNull()},t=>[check('bank_line_nonzero',sql`${t.amount}<>0`),index('bank_lines_statement_date').on(t.statementId,t.bookedDate,t.id)]);
export const bankReconciliationEvents=pgTable('bank_reconciliation_events',{id:text('id').primaryKey(),lineId:text('line_id').notNull().references(()=>bankStatementLines.id),kind:text('kind').notNull(),receiptId:text('receipt_id').references(()=>receivableSettlements.id),paymentId:text('payment_id').references(()=>payablePayments.id),reversesId:text('reverses_id').unique(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('bank_event_kind',sql`${t.kind} IN ('match','unmatch')`),index('bank_events_line').on(t.lineId,t.createdAt,t.id)]);
export const chartAccounts=pgTable('chart_accounts',{id:text('id').primaryKey(),code:text('code').notNull().unique(),name:text('name').notNull(),type:text('type').notNull(),active:integer('active').notNull().default(1),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull()},t=>[check('chart_account_type',sql`${t.type} IN ('asset','liability','equity','revenue','expense')`)]);
export const journalEntries=pgTable('journal_entries',{id:text('id').primaryKey(),effectiveDate:text('effective_date').notNull(),sourceReference:text('source_reference').notNull(),description:text('description').notNull(),status:text('status').notNull().default('draft'),expectedCount:integer('expected_count').notNull(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull(),reversalOf:text('reversal_of').unique()},t=>[check('journal_status',sql`${t.status} IN ('draft','posted')`),index('journal_effective_id').on(t.effectiveDate,t.id)]);
export const journalLines=pgTable('journal_lines',{id:text('id').primaryKey(),entryId:text('entry_id').notNull().references(()=>journalEntries.id),accountId:text('account_id').notNull().references(()=>chartAccounts.id),debit:integer('debit').notNull().default(0),credit:integer('credit').notNull().default(0)},t=>[check('journal_one_side',sql`(${t.debit}>0 AND ${t.credit}=0) OR (${t.credit}>0 AND ${t.debit}=0)`),index('journal_lines_entry').on(t.entryId,t.id),index('journal_lines_account').on(t.accountId,t.entryId)]);
export const periodCloseRuns=pgTable('period_close_runs',{id:text('id').primaryKey(),periodStart:text('period_start').notNull(),periodEnd:text('period_end').notNull(),status:text('status').notNull(),observedAt:text('observed_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('close_run_blocked',sql`${t.status}='blocked'`),index('close_runs_period').on(t.periodEnd,t.id)]);
export const periodCloseCheckResults=pgTable('period_close_check_results',{id:text('id').primaryKey(),runId:text('run_id').notNull().references(()=>periodCloseRuns.id),checkKey:text('check_key').notNull(),status:text('status').notNull(),observedCount:integer('observed_count'),detail:text('detail').notNull()},t=>[check('close_check_status',sql`${t.status} IN ('passed','blocking','unavailable','advisory')`),index('close_checks_run').on(t.runId,t.checkKey)]);
export const savedViews=pgTable('saved_views',{id:text('id').primaryKey(),name:text('name').notNull(),query:text('query').notNull(),category:text('category').notNull(),view:text('view').notNull(),createdAt:text('created_at').notNull(),ownerId:text('owner_id'),definition:text('definition'),schemaVersion:integer('schema_version').notNull().default(1),rowVersion:integer('row_version').notNull().default(1),isDefault:integer('is_default').notNull().default(0),viewKey:text('view_key').notNull().default('serviceOrders.worklist')});

export const savedViewCommands=pgTable('saved_view_commands',{id:text('id').primaryKey(),viewId:text('view_id').notNull(),ownerId:text('owner_id').notNull(),command:text('command').notNull(),requestHash:text('request_hash').notNull(),result:text('result').notNull(),correlationId:text('correlation_id').notNull(),createdAt:text('created_at').notNull()});

export const clients=pgTable('clients',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),legalName:text('legal_name').notNull(),tradeName:text('trade_name'),document:text('document'),email:text('email'),phone:text('phone'),status:text('status').notNull().default('active'),rowVersion:integer('row_version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});
export const professionals=pgTable('professionals',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),name:text('name').notNull(),registration:text('registration').notNull(),specialty:text('specialty').notNull(),department:text('department').notNull(),phone:text('phone'),hourlyCost:integer('hourly_cost'),status:text('status').notNull().default('active'),rowVersion:integer('row_version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()},t=>[uniqueIndex('professionals_owner_registration').on(t.ownerId,t.registration),index('professionals_owner_status_name').on(t.ownerId,t.status,t.name,t.id)]);
export const assets=pgTable('assets',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),code:text('code').notNull(),name:text('name').notNull(),kind:text('kind').notNull(),location:text('location'),responsible:text('responsible'),hourlyCost:integer('hourly_cost'),status:text('status').notNull().default('active'),rowVersion:integer('row_version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()},t=>[uniqueIndex('assets_owner_code').on(t.ownerId,t.code),index('assets_owner_status_kind').on(t.ownerId,t.status,t.kind,t.name,t.id)]);
export const businessCommands=pgTable('business_commands',{id:text('id').primaryKey(),actorId:text('actor_id').notNull(),entityType:text('entity_type').notNull(),entityId:text('entity_id').notNull(),command:text('command').notNull(),requestHash:text('request_hash').notNull(),result:text('result').notNull(),correlationId:text('correlation_id').notNull(),createdAt:text('created_at').notNull()});
export const financeAuditEvents=pgTable('finance_audit_events',{id:text('id').primaryKey(),entityType:text('entity_type').notNull(),entityId:text('entity_id').notNull(),action:text('action').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull(),metadata:text('metadata').notNull(),occurredAt:text('occurred_at').notNull()},t=>[uniqueIndex('finance_audit_idempotency').on(t.entityType,t.entityId,t.action,t.requestHash),index('finance_audit_entity_time').on(t.entityType,t.entityId,t.occurredAt),index('finance_audit_actor_time').on(t.actorId,t.occurredAt)]);
export const cashTransfers=pgTable('cash_transfers',{id:text('id').primaryKey(),fromAccountReference:text('from_account_reference').notNull(),toAccountReference:text('to_account_reference').notNull(),amount:integer('amount').notNull(),effectiveDate:text('effective_date').notNull(),reference:text('reference').notNull(),status:text('status').notNull().default('posted'),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull(),createdAt:text('created_at').notNull()},t=>[check('cash_transfer_amount_positive',sql`${t.amount}>0`),check('cash_transfer_distinct_accounts',sql`${t.fromAccountReference}<>${t.toAccountReference}`),check('cash_transfer_status',sql`${t.status} IN ('posted','reversed')`),uniqueIndex('cash_transfer_actor_hash').on(t.actorId,t.requestHash),index('cash_transfer_actor_date').on(t.actorId,t.effectiveDate,t.id)]);
export const financePeriodCloses=pgTable('finance_period_closes',{id:text('id').primaryKey(),periodStart:text('period_start').notNull(),periodEnd:text('period_end').notNull(),status:text('status').notNull().default('closed'),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull(),closedAt:text('closed_at').notNull()},t=>[check('finance_period_close_status',sql`${t.status}='closed'`),check('finance_period_close_range',sql`${t.periodStart}<=${t.periodEnd}`),uniqueIndex('finance_period_close_actor_hash').on(t.actorId,t.requestHash),index('finance_period_close_actor_range').on(t.actorId,t.periodStart,t.periodEnd)]);
export const workflowApprovalRequests=pgTable('workflow_approval_requests',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),entityType:text('entity_type').notNull(),entityId:text('entity_id').notNull(),command:text('command').notNull(),state:text('state').notNull().default('pending'),requestedBy:text('requested_by').notNull(),approverId:text('approver_id').notNull(),expectedVersion:integer('expected_version').notNull(),rowVersion:integer('row_version').notNull().default(1),payload:text('payload').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull(),createdAt:text('created_at').notNull(),decidedAt:text('decided_at')},t=>[check('workflow_approval_entity',sql`${t.entityType} IN ('finance_period_close','service_order','measurement')`),check('workflow_approval_command',sql`${t.command} IN ('close','authorize','approve_measurement')`),check('workflow_approval_state',sql`${t.state} IN ('pending','approved','rejected')`),check('workflow_approval_version',sql`${t.rowVersion}>0`),index('workflow_approval_inbox').on(t.approverId,t.state,t.createdAt)]);
export const workflowApprovalEvents=pgTable('workflow_approval_events',{id:text('id').primaryKey(),requestId:text('request_id').notNull().references(()=>workflowApprovalRequests.id),eventType:text('event_type').notNull(),actorId:text('actor_id').notNull(),fromState:text('from_state'),toState:text('to_state').notNull(),version:integer('version').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull(),metadata:text('metadata').notNull(),createdAt:text('created_at').notNull()},t=>[index('workflow_approval_events_history').on(t.requestId,t.createdAt,t.id),uniqueIndex('workflow_approval_event_idempotency').on(t.requestId,t.requestHash)]);

export const proposals=pgTable('proposals',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),clientId:text('client_id').notNull().references(()=>clients.id),predecessorId:text('predecessor_id'),title:text('title').notNull(),scope:text('scope').notNull(),validUntil:text('valid_until').notNull(),status:text('status').notNull().default('draft'),rowVersion:integer('row_version').notNull().default(1),total:integer('total').notNull(),evidenceReference:text('evidence_reference'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});
export const proposalLines=pgTable('proposal_lines',{id:text('id').primaryKey(),proposalId:text('proposal_id').notNull().references(()=>proposals.id),position:integer('position').notNull(),description:text('description').notNull(),unit:text('unit').notNull(),quantity:integer('quantity').notNull(),unitPrice:integer('unit_price').notNull(),amount:integer('amount').notNull()});
export const purchaseOrders=pgTable('purchase_orders',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),clientId:text('client_id').notNull().references(()=>clients.id),proposalId:text('proposal_id').notNull().references(()=>proposals.id),reference:text('reference').notNull(),receivedDate:text('received_date').notNull(),status:text('status').notNull().default('registered'),rowVersion:integer('row_version').notNull().default(1),cancelReason:text('cancel_reason'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});

export const contracts=pgTable('contracts',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),clientId:text('client_id').notNull().references(()=>clients.id),proposalId:text('proposal_id').notNull().references(()=>proposals.id),purchaseOrderId:text('purchase_order_id').references(()=>purchaseOrders.id),reference:text('reference').notNull(),scope:text('scope').notNull(),startsOn:text('starts_on').notNull(),endsOn:text('ends_on'),status:text('status').notNull().default('draft'),rowVersion:integer('row_version').notNull().default(1),signedReference:text('signed_reference'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});

export const executionEntries=pgTable('execution_entries',{id:text('id').primaryKey().references(()=>events.id),orderId:text('order_id').notNull().references(()=>orders.id),kind:text('kind').notNull(),resourceKind:text('resource_kind').notNull(),description:text('description').notNull(),quantity:integer('quantity').notNull(),unit:text('unit').notNull(),resourceReference:text('resource_reference'),effectiveDate:text('effective_date').notNull(),reference:text('reference').notNull(),reversesId:text('reverses_id').unique(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull()});
export const fieldMeasurementEvents=pgTable('field_measurement_events',{id:text('id').primaryKey(),measurementId:text('measurement_id').notNull().references(()=>measurements.id),orderId:text('order_id').notNull().references(()=>orders.id),command:text('command').notNull(),version:integer('version').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),result:text('result').notNull(),correlationId:text('correlation_id').notNull(),createdAt:text('created_at').notNull()},t=>[uniqueIndex('field_measurement_events_idempotency').on(t.measurementId,t.requestHash),index('field_measurement_events_order_time').on(t.orderId,t.createdAt,t.id)]);

export const inventoryItems = pgTable('inventory_items', {
 id: text('id').primaryKey(),
 ownerId: text('owner_id').notNull(),
 sku: text('sku').notNull(),
 name: text('name').notNull(),
 unit: text('unit').notNull(),
 minimum: integer('minimum').notNull(),
 createdAt: text('created_at').notNull(),
 requestHash: text('request_hash').notNull(),
}, t => [
 uniqueIndex('inventory_owner_sku').on(t.ownerId, t.sku),
 check('inventory_minimum', sql`${t.minimum} BETWEEN 0 AND 1000000000000`),
]);

export const inventoryMovements = pgTable('inventory_movements', {
 id: text('id').primaryKey(),
 itemId: text('item_id').notNull().references(() => inventoryItems.id),
 ownerId: text('owner_id').notNull(),
 orderId: text('order_id').references(() => orders.id),
 procurementOrderId: text('procurement_order_id'),
 procurementReceiptLineId: text('procurement_receipt_line_id'),
 delta: integer('delta').notNull(),
 reference: text('reference').notNull(),
 createdAt: text('created_at').notNull(),
 requestHash: text('request_hash').notNull(),
 correlationId: text('correlation_id').notNull(),
}, t => [
 index('inventory_movement_item').on(t.itemId, t.createdAt, t.id),
 check('inventory_delta', sql`abs(${t.delta}) BETWEEN 1 AND 1000000000000`),
]);

export const inventoryReservations = pgTable('inventory_reservations', {
 id: text('id').primaryKey(),
 itemId: text('item_id').notNull().references(() => inventoryItems.id),
 ownerId: text('owner_id').notNull(),
 sourceDocumentType: text('source_document_type').notNull(),
 sourceDocumentId: text('source_document_id').notNull(),
 sourceReference: text('source_reference').notNull(),
 quantity: integer('quantity').notNull(),
 consumedQuantity: integer('consumed_quantity').notNull().default(0),
 status: text('status').notNull().default('reserved'),
 createdAt: text('created_at').notNull(),
 requestHash: text('request_hash').notNull(),
 correlationId: text('correlation_id').notNull(),
}, t => [
  uniqueIndex('inventory_reservation_owner_source_item').on(t.ownerId, t.sourceDocumentType, t.sourceDocumentId, t.itemId),
  index('inventory_reservation_item_status').on(t.itemId, t.ownerId, t.status, t.createdAt),
  check('inventory_reservation_quantity', sql`${t.quantity} BETWEEN 1 AND 1000000000000`),
  check('inventory_reservation_consumed_quantity', sql`${t.consumedQuantity} BETWEEN 0 AND ${t.quantity}`),
  check('inventory_reservation_status', sql`${t.status} IN ('reserved','released','consumed')`),
 ]);

export const inventoryConsumptionEvents = pgTable('inventory_consumption_events', {
 id: text('id').primaryKey(),
 movementId: text('movement_id').notNull().unique().references(() => inventoryMovements.id),
 reservationId: text('reservation_id').notNull().references(() => inventoryReservations.id),
 itemId: text('item_id').notNull().references(() => inventoryItems.id),
 orderId: text('order_id').notNull().references(() => orders.id),
 ownerId: text('owner_id').notNull(),
 quantity: integer('quantity').notNull(),
 actorId: text('actor_id').notNull(),
 reference: text('reference').notNull(),
 requestHash: text('request_hash').notNull(),
 correlationId: text('correlation_id').notNull(),
 createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('inventory_consumption_owner_hash').on(t.ownerId, t.requestHash),
  index('inventory_consumption_order_time').on(t.ownerId, t.orderId, t.createdAt, t.id),
  check('inventory_consumption_quantity', sql`${t.quantity} BETWEEN 1 AND 1000000000000`),
 ]);

export const suppliers = pgTable('suppliers', {
 id: text('id').primaryKey(),
 ownerId: text('owner_id').notNull(),
 legalName: text('legal_name').notNull(),
 document: text('document').notNull(),
 email: text('email'),
 status: text('status').notNull().default('active'),
 rowVersion: integer('row_version').notNull().default(1),
 createdAt: text('created_at').notNull(),
 updatedAt: text('updated_at').notNull(),
 requestHash: text('request_hash').notNull(),
}, t => [
 uniqueIndex('suppliers_owner_document').on(t.ownerId, t.document),
 check('supplier_status', sql`${t.status} IN ('active','inactive')`),
 check('supplier_version', sql`${t.rowVersion}>0`),
]);

export const supplierPurchaseOrders = pgTable('supplier_purchase_orders', {
 id: text('id').primaryKey(),
 ownerId: text('owner_id').notNull(),
 supplierId: text('supplier_id').notNull().references(() => suppliers.id),
 itemId: text('item_id').notNull().references(() => inventoryItems.id),
 reference: text('reference').notNull(),
 quantity: integer('quantity').notNull(),
 unitPrice: integer('unit_price').notNull(),
 total: integer('total').notNull(),
 expectedOn: text('expected_on').notNull(),
 status: text('status').notNull().default('draft'),
 rowVersion: integer('row_version').notNull().default(1),
 receivedAt: text('received_at'),
 createdAt: text('created_at').notNull(),
 updatedAt: text('updated_at').notNull(),
 requestHash: text('request_hash').notNull(),
 currency: text('currency').notNull().default('BRL'),
 freight: integer('freight').notNull().default(0),
 additionalCosts: integer('additional_costs').notNull().default(0),
}, t => [
 uniqueIndex('supplier_po_owner_reference').on(t.ownerId, t.reference),
 index('supplier_po_supplier').on(t.supplierId, t.createdAt),
 index('supplier_po_status').on(t.ownerId, t.status, t.expectedOn),
 check('supplier_po_quantity', sql`${t.quantity}>0`),
 check('supplier_po_unit_price', sql`${t.unitPrice}>0`),
 check('supplier_po_total', sql`${t.total}>0`),
 check('supplier_po_status_valid', sql`${t.status} IN ('draft','approved','received','cancelled')`),
 check('supplier_po_version', sql`${t.rowVersion}>0`),
]);

export const supplierPurchaseOrderLines=pgTable('supplier_purchase_order_lines',{id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>supplierPurchaseOrders.id),ownerId:text('owner_id').notNull(),itemId:text('item_id').notNull().references(()=>inventoryItems.id),position:integer('position').notNull(),quantity:integer('quantity').notNull(),unitPrice:integer('unit_price').notNull(),discount:integer('discount').notNull().default(0),tax:integer('tax').notNull().default(0),subtotal:integer('subtotal').notNull(),createdAt:text('created_at').notNull()},t=>[uniqueIndex('supplier_po_line_position').on(t.orderId,t.position),index('supplier_po_line_item').on(t.itemId,t.orderId)]);
export const procurementReceipts=pgTable('procurement_receipts',{id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>supplierPurchaseOrders.id),ownerId:text('owner_id').notNull(),reference:text('reference').notNull(),createdAt:text('created_at').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[index('procurement_receipt_order').on(t.orderId,t.createdAt,t.id)]);
export const procurementReceiptLines=pgTable('procurement_receipt_lines',{id:text('id').primaryKey(),receiptId:text('receipt_id').notNull().references(()=>procurementReceipts.id),orderLineId:text('order_line_id').notNull().references(()=>supplierPurchaseOrderLines.id),itemId:text('item_id').notNull().references(()=>inventoryItems.id),acceptedQuantity:integer('accepted_quantity').notNull(),rejectedQuantity:integer('rejected_quantity').notNull().default(0),createdAt:text('created_at').notNull()},t=>[uniqueIndex('procurement_receipt_line_once').on(t.receiptId,t.orderLineId)]);

export const procurementCommands = pgTable('procurement_commands', {
 id: text('id').primaryKey(),
 actorId: text('actor_id').notNull(),
 entityType: text('entity_type').notNull(),
 entityId: text('entity_id').notNull(),
 command: text('command').notNull(),
 requestHash: text('request_hash').notNull(),
 result: text('result').notNull(),
 correlationId: text('correlation_id').notNull(),
 createdAt: text('created_at').notNull(),
}, t => [check('procurement_command_type', sql`${t.entityType} IN ('supplier','supplierPurchaseOrder')`)]);

export const mrpRuns=pgTable('mrp_runs',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),actorId:text('actor_id').notNull(),horizonDays:integer('horizon_days').notNull().default(30),status:text('status').notNull().default('completed'),evaluatedMaterials:integer('evaluated_materials').notNull().default(0),shortages:integer('shortages').notNull().default(0),recommendations:integer('recommendations').notNull().default(0),startedAt:text('started_at').notNull(),completedAt:text('completed_at'),error:text('error')},t=>[index('mrp_runs_owner_started').on(t.ownerId,t.startedAt)]);
export const mrpRecommendations=pgTable('mrp_recommendations',{id:text('id').primaryKey(),runId:text('run_id').notNull().references(()=>mrpRuns.id),ownerId:text('owner_id').notNull(),materialId:text('material_id').notNull().references(()=>inventoryItems.id),available:integer('available').notNull(),minimum:integer('minimum').notNull(),netRequirement:integer('net_requirement').notNull(),unit:text('unit').notNull(),status:text('status').notNull().default('draft'),purchaseOrderId:text('purchase_order_id'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),rowVersion:integer('row_version').notNull().default(1)},t=>[uniqueIndex('mrp_recommendation_run_material').on(t.runId,t.materialId),index('mrp_recommendations_owner_status').on(t.ownerId,t.status)]);

export const mrpEvents=pgTable('mrp_events',{
 id:text('id').primaryKey(),
 recommendationId:text('recommendation_id').notNull().references(()=>mrpRecommendations.id),
 ownerId:text('owner_id').notNull(),
 actorId:text('actor_id').notNull(),
 command:text('command').notNull(),
 fromStatus:text('from_status').notNull(),
 toStatus:text('to_status').notNull(),
 purchaseOrderId:text('purchase_order_id'),
 correlationId:text('correlation_id').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[
 index('mrp_events_recommendation_time').on(t.recommendationId,t.createdAt),
 index('mrp_events_owner_time').on(t.ownerId,t.createdAt),
 check('mrp_events_command_valid',sql`${t.command} IN ('approve','reject','convert')`),
 check('mrp_events_from_valid',sql`${t.fromStatus} IN ('draft','approved')`),
 check('mrp_events_to_valid',sql`${t.toStatus} IN ('approved','rejected','converted')`),
]);


// Native CISNE CRM. The immutable SQL migration is drizzle-pg/0001_native_crm.sql.
export const crmLeads = pgTable('crm_leads', {
 id: text('id').primaryKey(),
 ownerId: text('owner_id').notNull(),
 contactName: text('contact_name').notNull(),
 companyName: text('company_name').notNull(),
 contactEmail: text('contact_email'),
 source: text('source').notNull().default('manual'),
 status: text('status').notNull().default('new'),
 clientId: text('client_id'),
 rowVersion: integer('row_version').notNull().default(1),
 createdAt: text('created_at').notNull(),
 updatedAt: text('updated_at').notNull(),
},t=>[
 check('crm_leads_status_ck',sql`${t.status} IN ('new','qualified','disqualified')`),
 check('crm_leads_version_ck',sql`${t.rowVersion}>0`),
 uniqueIndex('crm_leads_owner_id_unique').on(t.ownerId,t.id),
 foreignKey({columns:[t.ownerId,t.clientId],foreignColumns:[clients.ownerId,clients.id],name:'crm_leads_client_owner_fk'}),
 index('crm_leads_owner_status_created').on(t.ownerId,t.status,t.createdAt,t.id),
]);
export const crmOpportunities=pgTable('crm_opportunities',{
 id: text('id').primaryKey(),
 ownerId:text('owner_id').notNull(),
 leadId:text('lead_id').notNull(),
 clientId:text('client_id'),
 title:text('title').notNull(),
 amountCents:bigint('amount_cents',{mode:'number'}).notNull().default(0),
 stage:text('stage').notNull().default('discovery'),
 rowVersion:integer('row_version').notNull().default(1),
 createdAt:text('created_at').notNull(),
 updatedAt:text('updated_at').notNull(),
},t=>[
 check('crm_opportunities_stage_ck',sql`${t.stage} IN ('discovery','proposal','negotiation','won','lost')`),
 check('crm_opportunities_amount_ck',sql`${t.amountCents} BETWEEN 0 AND 100000000000000`),
 check('crm_opportunities_version_ck',sql`${t.rowVersion}>0`),
 foreignKey({columns:[t.ownerId,t.leadId],foreignColumns:[crmLeads.ownerId,crmLeads.id],name:'crm_opportunities_lead_owner_fk'}),
 foreignKey({columns:[t.ownerId,t.clientId],foreignColumns:[clients.ownerId,clients.id],name:'crm_opportunities_client_owner_fk'}),
 uniqueIndex('crm_opportunities_owner_id_unique').on(t.ownerId,t.id),
 index('crm_opportunities_owner_stage_created').on(t.ownerId,t.stage,t.createdAt,t.id),
]);
export const crmCommands=pgTable('crm_commands',{
 id:text('id').primaryKey(),
 actorId:text('actor_id').notNull(),
 requestHash:text('request_hash').notNull(),
 action:text('action').notNull(),
 resourceId:text('resource_id').notNull().default(''),
 result:text('result').notNull().default(''),
 correlationId:text('correlation_id').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[index('crm_commands_actor_created').on(t.actorId,t.createdAt)]);

export const crmOpportunityProposals=pgTable('crm_opportunity_proposals',{
 ownerId:text('owner_id').notNull(),
 opportunityId:text('opportunity_id').notNull(),
 proposalId:text('proposal_id').notNull(),
 commandKey:text('command_key').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[
 // PostgreSQL migration 0002 defines (owner_id, opportunity_id) PK.
 uniqueIndex('crm_opportunity_proposals_owner_opportunity_unique').on(t.ownerId,t.opportunityId),
 uniqueIndex('crm_opportunity_proposals_proposal_unique').on(t.proposalId),
 uniqueIndex('crm_opportunity_proposals_command_unique').on(t.commandKey),
 foreignKey({columns:[t.ownerId,t.opportunityId],foreignColumns:[crmOpportunities.ownerId,crmOpportunities.id],name:'crm_opportunity_proposals_owner_opportunity_fk'}),
 foreignKey({columns:[t.ownerId,t.proposalId],foreignColumns:[proposals.ownerId,proposals.id],name:'crm_opportunity_proposals_owner_proposal_fk'}),
 index('crm_opportunity_proposals_owner_proposal').on(t.ownerId,t.proposalId),
]);


// Additive enterprise foundation. Existing owner-scoped records are not rewritten.
export const enterpriseTenants = pgTable('enterprise_tenants', {
  id:text('id').primaryKey(),
  slug:text('slug').notNull().unique(),
  name:text('name').notNull(),
  status:text('status').notNull().default('active'),
  createdBy:text('created_by').notNull(),
  createdAt:text('created_at').notNull(),
  rowVersion:integer('row_version').notNull().default(1),
});
export const enterpriseMemberships = pgTable('enterprise_tenant_memberships', {
  tenantId:text('tenant_id').notNull().references(()=>enterpriseTenants.id),
  actorId:text('actor_id').notNull(),
  role:text('role').notNull(),
  status:text('status').notNull().default('active'),
  createdAt:text('created_at').notNull(),
},t=>[
  primaryKey({columns:[t.tenantId,t.actorId]}),
  index('enterprise_member_actor_idx').on(t.actorId,t.tenantId),
]);
export const enterpriseLegalEntities = pgTable('enterprise_legal_entities', {
  id:text('id').primaryKey(),
  tenantId:text('tenant_id').notNull().references(()=>enterpriseTenants.id),
  code:text('code').notNull(),
  name:text('name').notNull(),
  taxId:text('tax_id'),
  status:text('status').notNull().default('active'),
  createdBy:text('created_by').notNull(),
  createdAt:text('created_at').notNull(),
},t=>[
  uniqueIndex('enterprise_entity_tenant_code_uq').on(t.tenantId,t.code),
  uniqueIndex('enterprise_entity_tenant_id_uq').on(t.tenantId,t.id),
]);
export const enterprisePermissionEvents = pgTable('enterprise_permission_events', {
  id:text('id').primaryKey(),
  tenantId:text('tenant_id').notNull().references(()=>enterpriseTenants.id),
  actorId:text('actor_id').notNull(),
  action:text('action').notNull(),
  resourceId:text('resource_id').notNull(),
  correlationId:text('correlation_id').notNull(),
  createdAt:text('created_at').notNull(),
},t=>[index('enterprise_permission_events_tenant_created_idx').on(t.tenantId,t.createdAt,t.id)]);


/** Audited manual verification links; not automatic accounting posting. */
export const accountingInvoiceLinks=pgTable('accounting_invoice_links',{
 id:text('id').primaryKey(),
 actorId:text('actor_id').notNull(),
 invoiceId:text('invoice_id').notNull().unique().references(()=>invoices.id),
 journalId:text('journal_id').notNull().unique().references(()=>journalEntries.id),
 amount:integer('amount').notNull(),
 requestHash:text('request_hash').notNull(),
 correlationId:text('correlation_id').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[index('accounting_invoice_link_owner_idx').on(t.actorId,t.invoiceId)]);
