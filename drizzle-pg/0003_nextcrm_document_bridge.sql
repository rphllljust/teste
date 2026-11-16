-- CISNE Field PostgreSQL only. The NextCRM PostgreSQL 17 database is untouched.
-- Mapping rows are disabled by default; no identities, accounts, links or documents are imported.
-- New migration ID because 0001/0002 already belong to the native Field CRM.
CREATE UNIQUE INDEX IF NOT EXISTS nextcrm_clients_owner_id_idx ON "clients"("owner_id","id");
--> statement-breakpoint
-- PostgreSQL ERP only; mapping records are disabled until explicitly approved.
-- Does not alter NextCRM's own database and contains no secrets.
CREATE TABLE "nextcrm_erp_identity_mappings" (
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
CREATE INDEX "nextcrm_identity_active_idx"
  ON "nextcrm_erp_identity_mappings" ("instance_key","active");
--> statement-breakpoint
CREATE TABLE "nextcrm_erp_client_account_mappings" (
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
CREATE INDEX "nextcrm_client_account_owner_idx"
  ON "nextcrm_erp_client_account_mappings" ("erp_owner_id","instance_key","active");
--> statement-breakpoint
-- NextCRM OS/document linkage metadata only. No files or credentials stored here.
-- This migration is additive and must never touch NextCRM's own PostgreSQL database.
CREATE TABLE "nextcrm_order_document_links" (
  "id" text PRIMARY KEY NOT NULL,
  "service_order_id" text NOT NULL REFERENCES "service_orders"("id") ON DELETE RESTRICT,
  "owner_id" text NOT NULL,
  "erp_client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE RESTRICT,
  "tenant_key" text NOT NULL,
  "nextcrm_account_id" text NOT NULL,
  "nextcrm_document_id" text NOT NULL,
  "document_kind" text NOT NULL,
  "document_version" integer NOT NULL,
  "sha256" text,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "correlation_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nextcrm_doc_link_version_valid" CHECK ("document_version" > 0),
  CONSTRAINT "nextcrm_doc_link_kind_valid" CHECK ("document_kind" IN ('attachment','contract','photo','service_report','inspection','invoice')),
  CONSTRAINT "nextcrm_doc_link_sha256_valid" CHECK ("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "nextcrm_doc_link_hash_valid" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "nextcrm_doc_link_owner_idempotency" UNIQUE ("owner_id","idempotency_key"),
  CONSTRAINT "nextcrm_doc_link_logical_unique" UNIQUE ("service_order_id","owner_id","nextcrm_document_id","document_version")
);
--> statement-breakpoint
CREATE INDEX "nextcrm_doc_link_order_owner_idx"
  ON "nextcrm_order_document_links" ("service_order_id","owner_id","created_at");
--> statement-breakpoint
CREATE INDEX "nextcrm_doc_link_tenant_idx"
  ON "nextcrm_order_document_links" ("tenant_key","nextcrm_account_id");
--> statement-breakpoint
CREATE TABLE "nextcrm_order_document_events" (
  "id" text PRIMARY KEY NOT NULL,
  "link_id" text NOT NULL REFERENCES "nextcrm_order_document_links"("id") ON DELETE RESTRICT,
  "event_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "correlation_id" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nextcrm_doc_event_type_valid" CHECK ("event_type" IN ('linked')),
  CONSTRAINT "nextcrm_doc_event_hash_valid" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "nextcrm_doc_event_one_linked" UNIQUE ("link_id","event_type")
);
--> statement-breakpoint
CREATE INDEX "nextcrm_doc_event_link_idx"
  ON "nextcrm_order_document_events" ("link_id","occurred_at");
--> statement-breakpoint
CREATE FUNCTION "nextcrm_document_immutable_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'NEXTCRM_DOCUMENT_IMMUTABLE_FACT';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "nextcrm_doc_links_immutable"
  BEFORE UPDATE OR DELETE ON "nextcrm_order_document_links"
  FOR EACH ROW EXECUTE FUNCTION "nextcrm_document_immutable_guard"();
--> statement-breakpoint
CREATE TRIGGER "nextcrm_doc_events_immutable"
  BEFORE UPDATE OR DELETE ON "nextcrm_order_document_events"
  FOR EACH ROW EXECUTE FUNCTION "nextcrm_document_immutable_guard"();
