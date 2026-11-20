-- ERP Wave 1: professional master data and auditable lifecycle.
CREATE TABLE IF NOT EXISTS professionals (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 name TEXT NOT NULL,
 registration TEXT NOT NULL,
 specialty TEXT NOT NULL,
 department TEXT NOT NULL,
 phone TEXT,
 hourly_cost INTEGER,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version > 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id, registration)
);
CREATE INDEX IF NOT EXISTS professionals_owner_status_name ON professionals(owner_id,status,name,id);
CREATE INDEX IF NOT EXISTS professionals_owner_registration ON professionals(owner_id,registration);

CREATE TABLE IF NOT EXISTS professional_events (
 id TEXT PRIMARY KEY,
 professional_id TEXT NOT NULL REFERENCES professionals(id),
 owner_id TEXT NOT NULL,
 command TEXT NOT NULL,
 version INTEGER NOT NULL,
 actor_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 result TEXT NOT NULL,
 correlation_id TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS professional_events_lookup ON professional_events(owner_id,professional_id,created_at);
