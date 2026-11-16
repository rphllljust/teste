-- READ-ONLY POSTGRESQL STAGING AUDIT; does not inspect or output any row values.
-- Explicit transaction + session-level read-only both required. No DDL, DML, mutation.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '12000ms';
SET LOCAL lock_timeout = '2000ms';
SET LOCAL idle_in_transaction_session_timeout = '45000ms';
SELECT 'READ_ONLY' AS metric, 'session' AS subject, current_setting('transaction_read_only') AS result;
SELECT 'TABLES_PRESENT' AS metric, 'public' AS subject, count(*)::text AS result
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname = ANY(ARRAY['bank_reconciliation_events','bank_statement_lines','bank_statements','business_commands','chart_accounts','clients','contracts','order_events','execution_entries','inventory_items','inventory_movements','invoices','journal_entries','journal_lines','measurements','mrp_events','mrp_recommendations','mrp_runs','service_orders','payable_payments','payables','period_close_check_results','period_close_runs','procurement_commands','procurement_receipt_lines','procurement_receipts','proposal_lines','proposals','purchase_orders','receivable_settlements','receivables','saved_view_commands','saved_views','supplier_purchase_order_lines','supplier_purchase_orders','suppliers']);
SELECT 'MIGRATIONS_TABLE' AS metric, 'public' AS subject,
CASE WHEN to_regclass('public._cisne_schema_migrations') IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS result;
SELECT 'FOREIGN_KEYS' AS metric, 'public' AS subject, count(*)::text AS result
FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
WHERE n.nspname='public' AND con.contype='f';
SELECT 'ROW_COUNT' AS metric, 'bank_reconciliation_events' AS subject, count(*)::text AS result FROM public."bank_reconciliation_events"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'bank_statement_lines' AS subject, count(*)::text AS result FROM public."bank_statement_lines"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'bank_statements' AS subject, count(*)::text AS result FROM public."bank_statements"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'business_commands' AS subject, count(*)::text AS result FROM public."business_commands"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'chart_accounts' AS subject, count(*)::text AS result FROM public."chart_accounts"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'clients' AS subject, count(*)::text AS result FROM public."clients"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'contracts' AS subject, count(*)::text AS result FROM public."contracts"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'order_events' AS subject, count(*)::text AS result FROM public."order_events"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'execution_entries' AS subject, count(*)::text AS result FROM public."execution_entries"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'inventory_items' AS subject, count(*)::text AS result FROM public."inventory_items"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'inventory_movements' AS subject, count(*)::text AS result FROM public."inventory_movements"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'invoices' AS subject, count(*)::text AS result FROM public."invoices"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'journal_entries' AS subject, count(*)::text AS result FROM public."journal_entries"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'journal_lines' AS subject, count(*)::text AS result FROM public."journal_lines"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'measurements' AS subject, count(*)::text AS result FROM public."measurements"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'mrp_events' AS subject, count(*)::text AS result FROM public."mrp_events"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'mrp_recommendations' AS subject, count(*)::text AS result FROM public."mrp_recommendations"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'mrp_runs' AS subject, count(*)::text AS result FROM public."mrp_runs"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'service_orders' AS subject, count(*)::text AS result FROM public."service_orders"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'payable_payments' AS subject, count(*)::text AS result FROM public."payable_payments"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'payables' AS subject, count(*)::text AS result FROM public."payables"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'period_close_check_results' AS subject, count(*)::text AS result FROM public."period_close_check_results"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'period_close_runs' AS subject, count(*)::text AS result FROM public."period_close_runs"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'procurement_commands' AS subject, count(*)::text AS result FROM public."procurement_commands"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'procurement_receipt_lines' AS subject, count(*)::text AS result FROM public."procurement_receipt_lines"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'procurement_receipts' AS subject, count(*)::text AS result FROM public."procurement_receipts"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'proposal_lines' AS subject, count(*)::text AS result FROM public."proposal_lines"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'proposals' AS subject, count(*)::text AS result FROM public."proposals"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'purchase_orders' AS subject, count(*)::text AS result FROM public."purchase_orders"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'receivable_settlements' AS subject, count(*)::text AS result FROM public."receivable_settlements"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'receivables' AS subject, count(*)::text AS result FROM public."receivables"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'saved_view_commands' AS subject, count(*)::text AS result FROM public."saved_view_commands"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'saved_views' AS subject, count(*)::text AS result FROM public."saved_views"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'supplier_purchase_order_lines' AS subject, count(*)::text AS result FROM public."supplier_purchase_order_lines"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'supplier_purchase_orders' AS subject, count(*)::text AS result FROM public."supplier_purchase_orders"
UNION ALL SELECT 'ROW_COUNT' AS metric, 'suppliers' AS subject, count(*)::text AS result FROM public."suppliers" ORDER BY subject;
COMMIT;
