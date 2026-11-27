-- CISNE Tier 1: owner-scoped native payable payment runs.
-- Preparation never transfers money. Posting is local ledger-only, with atomic source accounting.
CREATE TABLE finance_payment_runs (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 reference text NOT NULL,
 effective_date text NOT NULL,
 status text NOT NULL DEFAULT 'prepared'
  CHECK (status IN ('prepared','posted','cancelled')),
 row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
 request_hash text NOT NULL,
 execution_key text,
 execution_hash text,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 completed_at text,
 CHECK ((status='posted' AND execution_key IS NOT NULL AND completed_at IS NOT NULL)
  OR (status <> 'posted' AND execution_key IS NULL))
);
--> statement-breakpoint
CREATE INDEX finance_payment_runs_owner_state_idx
 ON finance_payment_runs(actor_id,status,created_at DESC,id);
--> statement-breakpoint
CREATE TABLE finance_payment_run_items (
 id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES finance_payment_runs(id),
 payable_id text NOT NULL REFERENCES payables(id),
 amount integer NOT NULL CHECK (amount > 0),
 payment_key text NOT NULL UNIQUE,
 baseline_outstanding integer NOT NULL CHECK (baseline_outstanding > 0),
 UNIQUE(run_id,payable_id)
);
--> statement-breakpoint
CREATE INDEX finance_payment_run_items_run_idx ON finance_payment_run_items(run_id,payable_id);
--> statement-breakpoint
CREATE TABLE finance_payment_run_events (
 id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES finance_payment_runs(id),
 actor_id text NOT NULL,
 action text NOT NULL CHECK (action IN ('prepared','posted','cancelled')),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(run_id,action)
);
--> statement-breakpoint
CREATE FUNCTION cisne_payment_run_event_immutable()
 RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'CISNE_PAYMENT_RUN_EVENT_IMMUTABLE'; END;
 $$;
--> statement-breakpoint
CREATE TRIGGER finance_payment_run_events_immutable
 BEFORE UPDATE OR DELETE ON finance_payment_run_events
 FOR EACH ROW EXECUTE FUNCTION cisne_payment_run_event_immutable();
--> statement-breakpoint
CREATE TRIGGER finance_payment_run_items_immutable
 BEFORE UPDATE OR DELETE ON finance_payment_run_items
 FOR EACH ROW EXECUTE FUNCTION cisne_payment_run_event_immutable();
