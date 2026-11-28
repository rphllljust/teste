-- CISNE Tier 1 — accepted execution -> commercial measurement -> dual-control
-- approval -> existing native billing/receivables. Additive and append-only.
-- A measurement can be billed only through the native invoice lifecycle;
-- no invoice, receivable, journal or fiscal document is created by this DDL.
CREATE TABLE svc_measurement_links (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 report_id uuid NOT NULL REFERENCES svc_work_reports(id),
 measurement_id text NOT NULL REFERENCES measurements(id),
 commercial_snapshot jsonb NOT NULL CHECK(jsonb_typeof(commercial_snapshot)='object'),
 executed_snapshot jsonb NOT NULL CHECK(jsonb_typeof(executed_snapshot)='array'),
 proposed_amount_cents integer NOT NULL CHECK(proposed_amount_cents>0),
 created_by_actor_id text NOT NULL,
 correlation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 UNIQUE(tenant_id,need_id),
 UNIQUE(report_id),
 UNIQUE(measurement_id)
);
--> statement-breakpoint
CREATE INDEX svc_measurement_links_tenant_idx
 ON svc_measurement_links(tenant_id,need_id,created_at DESC);
--> statement-breakpoint
CREATE TRIGGER svc_measurement_links_immutable
 BEFORE UPDATE OR DELETE ON svc_measurement_links
 FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_measurement_approvals (
 id uuid PRIMARY KEY,
 measurement_id text NOT NULL UNIQUE REFERENCES measurements(id),
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 approved_by_actor_id text NOT NULL,
 correlation_id text NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX svc_measurement_approvals_tenant_idx
 ON svc_measurement_approvals(tenant_id,need_id,approved_at DESC);
--> statement-breakpoint
CREATE TRIGGER svc_measurement_approvals_immutable
 BEFORE UPDATE OR DELETE ON svc_measurement_approvals
 FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE FUNCTION svc_guard_measurement_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM svc_work_reports r
   JOIN svc_work_report_reviews v ON v.report_id=r.id AND v.decision='accepted'
   WHERE r.id=NEW.report_id AND r.tenant_id=NEW.tenant_id AND r.need_id=NEW.need_id)
 THEN RAISE EXCEPTION 'CISNE_SCOPE: accepted report required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM measurements m JOIN svc_needs n ON n.order_id=m.order_id
    WHERE m.id=NEW.measurement_id AND n.id=NEW.need_id AND n.tenant_id=NEW.tenant_id
      AND n.status='completed')
 THEN RAISE EXCEPTION 'CISNE_SCOPE: completed order required'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER svc_measurement_links_scope
 BEFORE INSERT ON svc_measurement_links
 FOR EACH ROW EXECUTE FUNCTION svc_guard_measurement_scope();
--> statement-breakpoint
CREATE FUNCTION svc_guard_measurement_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maker text;
BEGIN
 SELECT created_by_actor_id INTO maker FROM svc_measurement_links
  WHERE measurement_id=NEW.measurement_id AND tenant_id=NEW.tenant_id
    AND need_id=NEW.need_id;
 IF maker IS NULL THEN RAISE EXCEPTION 'CISNE_SCOPE: linked measurement required'; END IF;
 IF maker=NEW.approved_by_actor_id THEN
  RAISE EXCEPTION 'CISNE_FOUR_EYES: measurement requires independent owner'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER svc_measurement_approvals_scope
 BEFORE INSERT ON svc_measurement_approvals
 FOR EACH ROW EXECUTE FUNCTION svc_guard_measurement_approval();
