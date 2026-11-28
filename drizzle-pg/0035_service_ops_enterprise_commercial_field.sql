-- Enterprise service-ops extension: immutable commercial revisions, itemized economics,
-- human-reviewed field adjustments and field evidence. Additive to migration 0034.
-- Sensitive financial values never appear in the employee-inbox projection.
ALTER TABLE svc_need_events ADD COLUMN request_hash text;
--> statement-breakpoint
CREATE TABLE svc_commercial_terms_versions (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, need_id uuid NOT NULL,
 pricing_mode text NOT NULL CHECK(pricing_mode IN ('global','itemized','unpriced')),
 global_sale_cents bigint CHECK(global_sale_cents IS NULL OR global_sale_cents BETWEEN 0 AND 999999999999),
 payment_method text CHECK(payment_method IS NULL OR length(payment_method)<=100),
 payment_terms text CHECK(payment_terms IS NULL OR length(payment_terms)<=500),
 max_quantity_milli bigint CHECK(max_quantity_milli IS NULL OR max_quantity_milli>0),
 max_financial_cents bigint CHECK(max_financial_cents IS NULL OR max_financial_cents BETWEEN 0 AND 999999999999),
 customer_rules text CHECK(customer_rules IS NULL OR length(customer_rules)<=2000),
 entered_by_actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 CHECK ((pricing_mode='global' AND global_sale_cents IS NOT NULL) OR (pricing_mode<>'global' AND global_sale_cents IS NULL))
);
--> statement-breakpoint
CREATE INDEX svc_terms_history ON svc_commercial_terms_versions(tenant_id,need_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER svc_terms_immutable BEFORE UPDATE OR DELETE ON svc_commercial_terms_versions FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_commercial_documents (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, need_id uuid NOT NULL,
 document_type text NOT NULL CHECK(document_type IN ('proposal','contract','po','rc','client_order','authorization','client_attachment','other')),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 2 AND 200),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 500),
 evidence_ref text CHECK(evidence_ref IS NULL OR length(trim(evidence_ref)) BETWEEN 3 AND 500),
 registered_by_actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX svc_commercial_documents_by_need ON svc_commercial_documents(tenant_id,need_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER svc_documents_immutable BEFORE UPDATE OR DELETE ON svc_commercial_documents FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_commercial_price_lines (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, need_id uuid NOT NULL,
 supersedes_id uuid REFERENCES svc_commercial_price_lines(id),
 kind text NOT NULL CHECK(kind IN ('labor','vehicle','equipment','material','transport','daily','hour','displacement','service','other')),
 item_ref text NOT NULL CHECK(length(trim(item_ref)) BETWEEN 2 AND 200),
 quantity_milli bigint NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=999999999999),
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 20),
 internal_unit_cost_cents bigint NOT NULL CHECK(internal_unit_cost_cents BETWEEN 0 AND 999999999999),
 sale_unit_price_cents bigint CHECK(sale_unit_price_cents IS NULL OR sale_unit_price_cents BETWEEN 0 AND 999999999999),
 recorded_by_actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 CHECK(id IS DISTINCT FROM supersedes_id)
);
--> statement-breakpoint
CREATE INDEX svc_price_line_history ON svc_commercial_price_lines(tenant_id,need_id,created_at,id);
--> statement-breakpoint
CREATE UNIQUE INDEX svc_price_line_supersession_once ON svc_commercial_price_lines(supersedes_id) WHERE supersedes_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER svc_price_lines_immutable BEFORE UPDATE OR DELETE ON svc_commercial_price_lines FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_field_events (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, need_id uuid NOT NULL,
 assignment_id uuid NOT NULL REFERENCES svc_assignments(id),
 event_type text NOT NULL CHECK(event_type IN ('pause','resume','occurrence','photo','document','odometer','hourmeter','observation')),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 1000),
 quantity_milli bigint CHECK(quantity_milli IS NULL OR quantity_milli>=0),
 unit text CHECK(unit IS NULL OR length(unit) BETWEEN 1 AND 20),
 evidence_ref text CHECK(evidence_ref IS NULL OR length(trim(evidence_ref)) BETWEEN 3 AND 500),
 actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 CHECK ((event_type IN ('odometer','hourmeter') AND quantity_milli IS NOT NULL AND unit IS NOT NULL)
    OR (event_type NOT IN ('odometer','hourmeter') AND quantity_milli IS NULL AND unit IS NULL)),
 CHECK (event_type NOT IN ('photo','document') OR evidence_ref IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX svc_field_events_by_need ON svc_field_events(tenant_id,need_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER svc_field_events_immutable BEFORE UPDATE OR DELETE ON svc_field_events FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_additional_requests (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, need_id uuid NOT NULL,
 assignment_id uuid REFERENCES svc_assignments(id),
 kind text NOT NULL CHECK(kind IN ('labor','vehicle','equipment','material','transport','daily','hour','displacement','service','other')),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 1000),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 quantity_milli bigint NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=999999999999),
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 20),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 3 AND 500),
 requested_by_actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX svc_additional_requests_by_need ON svc_additional_requests(tenant_id,need_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER svc_additional_requests_immutable BEFORE UPDATE OR DELETE ON svc_additional_requests FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_additional_decisions (
 request_id uuid PRIMARY KEY REFERENCES svc_additional_requests(id),
 tenant_id text NOT NULL, need_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 approved_internal_cost_cents bigint CHECK(approved_internal_cost_cents IS NULL OR approved_internal_cost_cents BETWEEN 0 AND 999999999999),
 approved_sale_price_cents bigint CHECK(approved_sale_price_cents IS NULL OR approved_sale_price_cents BETWEEN 0 AND 999999999999),
 decided_by_actor_id text NOT NULL, decided_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 CHECK(decision='approved' OR (approved_internal_cost_cents IS NULL AND approved_sale_price_cents IS NULL))
);
--> statement-breakpoint
CREATE TRIGGER svc_additional_decisions_immutable BEFORE UPDATE OR DELETE ON svc_additional_decisions FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
-- A released OS cannot have its originally approved commercial basis silently edited.
CREATE FUNCTION svc_guard_commercial_before_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM svc_releases WHERE tenant_id=NEW.tenant_id AND need_id=NEW.need_id)
 THEN RAISE EXCEPTION 'CISNE_SERVICE_NEED_APPEND_ONLY: commercial snapshot frozen after release'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER svc_terms_frozen BEFORE INSERT ON svc_commercial_terms_versions FOR EACH ROW EXECUTE FUNCTION svc_guard_commercial_before_release();
--> statement-breakpoint
CREATE TRIGGER svc_documents_frozen BEFORE INSERT ON svc_commercial_documents FOR EACH ROW EXECUTE FUNCTION svc_guard_commercial_before_release();
--> statement-breakpoint
CREATE TRIGGER svc_price_frozen BEFORE INSERT ON svc_commercial_price_lines FOR EACH ROW EXECUTE FUNCTION svc_guard_commercial_before_release();
