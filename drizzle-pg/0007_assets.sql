CREATE TABLE IF NOT EXISTS assets (
 id text PRIMARY KEY, owner_id text NOT NULL, code text NOT NULL, name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('vehicle','equipment','asset')), location text,
 responsible text, hourly_cost integer, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','inactive')),
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version > 0), created_at text NOT NULL, updated_at text NOT NULL,
 UNIQUE(owner_id,code)
);
CREATE INDEX IF NOT EXISTS assets_owner_status_kind ON assets(owner_id,status,kind,name,id);
CREATE TABLE IF NOT EXISTS asset_events (
 id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), owner_id text NOT NULL,
 command text NOT NULL, version integer NOT NULL, actor_id text NOT NULL, request_hash text NOT NULL,
 result text NOT NULL, correlation_id text NOT NULL, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS asset_events_lookup ON asset_events(owner_id,asset_id,created_at);
