CREATE TABLE IF NOT EXISTS "cash_transfers" (
  "id" text PRIMARY KEY,
  "from_account_reference" text NOT NULL,
  "to_account_reference" text NOT NULL,
  "amount" integer NOT NULL,
  "effective_date" text NOT NULL,
  "reference" text NOT NULL,
  "status" text NOT NULL DEFAULT 'posted',
  "actor_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "correlation_id" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "cash_transfer_amount_positive" CHECK ("amount">0),
  CONSTRAINT "cash_transfer_distinct_accounts" CHECK ("from_account_reference"<>"to_account_reference"),
  CONSTRAINT "cash_transfer_status" CHECK ("status" IN ('posted','reversed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "cash_transfer_actor_hash" ON "cash_transfers" ("actor_id","request_hash");
CREATE INDEX IF NOT EXISTS "cash_transfer_actor_date" ON "cash_transfers" ("actor_id","effective_date","id");
