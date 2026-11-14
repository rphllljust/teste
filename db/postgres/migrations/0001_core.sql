-- CISNE PostgreSQL core foundation (new, isolated PostgreSQL only).
-- DO NOT run on D1/SQLite or against production.
-- IDs, legacy ISO date strings and nullable order ownership are retained
-- deliberately to enable evidence-based reconciliation before any stricter
-- referential or timestamp conversion.
-- Monetary values use BIGINT in their existing integer-scaled units.
BEGIN;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  document TEXT,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clients_owner_id_idx ON clients (owner_id, id);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  predecessor_id TEXT,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  total BIGINT NOT NULL,
  evidence_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposals_owner_client_idx ON proposals (owner_id, client_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  reference TEXT NOT NULL,
  received_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_orders_owner_client_idx ON purchase_orders (owner_id, client_id);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  purchase_order_id TEXT REFERENCES purchase_orders(id),
  reference TEXT NOT NULL,
  scope TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  signed_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contracts_owner_client_idx ON contracts (owner_id, client_id);

CREATE TABLE IF NOT EXISTS service_orders (
  id TEXT PRIMARY KEY,
  contract_id TEXT,
  client_id TEXT,
  owner_id TEXT,
  title TEXT NOT NULL,
  client TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  due_date TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CONSTRAINT order_status_valid CHECK (status IN ('draft','authorized','executing','completed','cancelled')),
  version INTEGER NOT NULL DEFAULT 1
    CONSTRAINT order_version_valid CHECK (version > 0)
);
-- D1 has no FK for service_orders.client_id/contract_id. Adding them here
-- before a real data reconciliation could reject legitimate legacy records.
CREATE INDEX IF NOT EXISTS orders_created_idx ON service_orders (created_at);
CREATE INDEX IF NOT EXISTS orders_status_idx ON service_orders (status);
CREATE INDEX IF NOT EXISTS orders_owner_status_idx ON service_orders (owner_id, status, created_at);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES service_orders(id),
  command TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  actor_id TEXT,
  request_hash TEXT,
  target_id TEXT,
  result TEXT,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, created_at, id);

CREATE TABLE IF NOT EXISTS business_commands (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  command TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS business_commands_replay_idx
  ON business_commands (actor_id, entity_type, entity_id, command, created_at DESC);

COMMIT;
