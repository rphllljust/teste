ALTER TABLE measurements DROP CONSTRAINT IF EXISTS measurement_status_valid;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS cancelled_at text;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS cancelled_by text;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE measurements ADD CONSTRAINT measurement_status_valid
  CHECK (status IN ('draft','submitted','approved','billed','cancelled'));

ALTER TABLE field_measurement_events DROP CONSTRAINT IF EXISTS field_measurement_event_command;
ALTER TABLE field_measurement_events ADD CONSTRAINT field_measurement_event_command
  CHECK (command IN ('create','submit','cancel'));
