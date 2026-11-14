import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer,check,index,uniqueIndex } from 'drizzle-orm/sqlite-core';
export const orders = sqliteTable('service_orders', {
 contractId:text('contract_id'),clientId:text('client_id'),ownerId:text('owner_id'),id: text('id').primaryKey(), title: text('title').notNull(), client: text('client').notNull(),
 category: text('category').notNull(), description: text('description').notNull(),
 dueDate: text('due_date'), createdAt: text('created_at').notNull(),
 status: text('status').notNull().default('draft'), version:integer('version').notNull().default(1),
},t=>[check('order_status_valid',sql`${t.status} IN ('draft','authorized','executing','completed','cancelled')`),check('order_version_valid',sql`${t.version}>0`),index('orders_created_idx').on(t.createdAt),index('orders_status_idx').on(t.status)]);
export const events=sqliteTable('order_events',{id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>orders.id),command:text('command').notNull(),version:integer('version').notNull(),createdAt:text('created_at').notNull(),actorId:text('actor_id'),requestHash:text('request_hash'),targetId:text('target_id'),result:text('result'),correlationId:text('correlation_id')});
export const measurements=sqliteTable('measurements',{id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>orders.id),description:text('description').notNull(),amount:integer('amount').notNull(),status:text('status').notNull().default('draft'),version:integer('version').notNull().default(1),createdAt:text('created_at').notNull()},t=>[check('measurement_amount_positive',sql`${t.amount}>0 AND typeof(${t.amount})='integer'`),check('measurement_status_valid',sql`${t.status} IN ('draft','approved','billed')`),check('measurement_version_valid',sql`${t.version}>0`),index('measurements_order_idx').on(t.orderId)]);
export const invoices=sqliteTable('invoices',{id:text('id').primaryKey(),measurementId:text('measurement_id').notNull().unique().references(()=>measurements.id),orderId:text('order_id').notNull().references(()=>orders.id),amount:integer('amount').notNull(),dueDate:text('due_date').notNull(),createdAt:text('created_at').notNull()},t=>[check('invoice_amount_positive',sql`${t.amount}>0 AND typeof(${t.amount})='integer'`)]);
export const receivables=sqliteTable('receivables',{id:text('id').primaryKey(),invoiceId:text('invoice_id').notNull().unique().references(()=>invoices.id),amount:integer('amount').notNull(),dueDate:text('due_date').notNull(),createdAt:text('created_at').notNull()},t=>[check('receivable_amount_positive',sql`${t.amount}>0 AND typeof(${t.amount})='integer'`),index('receivables_due_id').on(t.dueDate,t.id),index('receivables_created_id').on(t.createdAt,t.id)]);
export const receivableSettlements=sqliteTable('receivable_settlements',{id:text('id').primaryKey(),receivableId:text('receivable_id').notNull().references(()=>receivables.id),kind:text('kind').notNull(),amount:integer('amount').notNull(),effectiveDate:text('effective_date').notNull(),reference:text('reference').notNull(),reversesId:text('reverses_id').unique(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('settlement_kind_valid',sql`${t.kind} IN ('receipt','reversal')`),check('settlement_amount_positive',sql`${t.amount}>0 AND typeof(${t.amount})='integer'`),index('settlements_receivable_idx').on(t.receivableId,t.createdAt,t.id)]);
export const payables=sqliteTable('payables',{id:text('id').primaryKey(),supplier:text('supplier').notNull(),sourceReference:text('source_reference').notNull(),description:text('description').notNull(),amount:integer('amount').notNull(),dueDate:text('due_date').notNull(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('payable_amount_positive',sql`${t.amount}>0 AND typeof(${t.amount})='integer'`),index('payables_due_id').on(t.dueDate,t.id),index('payables_created_id').on(t.createdAt,t.id)]);
export const payablePayments=sqliteTable('payable_payments',{id:text('id').primaryKey(),payableId:text('payable_id').notNull().references(()=>payables.id),kind:text('kind').notNull(),amount:integer('amount').notNull(),effectiveDate:text('effective_date').notNull(),reference:text('reference').notNull(),reversesId:text('reverses_id').unique(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('payment_kind_valid',sql`${t.kind} IN ('payment','reversal')`),check('payment_amount_positive',sql`${t.amount}>0 AND typeof(${t.amount})='integer'`),index('payable_payments_parent').on(t.payableId,t.createdAt,t.id)]);
export const bankStatements=sqliteTable('bank_statements',{id:text('id').primaryKey(),accountReference:text('account_reference').notNull(),sourceReference:text('source_reference').notNull(),periodStart:text('period_start').notNull(),periodEnd:text('period_end').notNull(),openingBalance:integer('opening_balance').notNull(),closingBalance:integer('closing_balance').notNull(),expectedCount:integer('expected_count').notNull(),status:text('status').notNull(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[uniqueIndex('bank_statement_account_source').on(t.accountReference,t.sourceReference)]);
export const bankStatementLines=sqliteTable('bank_statement_lines',{id:text('id').primaryKey(),statementId:text('statement_id').notNull().references(()=>bankStatements.id),externalKey:text('external_key').notNull(),bookedDate:text('booked_date').notNull(),description:text('description').notNull(),amount:integer('amount').notNull()},t=>[check('bank_line_nonzero',sql`${t.amount}<>0 AND typeof(${t.amount})='integer'`),index('bank_lines_statement_date').on(t.statementId,t.bookedDate,t.id)]);
export const bankReconciliationEvents=sqliteTable('bank_reconciliation_events',{id:text('id').primaryKey(),lineId:text('line_id').notNull().references(()=>bankStatementLines.id),kind:text('kind').notNull(),receiptId:text('receipt_id').references(()=>receivableSettlements.id),paymentId:text('payment_id').references(()=>payablePayments.id),reversesId:text('reverses_id').unique(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('bank_event_kind',sql`${t.kind} IN ('match','unmatch')`),index('bank_events_line').on(t.lineId,t.createdAt,t.id)]);
export const chartAccounts=sqliteTable('chart_accounts',{id:text('id').primaryKey(),code:text('code').notNull().unique(),name:text('name').notNull(),type:text('type').notNull(),active:integer('active').notNull().default(1),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull()},t=>[check('chart_account_type',sql`${t.type} IN ('asset','liability','equity','revenue','expense')`)]);
export const journalEntries=sqliteTable('journal_entries',{id:text('id').primaryKey(),effectiveDate:text('effective_date').notNull(),sourceReference:text('source_reference').notNull(),description:text('description').notNull(),status:text('status').notNull().default('draft'),expectedCount:integer('expected_count').notNull(),createdAt:text('created_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull(),reversalOf:text('reversal_of').unique()},t=>[check('journal_status',sql`${t.status} IN ('draft','posted')`),index('journal_effective_id').on(t.effectiveDate,t.id)]);
export const journalLines=sqliteTable('journal_lines',{id:text('id').primaryKey(),entryId:text('entry_id').notNull().references(()=>journalEntries.id),accountId:text('account_id').notNull().references(()=>chartAccounts.id),debit:integer('debit').notNull().default(0),credit:integer('credit').notNull().default(0)},t=>[check('journal_one_side',sql`(${t.debit}>0 AND ${t.credit}=0) OR (${t.credit}>0 AND ${t.debit}=0)`),index('journal_lines_entry').on(t.entryId,t.id),index('journal_lines_account').on(t.accountId,t.entryId)]);
export const periodCloseRuns=sqliteTable('period_close_runs',{id:text('id').primaryKey(),periodStart:text('period_start').notNull(),periodEnd:text('period_end').notNull(),status:text('status').notNull(),observedAt:text('observed_at').notNull(),actorId:text('actor_id').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[check('close_run_blocked',sql`${t.status}='blocked'`),index('close_runs_period').on(t.periodEnd,t.id)]);
export const periodCloseCheckResults=sqliteTable('period_close_check_results',{id:text('id').primaryKey(),runId:text('run_id').notNull().references(()=>periodCloseRuns.id),checkKey:text('check_key').notNull(),status:text('status').notNull(),observedCount:integer('observed_count'),detail:text('detail').notNull()},t=>[check('close_check_status',sql`${t.status} IN ('passed','blocking','unavailable','advisory')`),index('close_checks_run').on(t.runId,t.checkKey)]);
export const savedViews=sqliteTable('saved_views',{id:text('id').primaryKey(),name:text('name').notNull(),query:text('query').notNull(),category:text('category').notNull(),view:text('view').notNull(),createdAt:text('created_at').notNull(),ownerId:text('owner_id'),definition:text('definition'),schemaVersion:integer('schema_version').notNull().default(1),rowVersion:integer('row_version').notNull().default(1),isDefault:integer('is_default').notNull().default(0),viewKey:text('view_key').notNull().default('serviceOrders.worklist')});

export const savedViewCommands=sqliteTable('saved_view_commands',{id:text('id').primaryKey(),viewId:text('view_id').notNull(),ownerId:text('owner_id').notNull(),command:text('command').notNull(),requestHash:text('request_hash').notNull(),result:text('result').notNull(),correlationId:text('correlation_id').notNull(),createdAt:text('created_at').notNull()});

export const clients=sqliteTable('clients',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),legalName:text('legal_name').notNull(),tradeName:text('trade_name'),document:text('document'),email:text('email'),phone:text('phone'),status:text('status').notNull().default('active'),rowVersion:integer('row_version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});
export const businessCommands=sqliteTable('business_commands',{id:text('id').primaryKey(),actorId:text('actor_id').notNull(),entityType:text('entity_type').notNull(),entityId:text('entity_id').notNull(),command:text('command').notNull(),requestHash:text('request_hash').notNull(),result:text('result').notNull(),correlationId:text('correlation_id').notNull(),createdAt:text('created_at').notNull()});

export const proposals=sqliteTable('proposals',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),clientId:text('client_id').notNull().references(()=>clients.id),predecessorId:text('predecessor_id'),title:text('title').notNull(),scope:text('scope').notNull(),validUntil:text('valid_until').notNull(),status:text('status').notNull().default('draft'),rowVersion:integer('row_version').notNull().default(1),total:integer('total').notNull(),evidenceReference:text('evidence_reference'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});
export const proposalLines=sqliteTable('proposal_lines',{id:text('id').primaryKey(),proposalId:text('proposal_id').notNull().references(()=>proposals.id),position:integer('position').notNull(),description:text('description').notNull(),unit:text('unit').notNull(),quantity:integer('quantity').notNull(),unitPrice:integer('unit_price').notNull(),amount:integer('amount').notNull()});
export const purchaseOrders=sqliteTable('purchase_orders',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),clientId:text('client_id').notNull().references(()=>clients.id),proposalId:text('proposal_id').notNull().references(()=>proposals.id),reference:text('reference').notNull(),receivedDate:text('received_date').notNull(),status:text('status').notNull().default('registered'),rowVersion:integer('row_version').notNull().default(1),cancelReason:text('cancel_reason'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});

export const contracts=sqliteTable('contracts',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),clientId:text('client_id').notNull().references(()=>clients.id),proposalId:text('proposal_id').notNull().references(()=>proposals.id),purchaseOrderId:text('purchase_order_id').references(()=>purchaseOrders.id),reference:text('reference').notNull(),scope:text('scope').notNull(),startsOn:text('starts_on').notNull(),endsOn:text('ends_on'),status:text('status').notNull().default('draft'),rowVersion:integer('row_version').notNull().default(1),signedReference:text('signed_reference'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});

export const executionEntries=sqliteTable('execution_entries',{id:text('id').primaryKey().references(()=>events.id),orderId:text('order_id').notNull().references(()=>orders.id),kind:text('kind').notNull(),resourceKind:text('resource_kind').notNull(),description:text('description').notNull(),quantity:integer('quantity').notNull(),unit:text('unit').notNull(),resourceReference:text('resource_reference'),effectiveDate:text('effective_date').notNull(),reference:text('reference').notNull(),reversesId:text('reverses_id').unique(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull()});

export const inventoryItems = sqliteTable('inventory_items', {
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
 check('inventory_minimum', sql`typeof(${t.minimum}) = 'integer' AND ${t.minimum} BETWEEN 0 AND 1000000000000`),
]);

export const inventoryMovements = sqliteTable('inventory_movements', {
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
 check('inventory_delta', sql`typeof(${t.delta}) = 'integer' AND abs(${t.delta}) BETWEEN 1 AND 1000000000000`),
]);

export const suppliers = sqliteTable('suppliers', {
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

export const supplierPurchaseOrders = sqliteTable('supplier_purchase_orders', {
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
 check('supplier_po_quantity', sql`typeof(${t.quantity})='integer' AND ${t.quantity}>0`),
 check('supplier_po_unit_price', sql`typeof(${t.unitPrice})='integer' AND ${t.unitPrice}>0`),
 check('supplier_po_total', sql`typeof(${t.total})='integer' AND ${t.total}>0`),
 check('supplier_po_status_valid', sql`${t.status} IN ('draft','approved','received','cancelled')`),
 check('supplier_po_version', sql`${t.rowVersion}>0`),
]);

export const supplierPurchaseOrderLines=sqliteTable('supplier_purchase_order_lines',{id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>supplierPurchaseOrders.id),ownerId:text('owner_id').notNull(),itemId:text('item_id').notNull().references(()=>inventoryItems.id),position:integer('position').notNull(),quantity:integer('quantity').notNull(),unitPrice:integer('unit_price').notNull(),discount:integer('discount').notNull().default(0),tax:integer('tax').notNull().default(0),subtotal:integer('subtotal').notNull(),createdAt:text('created_at').notNull()},t=>[uniqueIndex('supplier_po_line_position').on(t.orderId,t.position),index('supplier_po_line_item').on(t.itemId,t.orderId)]);
export const procurementReceipts=sqliteTable('procurement_receipts',{id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>supplierPurchaseOrders.id),ownerId:text('owner_id').notNull(),reference:text('reference').notNull(),createdAt:text('created_at').notNull(),requestHash:text('request_hash').notNull(),correlationId:text('correlation_id').notNull()},t=>[index('procurement_receipt_order').on(t.orderId,t.createdAt,t.id)]);
export const procurementReceiptLines=sqliteTable('procurement_receipt_lines',{id:text('id').primaryKey(),receiptId:text('receipt_id').notNull().references(()=>procurementReceipts.id),orderLineId:text('order_line_id').notNull().references(()=>supplierPurchaseOrderLines.id),itemId:text('item_id').notNull().references(()=>inventoryItems.id),acceptedQuantity:integer('accepted_quantity').notNull(),rejectedQuantity:integer('rejected_quantity').notNull().default(0),createdAt:text('created_at').notNull()},t=>[uniqueIndex('procurement_receipt_line_once').on(t.receiptId,t.orderLineId)]);

export const procurementCommands = sqliteTable('procurement_commands', {
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
