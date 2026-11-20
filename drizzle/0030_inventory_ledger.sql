-- Inventory reservations are separate from the append-only movement ledger.
CREATE TABLE IF NOT EXISTS inventory_reservations (
 id TEXT PRIMARY KEY NOT NULL,
 item_id TEXT NOT NULL REFERENCES inventory_items(id),
 owner_id TEXT NOT NULL,
 source_document_type TEXT NOT NULL,
 source_document_id TEXT NOT NULL,
 source_reference TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000000),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','released','consumed')),
 created_at TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 correlation_id TEXT NOT NULL,
 UNIQUE(owner_id,source_document_type,source_document_id,item_id)
);
CREATE INDEX IF NOT EXISTS inventory_reservation_item_status ON inventory_reservations(item_id,owner_id,status,created_at);
