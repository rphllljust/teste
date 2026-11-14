-- Append-only decision history for persistent MRP recommendations.
-- Apply after 0026_mrp_planning.sql, on the authorized D1 database.
CREATE TABLE IF NOT EXISTS mrp_events (
 id TEXT PRIMARY KEY,
 recommendation_id TEXT NOT NULL REFERENCES mrp_recommendations(id),
 owner_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 command TEXT NOT NULL CHECK(command IN ('approve','reject','convert')),
 from_status TEXT NOT NULL CHECK(from_status IN ('draft','approved')),
 to_status TEXT NOT NULL CHECK(to_status IN ('approved','rejected','converted')),
 purchase_order_id TEXT,
 correlation_id TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mrp_events_recommendation_time ON mrp_events(recommendation_id,created_at);
CREATE INDEX IF NOT EXISTS mrp_events_owner_time ON mrp_events(owner_id,created_at);

-- Decision events are immutable business facts; corrections require a new event.
CREATE TRIGGER IF NOT EXISTS mrp_events_immutable_update
BEFORE UPDATE ON mrp_events
BEGIN SELECT RAISE(ABORT,'CISNE_MRP_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS mrp_events_immutable_delete
BEFORE DELETE ON mrp_events
BEGIN SELECT RAISE(ABORT,'CISNE_MRP_EVENT_IMMUTABLE'); END;
