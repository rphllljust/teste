CREATE TABLE IF NOT EXISTS controlling_budgets (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 account_id text NOT NULL REFERENCES chart_accounts(id),
 period_month text NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 planned_scaled bigint NOT NULL CHECK (planned_scaled > 0),
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved')),
 row_version integer NOT NULL DEFAULT 1 CHECK (row_version>0),
 reference text NOT NULL CHECK (length(trim(reference))>0),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 updated_at text NOT NULL,
 approved_at text,
 CONSTRAINT controlling_budget_approval_state CHECK ((state='draft' AND approved_at IS NULL) OR (state='approved' AND approved_at IS NOT NULL)),
 CONSTRAINT controlling_budget_owner_account_month UNIQUE(actor_id,account_id,period_month)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS controlling_budgets_actor_month_idx ON controlling_budgets(actor_id,period_month,state,account_id);
