-- Operational evidence checkpoints for native Service Orders.
-- Append-only, owner-scoped, reversible; never transitions the OS or posts finance.
CREATE TABLE service_order_milestone_events (
 id text PRIMARY KEY,
 owner_id text NOT NULL,
 order_id text NOT NULL REFERENCES service_orders(id),
 sequence integer NOT NULL CHECK(sequence>0),
 kind text NOT NULL CHECK(kind IN ('record','revoke')),
 checkpoint text NOT NULL CHECK(checkpoint IN (
  'site_readiness','resources_verified','safety_reviewed',
  'execution_inspected','quality_checked','handover_recorded')),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 160),
 note text NOT NULL CHECK(length(trim(note)) BETWEEN 10 AND 1000),
 reverses_id text UNIQUE REFERENCES service_order_milestone_events(id),
 actor_id text NOT NULL,
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT service_order_milestone_kind CHECK(
  (kind='record' AND reverses_id IS NULL) OR
  (kind='revoke' AND reverses_id IS NOT NULL)),
 CONSTRAINT service_order_milestone_actor CHECK(actor_id=owner_id),
 CONSTRAINT service_order_milestone_sequence UNIQUE(owner_id,order_id,sequence)
);
--> statement-breakpoint
CREATE INDEX service_order_milestone_owner_idx
 ON service_order_milestone_events(owner_id,order_id,sequence DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX service_order_milestone_owner_hash
 ON service_order_milestone_events(owner_id,request_hash);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_service_order_milestone_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior service_order_milestone_events%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM service_orders o
   WHERE o.id=NEW.order_id AND o.owner_id=NEW.owner_id) THEN
  RAISE EXCEPTION 'CISNE_MILESTONE_OWNER_INVARIANT';
 END IF;
 IF NEW.kind='revoke' THEN
  SELECT * INTO prior FROM service_order_milestone_events WHERE id=NEW.reverses_id;
  IF NOT FOUND OR prior.kind<>'record'
    OR prior.owner_id<>NEW.owner_id OR prior.order_id<>NEW.order_id
    OR prior.checkpoint<>NEW.checkpoint THEN
   RAISE EXCEPTION 'CISNE_MILESTONE_REVERSAL_INVARIANT';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cisne_service_order_milestone_insert_guard
 BEFORE INSERT ON service_order_milestone_events
 FOR EACH ROW EXECUTE FUNCTION cisne_service_order_milestone_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_service_order_milestone_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CISNE_MILESTONE_IMMUTABLE'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER cisne_service_order_milestone_append_only
 BEFORE UPDATE OR DELETE ON service_order_milestone_events
 FOR EACH ROW EXECUTE FUNCTION cisne_service_order_milestone_immutable();
