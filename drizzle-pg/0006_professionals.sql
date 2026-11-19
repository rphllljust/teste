CREATE TABLE IF NOT EXISTS professionals (
 id text PRIMARY KEY,
 owner_id text NOT NULL,
 name text NOT NULL,
 registration text NOT NULL,
 specialty text NOT NULL,
 department text NOT NULL,
 phone text,
 hourly_cost integer,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
 created_at text NOT NULL,
 updated_at text NOT NULL,
 UNIQUE(owner_id, registration)
);
CREATE INDEX IF NOT EXISTS professionals_owner_status_name ON professionals(owner_id,status,name,id);
CREATE INDEX IF NOT EXISTS professionals_owner_registration ON professionals(owner_id,registration);
CREATE TABLE IF NOT EXISTS professional_events (
 id text PRIMARY KEY,
 professional_id text NOT NULL REFERENCES professionals(id),
 owner_id text NOT NULL,
 command text NOT NULL,
 version integer NOT NULL,
 actor_id text NOT NULL,
 request_hash text NOT NULL,
 result text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS professional_events_lookup ON professional_events(owner_id,professional_id,created_at);
