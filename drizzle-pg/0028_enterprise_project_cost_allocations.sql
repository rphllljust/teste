-- Additive, append-only project cost attribution. Never changes payable, accounting or bank facts.
CREATE TABLE enterprise_project_cost_allocations (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 service_order_id text NOT NULL REFERENCES service_orders(id),
 payable_id text NOT NULL REFERENCES payables(id),
 kind text NOT NULL CHECK(kind IN ('allocate','reverse')),
 amount integer NOT NULL CHECK(amount>0),
 reverses_id text UNIQUE REFERENCES enterprise_project_cost_allocations(id),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 160),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 CONSTRAINT project_cost_kind_reversal CHECK(
   (kind='allocate' AND reverses_id IS NULL) OR (kind='reverse' AND reverses_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX enterprise_project_costs_order_idx ON enterprise_project_cost_allocations(actor_id,service_order_id,created_at,id);
--> statement-breakpoint
CREATE INDEX enterprise_project_costs_payable_idx ON enterprise_project_cost_allocations(actor_id,payable_id,created_at,id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_project_cost_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source enterprise_project_cost_allocations%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM service_orders o WHERE o.id=NEW.service_order_id AND o.owner_id=NEW.actor_id)
 OR NOT EXISTS(SELECT 1 FROM payables p WHERE p.id=NEW.payable_id AND p.actor_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CISNE_PROJECT_COST_OWNER_INVARIANT'; END IF;
 IF NEW.kind='reverse' THEN
   SELECT * INTO source FROM enterprise_project_cost_allocations WHERE id=NEW.reverses_id;
   IF NOT FOUND OR source.kind<>'allocate' OR source.actor_id<>NEW.actor_id
      OR source.payable_id<>NEW.payable_id OR source.service_order_id<>NEW.service_order_id
      OR source.amount<>NEW.amount THEN
     RAISE EXCEPTION 'CISNE_PROJECT_COST_REVERSAL_INVARIANT';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER enterprise_project_cost_owner_guard BEFORE INSERT ON enterprise_project_cost_allocations
FOR EACH ROW EXECUTE FUNCTION cisne_project_cost_insert_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_project_cost_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CISNE_PROJECT_COST_IMMUTABLE'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER enterprise_project_cost_append_only BEFORE UPDATE OR DELETE ON enterprise_project_cost_allocations
FOR EACH ROW EXECUTE FUNCTION cisne_project_cost_immutable();
