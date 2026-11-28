-- Service need -> analysis -> draft OS -> plan -> release -> assignment -> receipt -> execution -> additionals.
-- Additive only. tenant_id is the company boundary; *_actor_id columns are authenticated actors/audit only.
-- No fiscal transmission, no production data. Costs/margins live in a separate owner-only table.
CREATE FUNCTION svc_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CISNE_SERVICE_NEED_APPEND_ONLY: % on % is not allowed', TG_OP, TG_TABLE_NAME; END $$;
--> statement-breakpoint
CREATE TABLE svc_needs (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES enterprise_tenants(id),
 channel text NOT NULL CHECK(channel IN ('phone','whatsapp','email','portal','visit','contract','other')),
 origin_ref text NOT NULL CHECK(length(trim(origin_ref)) BETWEEN 1 AND 200),
 client_name text NOT NULL CHECK(length(trim(client_name)) BETWEEN 2 AND 200),
 contact_name text NOT NULL CHECK(length(trim(contact_name)) BETWEEN 2 AND 200),
 contact_phone text CHECK(contact_phone IS NULL OR length(contact_phone)<=40),
 contact_email text CHECK(contact_email IS NULL OR length(contact_email)<=200),
 service_description text NOT NULL CHECK(length(trim(service_description)) BETWEEN 3 AND 2000),
 location text NOT NULL CHECK(length(trim(location)) BETWEEN 2 AND 300),
 requested_date text NOT NULL CHECK(requested_date ~ '^\d{4}-\d{2}-\d{2}$'),
 priority text NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
 proposal_ref text CHECK(proposal_ref IS NULL OR length(proposal_ref)<=120),
 contract_ref text CHECK(contract_ref IS NULL OR length(contract_ref)<=120),
 po_ref text CHECK(po_ref IS NULL OR length(po_ref)<=120),
 rc_ref text CHECK(rc_ref IS NULL OR length(rc_ref)<=120),
 other_refs text CHECK(other_refs IS NULL OR length(other_refs)<=500),
 commercial_terms text CHECK(commercial_terms IS NULL OR length(commercial_terms)<=2000),
 commercial_limit_cents bigint CHECK(commercial_limit_cents IS NULL OR commercial_limit_cents BETWEEN 0 AND 999999999999),
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_analysis','approved','rejected','converted','released','executing')),
 order_id text REFERENCES service_orders(id),
 created_by_actor_id text NOT NULL CHECK(length(created_by_actor_id)>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),
 UNIQUE(tenant_id,id),
 CONSTRAINT svc_need_order_when_converted CHECK((status IN ('received','in_analysis','approved','rejected') AND order_id IS NULL) OR (status IN ('converted','released','executing') AND order_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX svc_needs_queue_idx ON svc_needs(tenant_id,status,priority,requested_date,id);
--> statement-breakpoint
CREATE TABLE svc_need_financials (
 need_id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 estimated_cost_cents bigint NOT NULL CHECK(estimated_cost_cents BETWEEN 0 AND 999999999999),
 margin_bps integer NOT NULL CHECK(margin_bps BETWEEN -10000 AND 10000),
 recorded_by_actor_id text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE svc_need_events (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 command_key uuid NOT NULL,
 event text NOT NULL,
 actor_id text NOT NULL CHECK(length(actor_id)>0),
 reason text CHECK(reason IS NULL OR length(reason)<=1000),
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 correlation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 UNIQUE(tenant_id,command_key)
);
--> statement-breakpoint
CREATE INDEX svc_need_events_need_idx ON svc_need_events(tenant_id,need_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER svc_need_events_immutable BEFORE UPDATE OR DELETE ON svc_need_events FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
-- Planned lines are replaced as a set only before release; actual lines are append-only.
CREATE TABLE svc_plan_lines (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('team','vehicle','equipment','material','hours','quantity')),
 resource_ref text NOT NULL CHECK(length(trim(resource_ref)) BETWEEN 1 AND 200),
 quantity_milli bigint NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=999999999999),
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 20),
 planned_by_actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE svc_actual_lines (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('team','vehicle','equipment','material','hours','quantity')),
 resource_ref text NOT NULL CHECK(length(trim(resource_ref)) BETWEEN 1 AND 200),
 quantity_milli bigint NOT NULL CHECK(quantity_milli>0 AND quantity_milli<=999999999999),
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 20),
 recorded_by_actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE TRIGGER svc_actual_lines_immutable BEFORE UPDATE OR DELETE ON svc_actual_lines FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_releases (
 need_id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 released_by_actor_id text NOT NULL,
 released_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE TRIGGER svc_releases_immutable BEFORE UPDATE OR DELETE ON svc_releases FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE FUNCTION svc_plan_lines_frozen_after_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n uuid := COALESCE(NEW.need_id, OLD.need_id);
BEGIN
 IF EXISTS(SELECT 1 FROM svc_releases WHERE need_id=n) THEN RAISE EXCEPTION 'CISNE_SERVICE_NEED_APPEND_ONLY: plan frozen after release'; END IF;
 RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER svc_plan_lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON svc_plan_lines FOR EACH ROW EXECUTE FUNCTION svc_plan_lines_frozen_after_release();
--> statement-breakpoint
-- Authenticated employee <-> professional link, created by a verified declared owner.
CREATE TABLE svc_employee_links (
 tenant_id text NOT NULL REFERENCES enterprise_tenants(id),
 employee_actor_id text NOT NULL CHECK(length(employee_actor_id)>0),
 professional_id text NOT NULL REFERENCES professionals(id),
 linked_by_actor_id text NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,employee_actor_id),
 UNIQUE(tenant_id,professional_id)
);
--> statement-breakpoint
CREATE TABLE svc_assignments (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 employee_actor_id text NOT NULL,
 assigned_by_actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_actor_id) REFERENCES svc_employee_links(tenant_id,employee_actor_id),
 UNIQUE(tenant_id,need_id,employee_actor_id)
);
--> statement-breakpoint
CREATE TRIGGER svc_assignments_immutable BEFORE UPDATE OR DELETE ON svc_assignments FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_inbox_events (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 assignment_id uuid NOT NULL REFERENCES svc_assignments(id),
 employee_actor_id text NOT NULL,
 event text NOT NULL CHECK(event IN ('assigned','viewed','received')),
 actor_id text NOT NULL,
 correlation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX svc_inbox_events_emp_idx ON svc_inbox_events(tenant_id,employee_actor_id,created_at,id);
--> statement-breakpoint
CREATE UNIQUE INDEX svc_inbox_events_once ON svc_inbox_events(assignment_id,event);
--> statement-breakpoint
CREATE TRIGGER svc_inbox_events_immutable BEFORE UPDATE OR DELETE ON svc_inbox_events FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_executions (
 need_id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 started_by_actor_id text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE TRIGGER svc_executions_immutable BEFORE UPDATE OR DELETE ON svc_executions FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
--> statement-breakpoint
CREATE TABLE svc_additionals (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 need_id uuid NOT NULL,
 supersedes_id uuid REFERENCES svc_additionals(id),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 1000),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 3 AND 500),
 authorized_by_actor_id text NOT NULL,
 recorded_by_actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,need_id) REFERENCES svc_needs(tenant_id,id)
);
--> statement-breakpoint
CREATE TRIGGER svc_additionals_immutable BEFORE UPDATE OR DELETE ON svc_additionals FOR EACH ROW EXECUTE FUNCTION svc_forbid_mutation();
