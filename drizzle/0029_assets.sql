CREATE TABLE IF NOT EXISTS assets (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 code TEXT NOT NULL,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('vehicle','equipment','asset')),
 location TEXT,
 responsible TEXT,
 hourly_cost INTEGER,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','inactive')),
 row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version > 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id,code)
);
CREATE INDEX IF NOT EXISTS assets_owner_status_kind ON assets(owner_id,status,kind,name,id);
CREATE TABLE IF NOT EXISTS asset_events (
 id TEXT PRIMARY KEY,
 asset_id TEXT NOT NULL REFERENCES assets(id),
 owner_id TEXT NOT NULL,
 command TEXT NOT NULL,
 version INTEGER NOT NULL,
 actor_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 result TEXT NOT NULL,
 correlation_id TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS asset_events_lookup ON asset_events(owner_id,asset_id,created_at);
