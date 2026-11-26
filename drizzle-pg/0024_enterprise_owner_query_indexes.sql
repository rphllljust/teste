-- Additive indexes for owner-scoped operation / accounting queries.
-- Execute in staging first. In production, large-table locking must be reviewed
-- and an approved maintenance window planned before the migrator runs.
CREATE INDEX IF NOT EXISTS cisne_orders_owner_status_due_idx
 ON service_orders(owner_id,status,due_date,id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cisne_orders_owner_created_idx
 ON service_orders(owner_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cisne_exec_order_kind_created_idx
 ON execution_entries(order_id,kind,created_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cisne_journal_actor_effective_idx
 ON journal_entries(actor_id,effective_date,id);
