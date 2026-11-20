ALTER TABLE measurements DROP CONSTRAINT IF EXISTS measurement_status_valid;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS execution_entry_id text REFERENCES execution_entries(id);
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS submitted_at text;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS submitted_by text;
ALTER TABLE measurements ADD CONSTRAINT measurement_status_valid
  CHECK (status IN ('draft','submitted','approved','rejected','billed'));
CREATE UNIQUE INDEX IF NOT EXISTS measurements_execution_entry_unique
  ON measurements(execution_entry_id) WHERE execution_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS measurements_order_status_idx ON measurements(order_id,status,created_at);

CREATE TABLE IF NOT EXISTS field_measurement_events (
  id text PRIMARY KEY,
  measurement_id text NOT NULL REFERENCES measurements(id),
  order_id text NOT NULL REFERENCES service_orders(id),
  command text NOT NULL,
  version integer NOT NULL,
  actor_id text NOT NULL,
  request_hash text NOT NULL,
  result text NOT NULL,
  correlation_id text NOT NULL,
  created_at text NOT NULL,
  CONSTRAINT field_measurement_event_command CHECK (command IN ('create','submit')),
  CONSTRAINT field_measurement_event_version CHECK (version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS field_measurement_events_idempotency
  ON field_measurement_events(measurement_id,request_hash);
CREATE INDEX IF NOT EXISTS field_measurement_events_order_time
  ON field_measurement_events(order_id,created_at,id);
