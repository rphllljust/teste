CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS resource_allocations (
 id text PRIMARY KEY,
 owner_id text NOT NULL,
 order_id text NOT NULL REFERENCES service_orders(id),
 resource_type text NOT NULL CHECK (resource_type IN ('professional','asset')),
 resource_id text NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
 actor_id text NOT NULL,
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_allocations_lookup ON resource_allocations(owner_id,resource_type,resource_id,status,starts_at,ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS resource_allocations_idempotency ON resource_allocations(owner_id,request_hash);
ALTER TABLE resource_allocations DROP CONSTRAINT IF EXISTS resource_allocations_no_overlap;
ALTER TABLE resource_allocations ADD CONSTRAINT resource_allocations_no_overlap EXCLUDE USING gist
 (owner_id WITH =, resource_type WITH =, resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
 WHERE (status = 'active');
CREATE TABLE IF NOT EXISTS resource_allocation_events (
 id text PRIMARY KEY,
 allocation_id text NOT NULL REFERENCES resource_allocations(id),
 owner_id text NOT NULL,
 command text NOT NULL,
 version integer NOT NULL,
 actor_id text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 correlation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_allocation_events_lookup ON resource_allocation_events(owner_id,allocation_id,created_at);
