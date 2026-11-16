-- PostgreSQL ERP only; mapping records are disabled until explicitly approved.
-- Does not alter NextCRM's own database and contains no secrets.
CREATE TABLE IF NOT EXISTS "nextcrm_erp_identity_mappings" (
  "erp_actor_id" text PRIMARY KEY NOT NULL,
  "nextcrm_subject_id" text NOT NULL,
  "instance_key" text NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "verified_source" text NOT NULL,
  "verified_by" text NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nextcrm_identity_subject_uuid" CHECK ("nextcrm_subject_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "nextcrm_identity_instance" CHECK ("instance_key" ~ '^[A-Za-z0-9_-]{3,128}$'),
  CONSTRAINT "nextcrm_identity_approval" CHECK (length("verified_by") BETWEEN 3 AND 200 AND length("verified_source") BETWEEN 8 AND 256)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nextcrm_identity_active_idx"
  ON "nextcrm_erp_identity_mappings" ("instance_key","active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nextcrm_erp_client_account_mappings" (
  "erp_client_id" text PRIMARY KEY NOT NULL REFERENCES "clients"("id") ON DELETE RESTRICT,
  "erp_owner_id" text NOT NULL,
  "nextcrm_account_id" text NOT NULL,
  "instance_key" text NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "verified_source" text NOT NULL,
  "verified_by" text NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nextcrm_account_uuid" CHECK ("nextcrm_account_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "nextcrm_account_instance" CHECK ("instance_key" ~ '^[A-Za-z0-9_-]{3,128}$'),
  CONSTRAINT "nextcrm_account_approval" CHECK (length("verified_by") BETWEEN 3 AND 200 AND length("verified_source") BETWEEN 8 AND 256)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nextcrm_client_account_owner_idx"
  ON "nextcrm_erp_client_account_mappings" ("erp_owner_id","instance_key","active");
