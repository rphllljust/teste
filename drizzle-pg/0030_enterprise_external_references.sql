-- Cross-domain identity anchor for integrations. Additive only: legacy records remain untouched.
CREATE TABLE enterprise_external_references (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES enterprise_tenants(id) ON DELETE RESTRICT,
  legal_entity_id text REFERENCES enterprise_legal_entities(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK(entity_type IN ('legal_entity','client','proposal','purchase_order','contract','service_order','execution','measurement','invoice','receivable','settlement','journal_entry')),
  entity_id text NOT NULL,
  system_key text NOT NULL CHECK(system_key ~ '^[A-Za-z0-9_-]{3,64}$'),
  external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 200),
  source_url text NOT NULL CHECK(source_url ~ '^https?://'),
  source_label text NOT NULL CHECK(length(source_label) BETWEEN 3 AND 200),
  owner_display_name text CHECK(owner_display_name IS NULL OR length(owner_display_name) BETWEEN 3 AND 200),
  tax_id text CHECK(tax_id IS NULL OR tax_id ~ '^[0-9]{14}$'),
  status text NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','verified','rejected')),
  created_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK(row_version > 0),
  CONSTRAINT external_reference_entity_requires_legal_entity CHECK(
    entity_type='legal_entity' OR legal_entity_id IS NOT NULL
  ),
  UNIQUE(tenant_id,system_key,external_id),
  UNIQUE(tenant_id,entity_type,entity_id,system_key)
);
--> statement-breakpoint
CREATE INDEX enterprise_external_reference_entity_idx
  ON enterprise_external_references(tenant_id,entity_type,entity_id,status);
--> statement-breakpoint
CREATE INDEX enterprise_external_reference_tax_idx
  ON enterprise_external_references(tenant_id,tax_id,status);
