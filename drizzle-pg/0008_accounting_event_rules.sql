-- Explicit accounting event configuration for automatic postings.
-- No default chart of accounts is invented. Events remain pending until an
-- authorized owner configures both accounts for the event type.
CREATE TABLE IF NOT EXISTS accounting_event_rules (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  debit_account_id text NOT NULL REFERENCES chart_accounts(id) ON DELETE RESTRICT,
  credit_account_id text NOT NULL REFERENCES chart_accounts(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at text NOT NULL,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  CONSTRAINT accounting_event_rule_distinct_accounts CHECK (debit_account_id <> credit_account_id),
  CONSTRAINT accounting_event_rule_event_type CHECK (event_type IN (
    'receivable_settlement','receivable_reversal',
    'payable_payment','payable_reversal'
  )),
  CONSTRAINT accounting_event_rule_actor_event UNIQUE (actor_id,event_type)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS journal_actor_source_reference
  ON journal_entries(actor_id,source_reference);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS accounting_event_rules_actor
  ON accounting_event_rules(actor_id,event_type,active);
