-- Native, owner-scoped work breakdown structure (WBS) for service orders.
-- Additive schema: never modifies historical execution, AP, fiscal or GL facts.
CREATE TABLE IF NOT EXISTS enterprise_os_work_packages (
 id text PRIMARY KEY,
 owner_id text NOT NULL,
 order_id text NOT NULL REFERENCES service_orders(id),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 60),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 160),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 category text NOT NULL CHECK(category IN ('labor','material','equipment','subcontract','milestone')),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','ready','in_progress','done','cancelled')),
 planned_start_on text NOT NULL CHECK(planned_start_on ~ '^\d{4}-\d{2}-\d{2}$'),
 planned_end_on text NOT NULL CHECK(planned_end_on ~ '^\d{4}-\d{2}-\d{2}$'),
 planned_hours_scaled bigint NOT NULL DEFAULT 0 CHECK(planned_hours_scaled BETWEEN 0 AND 999999999999999),
 planned_cost_scaled bigint NOT NULL DEFAULT 0 CHECK(planned_cost_scaled BETWEEN 0 AND 999999999999999999),
 depends_on_id text REFERENCES enterprise_os_work_packages(id),
 responsible_professional_id text REFERENCES professionals(id),
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),
 created_at text NOT NULL,
 updated_at text NOT NULL,
 started_at text,
 completed_at text,
 cancelled_at text,
 CONSTRAINT cisne_os_package_date_window CHECK(planned_end_on>=planned_start_on),
 CONSTRAINT cisne_os_package_no_self_dependency CHECK(depends_on_id IS NULL OR depends_on_id<>id),
 CONSTRAINT cisne_os_package_unique_reference UNIQUE(owner_id,order_id,reference),
 CONSTRAINT cisne_os_package_state_dates CHECK(
  (state='in_progress' AND started_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL)
  OR (state='done' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND cancelled_at IS NULL)
  OR (state='cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL)
  OR (state IN ('draft','ready') AND started_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cisne_os_packages_owner_order_state
 ON enterprise_os_work_packages(owner_id,order_id,state,planned_end_on,id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cisne_os_packages_dependencies
 ON enterprise_os_work_packages(owner_id,depends_on_id) WHERE depends_on_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS enterprise_os_work_package_events (
 id text PRIMARY KEY,
 package_id text NOT NULL REFERENCES enterprise_os_work_packages(id),
 owner_id text NOT NULL,
 order_id text NOT NULL REFERENCES service_orders(id),
 command text NOT NULL CHECK(command IN ('create','revise','ready','start','complete','cancel')),
 version integer NOT NULL CHECK(version>0),
 actor_id text NOT NULL,
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 receipt jsonb NOT NULL,
 changed_at text NOT NULL,
 CONSTRAINT cisne_os_package_event_unique_version UNIQUE(package_id,version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cisne_os_package_events_order
 ON enterprise_os_work_package_events(owner_id,order_id,changed_at,id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_os_package_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM service_orders o WHERE o.id=NEW.order_id AND o.owner_id=NEW.owner_id)
 THEN RAISE EXCEPTION 'CISNE_OS_PACKAGE_OWNER_INVARIANT'; END IF;
 IF NEW.responsible_professional_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM professionals p WHERE p.id=NEW.responsible_professional_id AND p.owner_id=NEW.owner_id)
 THEN RAISE EXCEPTION 'CISNE_OS_PACKAGE_RESPONSIBLE_INVARIANT'; END IF;
 IF NEW.depends_on_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM enterprise_os_work_packages d
  WHERE d.id=NEW.depends_on_id AND d.owner_id=NEW.owner_id AND d.order_id=NEW.order_id)
 THEN RAISE EXCEPTION 'CISNE_OS_PACKAGE_DEPENDENCY_INVARIANT'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.owner_id<>OLD.owner_id OR NEW.order_id<>OLD.order_id)
 THEN RAISE EXCEPTION 'CISNE_OS_PACKAGE_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cisne_os_package_owner_check
 BEFORE INSERT OR UPDATE ON enterprise_os_work_packages
 FOR EACH ROW EXECUTE FUNCTION cisne_os_package_owner_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_os_package_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM enterprise_os_work_packages p
   WHERE p.id=NEW.package_id AND p.owner_id=NEW.owner_id AND p.order_id=NEW.order_id)
 THEN RAISE EXCEPTION 'CISNE_OS_PACKAGE_EVENT_OWNER_INVARIANT'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cisne_os_package_event_check
 BEFORE INSERT ON enterprise_os_work_package_events
 FOR EACH ROW EXECUTE FUNCTION cisne_os_package_event_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_os_package_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CISNE_OS_PACKAGE_EVENT_IMMUTABLE'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER cisne_os_package_event_append_only
 BEFORE UPDATE OR DELETE ON enterprise_os_work_package_events
 FOR EACH ROW EXECUTE FUNCTION cisne_os_package_event_immutable();
