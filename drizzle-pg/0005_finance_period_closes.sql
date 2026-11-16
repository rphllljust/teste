CREATE TABLE IF NOT EXISTS "finance_period_closes" (
  "id" text PRIMARY KEY,
  "period_start" text NOT NULL,
  "period_end" text NOT NULL,
  "status" text NOT NULL DEFAULT 'closed',
  "actor_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "correlation_id" text NOT NULL,
  "closed_at" text NOT NULL,
  CONSTRAINT "finance_period_close_status" CHECK ("status"='closed'),
  CONSTRAINT "finance_period_close_range" CHECK ("period_start"<="period_end")
);
CREATE UNIQUE INDEX IF NOT EXISTS "finance_period_close_actor_hash" ON "finance_period_closes" ("actor_id","request_hash");
CREATE INDEX IF NOT EXISTS "finance_period_close_actor_range" ON "finance_period_closes" ("actor_id","period_start","period_end");
