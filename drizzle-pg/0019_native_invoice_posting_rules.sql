-- Additive, fail-closed invoice posting policy: no backfill and no default GL account.
CREATE TABLE accounting_posting_rules (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 source_type text NOT NULL CHECK (source_type='invoice_billing'),
 debit_account_id text NOT NULL REFERENCES chart_accounts(id),
 credit_account_id text NOT NULL REFERENCES chart_accounts(id),
 active integer NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
 row_version integer NOT NULL DEFAULT 1 CHECK (row_version>0),
 created_at text NOT NULL,
 updated_at text NOT NULL,
 UNIQUE(actor_id,source_type),
 CHECK(debit_account_id<>credit_account_id)
);
--> statement-breakpoint
CREATE INDEX accounting_posting_rules_actor_active_idx ON accounting_posting_rules(actor_id,active);
--> statement-breakpoint
ALTER TABLE accounting_invoice_links
 ADD COLUMN posting_mode text NOT NULL DEFAULT 'manual_verified'
 CHECK (posting_mode IN ('manual_verified','automatic_invoice'));
--> statement-breakpoint
ALTER TABLE accounting_invoice_links
 ADD COLUMN rule_version integer CHECK (rule_version IS NULL OR rule_version>0);
