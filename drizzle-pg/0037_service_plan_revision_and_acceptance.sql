-- CISNE 0037. Additive operational acceptance and immutable plan revision snapshots.
-- Existing needs/orders/evidence survive. Work-report acceptance is owner-governed;
-- it never silently generates a measurement, invoice or fiscal document.
ALTER TABLE svc_needs DROP CONSTRAINT svc_needs_status_check;
--> statement-breakpoint
ALTER TABLE svc_needs ADD CONSTRAINT svc_needs_status_check
 CHECK(status IN ('received','in_analysis','approved','rejected','converted','released','executing','review_pending','completed'));
--> statement-breakpoint
ALTER TABLE svc_needs DROP CONSTRAINT svc_need_order_when_converted;
--> statement-breakpoint
ALTER TABLE svc_needs ADD CONSTRAINT svc_need_order_when_converted
 CHECK((status IN ('received','in_analysis','approved','rejected') AND order_id IS NULL)
 OR (status IN ('converted','released','executing','review_pending','completed') AND order_id IS NOT NULL));
--> statement-breakpoint
CREATE TABLE svc_plan_revisions (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines)>0),
 actor_id text NOT NULL,
 correlation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 UNIQUE(tenant_id,need_id,revision)
);
--> statement-breakpoint
CREATE INDEX svc_plan_revisions_need ON svc_plan_revisions(tenant_id,need_id,revision DESC);
--> statement-breakpoint
CREATE TRIGGER svc_plan_revisions_immutable BEFORE UPDATE OR DELETE ON svc_plan_revisions
 FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
-- Backfill revision #1 for any existing plan, without deleting or changing it.
INSERT INTO svc_plan_revisions(id,tenant_id,need_id,revision,reason,lines,actor_id,correlation_id)
 SELECT gen_random_uuid(),p.tenant_id,p.need_id,1,'Plano anterior preservado na migração 0037',
 jsonb_agg(jsonb_build_object('kind',p.kind,'resourceRef',p.resource_ref,'quantityMilli',p.quantity_milli,'unit',p.unit) ORDER BY p.created_at,p.id),
 (array_agg(p.planned_by_actor_id ORDER BY p.created_at DESC,p.id DESC))[1],'migration:0037'
 FROM svc_plan_lines p GROUP BY p.tenant_id,p.need_id;
--> statement-breakpoint
CREATE TABLE svc_work_reports (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 assignment_id uuid NOT NULL REFERENCES svc_assignments(id),
 summary text NOT NULL CHECK(length(trim(summary)) BETWEEN 10 AND 2000),
 evidence_ref text CHECK(evidence_ref IS NULL OR length(trim(evidence_ref)) BETWEEN 3 AND 500),
 plan_revision integer NOT NULL CHECK(plan_revision>0),
 planned_snapshot jsonb NOT NULL CHECK(jsonb_typeof(planned_snapshot)='array'),
 actual_snapshot jsonb NOT NULL CHECK(jsonb_typeof(actual_snapshot)='array' AND jsonb_array_length(actual_snapshot)>0),
 submitted_by_actor_id text NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 FOREIGN KEY(tenant_id,need_id,plan_revision) REFERENCES svc_plan_revisions(tenant_id,need_id,revision)
);
--> statement-breakpoint
CREATE INDEX svc_work_reports_by_need ON svc_work_reports(tenant_id,need_id,submitted_at,id);
--> statement-breakpoint
CREATE TRIGGER svc_work_reports_immutable BEFORE UPDATE OR DELETE ON svc_work_reports
 FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_work_report_reviews (
 report_id uuid PRIMARY KEY REFERENCES svc_work_reports(id),
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accepted','returned')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 reviewed_by_actor_id text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX svc_work_report_reviews_by_need ON svc_work_report_reviews(tenant_id,need_id,reviewed_at);
--> statement-breakpoint
CREATE TRIGGER svc_work_report_reviews_immutable BEFORE UPDATE OR DELETE ON svc_work_report_reviews
 FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE FUNCTION svc_guard_report_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM svc_assignments a WHERE a.id=NEW.assignment_id
    AND a.need_id=NEW.need_id AND a.tenant_id=NEW.tenant_id)
 THEN RAISE EXCEPTION 'CISNE_SERVICE_NEED_SCOPE: work-report assignment'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER svc_work_report_assignment_scope BEFORE INSERT ON svc_work_reports
 FOR EACH ROW EXECUTE FUNCTION svc_guard_report_consistency();
--> statement-breakpoint
CREATE FUNCTION svc_guard_report_review_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM svc_work_reports r WHERE r.id=NEW.report_id
    AND r.need_id=NEW.need_id AND r.tenant_id=NEW.tenant_id)
 THEN RAISE EXCEPTION 'CISNE_SERVICE_NEED_SCOPE: work-report review'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER svc_work_report_review_scope BEFORE INSERT ON svc_work_report_reviews
 FOR EACH ROW EXECUTE FUNCTION svc_guard_report_review_consistency();
