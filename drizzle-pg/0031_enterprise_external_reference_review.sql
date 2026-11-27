ALTER TABLE enterprise_external_references
  ADD COLUMN reviewed_by text,
  ADD COLUMN reviewed_at text,
  ADD COLUMN review_note text;
--> statement-breakpoint
ALTER TABLE enterprise_external_references
  ADD CONSTRAINT external_reference_review_state CHECK(
    (status='pending_review' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
    (status IN ('verified','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  );
--> statement-breakpoint
CREATE TABLE enterprise_external_reference_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES enterprise_tenants(id) ON DELETE RESTRICT,
  reference_id text NOT NULL REFERENCES enterprise_external_references(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('created','verified','rejected')),
  from_status text,
  to_status text NOT NULL CHECK(to_status IN ('pending_review','verified','rejected')),
  actor_id text NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  correlation_id text NOT NULL,
  note text,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX enterprise_external_reference_events_idx
  ON enterprise_external_reference_events(tenant_id,reference_id,created_at,id);
