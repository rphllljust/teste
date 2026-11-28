-- CISNE 0036: additive personal access + protected evidence storage.
-- Individual login remains disabled unless CISNE_STAGING_AUTH_MODE=individual.
-- The shared staging credential cannot provision a personal account.
CREATE TABLE cisne_login_accounts (
 actor_id text PRIMARY KEY CHECK(length(actor_id) BETWEEN 8 AND 200),
 login_handle text NOT NULL UNIQUE
  CHECK(login_handle ~ '^[a-z0-9][a-z0-9._-]{2,79}$' AND login_handle = lower(login_handle)),
 salt bytea NOT NULL CHECK(octet_length(salt)=32),
 password_hash bytea NOT NULL CHECK(octet_length(password_hash)=64),
 enabled boolean NOT NULL DEFAULT true,
 failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 10000),
 locked_until timestamptz,
 credential_version integer NOT NULL DEFAULT 1 CHECK(credential_version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Throttle unknown and known handles using a hashed key; do not store submitted names.
CREATE TABLE cisne_login_attempts (
 login_fingerprint text PRIMARY KEY CHECK(login_fingerprint ~ '^[a-f0-9]{64}$'),
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 10000),
 locked_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX cisne_login_attempts_expiry ON cisne_login_attempts(updated_at);
--> statement-breakpoint
CREATE TABLE cisne_login_audit (
 id uuid PRIMARY KEY,
 actor_id text,
 outcome text NOT NULL CHECK(outcome IN ('accepted','denied','locked')),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TRIGGER cisne_login_audit_immutable BEFORE UPDATE OR DELETE ON cisne_login_audit FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
-- A small protected, fully retrievable document/evidence binary.
-- Files > 4MiB use a later approved object-store integration, not an unsafe URL.
CREATE TABLE svc_evidence_files (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 assignment_id uuid REFERENCES svc_assignments(id),
 category text NOT NULL CHECK(category IN ('commercial','field')),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 160),
 mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg','image/webp')),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 4194304),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 contents bytea NOT NULL,
 uploaded_by_actor_id text NOT NULL CHECK(length(uploaded_by_actor_id) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 CHECK(octet_length(contents)=byte_size),
 CHECK((category='commercial' AND assignment_id IS NULL) OR category='field')
);
--> statement-breakpoint
CREATE INDEX svc_evidence_files_need ON svc_evidence_files(tenant_id,need_id,category,created_at,id);
--> statement-breakpoint
CREATE TRIGGER svc_evidence_files_immutable BEFORE UPDATE OR DELETE ON svc_evidence_files FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE FUNCTION svc_guard_evidence_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.assignment_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM svc_assignments a WHERE a.id=NEW.assignment_id
     AND a.tenant_id=NEW.tenant_id AND a.need_id=NEW.need_id)
 THEN RAISE EXCEPTION 'CISNE_SERVICE_NEED_APPEND_ONLY: assignment outside evidence need'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER svc_evidence_assignment_guard BEFORE INSERT ON svc_evidence_files
 FOR EACH ROW EXECUTE FUNCTION svc_guard_evidence_assignment();
