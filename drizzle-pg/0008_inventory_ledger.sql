-- Inventory reservations are separate from the append-only movement ledger.
-- Available quantity is derived transactionally as movements minus active reservations.
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id text PRIMARY KEY NOT NULL,
  item_id text NOT NULL REFERENCES inventory_items(id),
  owner_id text NOT NULL,
  source_document_type text NOT NULL,
  source_document_id text NOT NULL,
  source_reference text NOT NULL,
  quantity integer NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  created_at text NOT NULL,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  CONSTRAINT inventory_reservation_quantity CHECK (quantity BETWEEN 1 AND 1000000000000),
  CONSTRAINT inventory_reservation_status CHECK (status IN ('reserved','released','consumed')),
  CONSTRAINT inventory_reservation_owner_source_item UNIQUE (owner_id, source_document_type, source_document_id, item_id)
);
CREATE INDEX IF NOT EXISTS inventory_reservation_item_status ON inventory_reservations(item_id, owner_id, status, created_at);
