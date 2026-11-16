CREATE TABLE IF NOT EXISTS "finance_audit_events" (
  "id" text PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "action" text NOT NULL,
  "actor_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "correlation_id" text NOT NULL,
  "metadata" text NOT NULL,
  "occurred_at" text NOT NULL,
  CONSTRAINT "finance_audit_metadata_object" CHECK (jsonb_typeof("metadata"::jsonb) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS "finance_audit_idempotency" ON "finance_audit_events" ("entity_type","entity_id","action","request_hash");
CREATE INDEX IF NOT EXISTS "finance_audit_entity_time" ON "finance_audit_events" ("entity_type","entity_id","occurred_at");
CREATE INDEX IF NOT EXISTS "finance_audit_actor_time" ON "finance_audit_events" ("actor_id","occurred_at");
