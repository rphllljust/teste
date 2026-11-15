CREATE TABLE "bank_reconciliation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"kind" text NOT NULL,
	"receipt_id" text,
	"payment_id" text,
	"reverses_id" text,
	"created_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "bank_reconciliation_events_reverses_id_unique" UNIQUE("reverses_id"),
	CONSTRAINT "bank_event_kind" CHECK ("bank_reconciliation_events"."kind" IN ('match','unmatch'))
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"external_key" text NOT NULL,
	"booked_date" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "bank_line_nonzero" CHECK ("bank_statement_lines"."amount"<>0)
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"account_reference" text NOT NULL,
	"source_reference" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"opening_balance" integer NOT NULL,
	"closing_balance" integer NOT NULL,
	"expected_count" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"command" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	CONSTRAINT "chart_accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "chart_account_type" CHECK ("chart_accounts"."type" IN ('asset','liability','equity','revenue','expense'))
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"document" text,
	"email" text,
	"phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"client_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"purchase_order_id" text,
	"reference" text NOT NULL,
	"scope" text NOT NULL,
	"starts_on" text NOT NULL,
	"ends_on" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"signed_reference" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"command" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" text NOT NULL,
	"actor_id" text,
	"request_hash" text,
	"target_id" text,
	"result" text,
	"correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "execution_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"resource_reference" text,
	"effective_date" text NOT NULL,
	"reference" text NOT NULL,
	"reverses_id" text,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "execution_entries_reverses_id_unique" UNIQUE("reverses_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"minimum" integer NOT NULL,
	"created_at" text NOT NULL,
	"request_hash" text NOT NULL,
	CONSTRAINT "inventory_minimum" CHECK ("inventory_items"."minimum" BETWEEN 0 AND 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"order_id" text,
	"procurement_order_id" text,
	"procurement_receipt_line_id" text,
	"delta" integer NOT NULL,
	"reference" text NOT NULL,
	"created_at" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "inventory_delta" CHECK (abs("inventory_movements"."delta") BETWEEN 1 AND 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"measurement_id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount" integer NOT NULL,
	"due_date" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "invoices_measurement_id_unique" UNIQUE("measurement_id"),
	CONSTRAINT "invoice_amount_positive" CHECK ("invoices"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"effective_date" text NOT NULL,
	"source_reference" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_count" integer NOT NULL,
	"created_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	"reversal_of" text,
	CONSTRAINT "journal_entries_reversal_of_unique" UNIQUE("reversal_of"),
	CONSTRAINT "journal_status" CHECK ("journal_entries"."status" IN ('draft','posted'))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "journal_one_side" CHECK (("journal_lines"."debit">0 AND "journal_lines"."credit"=0) OR ("journal_lines"."credit">0 AND "journal_lines"."debit"=0))
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "measurement_amount_positive" CHECK ("measurements"."amount">0),
	CONSTRAINT "measurement_status_valid" CHECK ("measurements"."status" IN ('draft','approved','billed')),
	CONSTRAINT "measurement_version_valid" CHECK ("measurements"."version">0)
);
--> statement-breakpoint
CREATE TABLE "mrp_events" (
	"id" text PRIMARY KEY NOT NULL,
	"recommendation_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"command" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"purchase_order_id" text,
	"correlation_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "mrp_events_command_valid" CHECK ("mrp_events"."command" IN ('approve','reject','convert')),
	CONSTRAINT "mrp_events_from_valid" CHECK ("mrp_events"."from_status" IN ('draft','approved')),
	CONSTRAINT "mrp_events_to_valid" CHECK ("mrp_events"."to_status" IN ('approved','rejected','converted'))
);
--> statement-breakpoint
CREATE TABLE "mrp_recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"material_id" text NOT NULL,
	"available" integer NOT NULL,
	"minimum" integer NOT NULL,
	"net_requirement" integer NOT NULL,
	"unit" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"purchase_order_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mrp_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"horizon_days" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"evaluated_materials" integer DEFAULT 0 NOT NULL,
	"shortages" integer DEFAULT 0 NOT NULL,
	"recommendations" integer DEFAULT 0 NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "service_orders" (
	"contract_id" text,
	"client_id" text,
	"owner_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"client" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"due_date" text,
	"created_at" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "order_status_valid" CHECK ("service_orders"."status" IN ('draft','authorized','executing','completed','cancelled')),
	CONSTRAINT "order_version_valid" CHECK ("service_orders"."version">0)
);
--> statement-breakpoint
CREATE TABLE "payable_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"payable_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"effective_date" text NOT NULL,
	"reference" text NOT NULL,
	"reverses_id" text,
	"created_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "payable_payments_reverses_id_unique" UNIQUE("reverses_id"),
	CONSTRAINT "payment_kind_valid" CHECK ("payable_payments"."kind" IN ('payment','reversal')),
	CONSTRAINT "payment_amount_positive" CHECK ("payable_payments"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier" text NOT NULL,
	"source_reference" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"due_date" text NOT NULL,
	"created_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "payable_amount_positive" CHECK ("payables"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "period_close_check_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"check_key" text NOT NULL,
	"status" text NOT NULL,
	"observed_count" integer,
	"detail" text NOT NULL,
	CONSTRAINT "close_check_status" CHECK ("period_close_check_results"."status" IN ('passed','blocking','unavailable','advisory'))
);
--> statement-breakpoint
CREATE TABLE "period_close_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"status" text NOT NULL,
	"observed_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "close_run_blocked" CHECK ("period_close_runs"."status"='blocked')
);
--> statement-breakpoint
CREATE TABLE "procurement_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"command" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "procurement_command_type" CHECK ("procurement_commands"."entity_type" IN ('supplier','supplierPurchaseOrder'))
);
--> statement-breakpoint
CREATE TABLE "procurement_receipt_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"item_id" text NOT NULL,
	"accepted_quantity" integer NOT NULL,
	"rejected_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"reference" text NOT NULL,
	"created_at" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"client_id" text NOT NULL,
	"predecessor_id" text,
	"title" text NOT NULL,
	"scope" text NOT NULL,
	"valid_until" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"total" integer NOT NULL,
	"evidence_reference" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"client_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"reference" text NOT NULL,
	"received_date" text NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"cancel_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivable_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"receivable_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"effective_date" text NOT NULL,
	"reference" text NOT NULL,
	"reverses_id" text,
	"created_at" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "receivable_settlements_reverses_id_unique" UNIQUE("reverses_id"),
	CONSTRAINT "settlement_kind_valid" CHECK ("receivable_settlements"."kind" IN ('receipt','reversal')),
	CONSTRAINT "settlement_amount_positive" CHECK ("receivable_settlements"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"amount" integer NOT NULL,
	"due_date" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "receivables_invoice_id_unique" UNIQUE("invoice_id"),
	CONSTRAINT "receivable_amount_positive" CHECK ("receivables"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "saved_view_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"view_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"command" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"category" text NOT NULL,
	"view" text NOT NULL,
	"created_at" text NOT NULL,
	"owner_id" text,
	"definition" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"view_key" text DEFAULT 'serviceOrders.worklist' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_purchase_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"item_id" text NOT NULL,
	"position" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"subtotal" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"item_id" text NOT NULL,
	"reference" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"total" integer NOT NULL,
	"expected_on" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"received_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"request_hash" text NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"freight" integer DEFAULT 0 NOT NULL,
	"additional_costs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "supplier_po_quantity" CHECK ("supplier_purchase_orders"."quantity">0),
	CONSTRAINT "supplier_po_unit_price" CHECK ("supplier_purchase_orders"."unit_price">0),
	CONSTRAINT "supplier_po_total" CHECK ("supplier_purchase_orders"."total">0),
	CONSTRAINT "supplier_po_status_valid" CHECK ("supplier_purchase_orders"."status" IN ('draft','approved','received','cancelled')),
	CONSTRAINT "supplier_po_version" CHECK ("supplier_purchase_orders"."row_version">0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"document" text NOT NULL,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"request_hash" text NOT NULL,
	CONSTRAINT "supplier_status" CHECK ("suppliers"."status" IN ('active','inactive')),
	CONSTRAINT "supplier_version" CHECK ("suppliers"."row_version">0)
);
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_events" ADD CONSTRAINT "bank_reconciliation_events_line_id_bank_statement_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."bank_statement_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_events" ADD CONSTRAINT "bank_reconciliation_events_receipt_id_receivable_settlements_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receivable_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_events" ADD CONSTRAINT "bank_reconciliation_events_payment_id_payable_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payable_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_service_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_entries" ADD CONSTRAINT "execution_entries_id_order_events_id_fk" FOREIGN KEY ("id") REFERENCES "public"."order_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_entries" ADD CONSTRAINT "execution_entries_order_id_service_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_service_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_measurement_id_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."measurements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_service_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_chart_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_order_id_service_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_events" ADD CONSTRAINT "mrp_events_recommendation_id_mrp_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."mrp_recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_recommendations" ADD CONSTRAINT "mrp_recommendations_run_id_mrp_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mrp_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_recommendations" ADD CONSTRAINT "mrp_recommendations_material_id_inventory_items_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_payable_id_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."payables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close_check_results" ADD CONSTRAINT "period_close_check_results_run_id_period_close_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."period_close_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_receipt_lines" ADD CONSTRAINT "procurement_receipt_lines_receipt_id_procurement_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."procurement_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_receipt_lines" ADD CONSTRAINT "procurement_receipt_lines_order_line_id_supplier_purchase_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."supplier_purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_receipt_lines" ADD CONSTRAINT "procurement_receipt_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_receipts" ADD CONSTRAINT "procurement_receipts_order_id_supplier_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."supplier_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_settlements" ADD CONSTRAINT "receivable_settlements_receivable_id_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."receivables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_order_lines" ADD CONSTRAINT "supplier_purchase_order_lines_order_id_supplier_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."supplier_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_order_lines" ADD CONSTRAINT "supplier_purchase_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_events_line" ON "bank_reconciliation_events" USING btree ("line_id","created_at","id");--> statement-breakpoint
CREATE INDEX "bank_lines_statement_date" ON "bank_statement_lines" USING btree ("statement_id","booked_date","id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_account_source" ON "bank_statements" USING btree ("account_reference","source_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_owner_sku" ON "inventory_items" USING btree ("owner_id","sku");--> statement-breakpoint
CREATE INDEX "inventory_movement_item" ON "inventory_movements" USING btree ("item_id","created_at","id");--> statement-breakpoint
CREATE INDEX "journal_effective_id" ON "journal_entries" USING btree ("effective_date","id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry" ON "journal_lines" USING btree ("entry_id","id");--> statement-breakpoint
CREATE INDEX "journal_lines_account" ON "journal_lines" USING btree ("account_id","entry_id");--> statement-breakpoint
CREATE INDEX "measurements_order_idx" ON "measurements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "mrp_events_recommendation_time" ON "mrp_events" USING btree ("recommendation_id","created_at");--> statement-breakpoint
CREATE INDEX "mrp_events_owner_time" ON "mrp_events" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mrp_recommendation_run_material" ON "mrp_recommendations" USING btree ("run_id","material_id");--> statement-breakpoint
CREATE INDEX "mrp_recommendations_owner_status" ON "mrp_recommendations" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "mrp_runs_owner_started" ON "mrp_runs" USING btree ("owner_id","started_at");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "service_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "service_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payable_payments_parent" ON "payable_payments" USING btree ("payable_id","created_at","id");--> statement-breakpoint
CREATE INDEX "payables_due_id" ON "payables" USING btree ("due_date","id");--> statement-breakpoint
CREATE INDEX "payables_created_id" ON "payables" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "close_checks_run" ON "period_close_check_results" USING btree ("run_id","check_key");--> statement-breakpoint
CREATE INDEX "close_runs_period" ON "period_close_runs" USING btree ("period_end","id");--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_receipt_line_once" ON "procurement_receipt_lines" USING btree ("receipt_id","order_line_id");--> statement-breakpoint
CREATE INDEX "procurement_receipt_order" ON "procurement_receipts" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE INDEX "settlements_receivable_idx" ON "receivable_settlements" USING btree ("receivable_id","created_at","id");--> statement-breakpoint
CREATE INDEX "receivables_due_id" ON "receivables" USING btree ("due_date","id");--> statement-breakpoint
CREATE INDEX "receivables_created_id" ON "receivables" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_po_line_position" ON "supplier_purchase_order_lines" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "supplier_po_line_item" ON "supplier_purchase_order_lines" USING btree ("item_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_po_owner_reference" ON "supplier_purchase_orders" USING btree ("owner_id","reference");--> statement-breakpoint
CREATE INDEX "supplier_po_supplier" ON "supplier_purchase_orders" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_po_status" ON "supplier_purchase_orders" USING btree ("owner_id","status","expected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_owner_document" ON "suppliers" USING btree ("owner_id","document");