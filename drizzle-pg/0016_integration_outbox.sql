CREATE TABLE IF NOT EXISTS integration_outbox (
  id text PRIMARY KEY, aggregate_type text NOT NULL, aggregate_id text NOT NULL,
  event_type text NOT NULL, aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  payload jsonb NOT NULL, correlation_id text NOT NULL, occurred_at timestamptz NOT NULL,
  published_at timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_outbox_event_key ON integration_outbox (aggregate_type, aggregate_id, event_type, aggregate_version);
CREATE INDEX IF NOT EXISTS integration_outbox_pending_idx ON integration_outbox (occurred_at, id) WHERE published_at IS NULL;
