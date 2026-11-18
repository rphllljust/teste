-- Field scheduling read-path indexes.
CREATE INDEX IF NOT EXISTS service_schedules_owner_start_idx
  ON service_schedules (owner_id, start_utc, id);
CREATE INDEX IF NOT EXISTS service_schedules_owner_order_idx
  ON service_schedules (owner_id, order_id, start_utc);
CREATE INDEX IF NOT EXISTS service_people_owner_kind_active_idx
  ON service_people (owner_id, kind, active, name);
