CREATE TABLE IF NOT EXISTS service_people (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('person','team')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  external_ref text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, kind, name)
);
CREATE INDEX IF NOT EXISTS service_people_owner_active_idx ON service_people(owner_id, active, kind, name);
