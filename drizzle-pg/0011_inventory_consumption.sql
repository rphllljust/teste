ALTER TABLE inventory_reservations
  ADD COLUMN IF NOT EXISTS consumed_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE inventory_reservations
  DROP CONSTRAINT IF EXISTS inventory_reservation_consumed_quantity;
ALTER TABLE inventory_reservations
  ADD CONSTRAINT inventory_reservation_consumed_quantity CHECK (consumed_quantity BETWEEN 0 AND quantity);

CREATE TABLE IF NOT EXISTS inventory_consumption_events (
  id text PRIMARY KEY NOT NULL,
  movement_id text NOT NULL UNIQUE REFERENCES inventory_movements(id),
  reservation_id text NOT NULL REFERENCES inventory_reservations(id),
  item_id text NOT NULL REFERENCES inventory_items(id),
  order_id text NOT NULL REFERENCES service_orders(id),
  owner_id text NOT NULL,
  quantity integer NOT NULL,
  actor_id text NOT NULL,
  reference text NOT NULL,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_consumption_quantity CHECK (quantity BETWEEN 1 AND 1000000000000),
  CONSTRAINT inventory_consumption_owner_scope CHECK (length(owner_id) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_consumption_owner_hash ON inventory_consumption_events(owner_id, request_hash);
CREATE INDEX IF NOT EXISTS inventory_consumption_order_time ON inventory_consumption_events(owner_id, order_id, created_at, id);
