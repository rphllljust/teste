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
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_allocations_lookup ON resource_allocations(owner_id,resource_type,resource_id,status,starts_at,ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS resource_allocations_idempotency ON resource_allocations(owner_id,request_hash);
