CREATE TABLE IF NOT EXISTS mrp_runs (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 horizon_days INTEGER NOT NULL DEFAULT 30,
 status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('running','completed','failed')),
 evaluated_materials INTEGER NOT NULL DEFAULT 0,
 shortages INTEGER NOT NULL DEFAULT 0,
 recommendations INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL,
 completed_at TEXT,
 error TEXT
);
CREATE INDEX IF NOT EXISTS mrp_runs_owner_started ON mrp_runs(owner_id, started_at);
CREATE TABLE IF NOT EXISTS mrp_recommendations (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES mrp_runs(id),
 owner_id TEXT NOT NULL,
 material_id TEXT NOT NULL REFERENCES inventory_items(id),
 available INTEGER NOT NULL,
 minimum INTEGER NOT NULL,
 net_requirement INTEGER NOT NULL,
 unit TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected','converted')),
 purchase_order_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 row_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS mrp_recommendation_run_material ON mrp_recommendations(run_id, material_id);
CREATE INDEX IF NOT EXISTS mrp_recommendations_owner_status ON mrp_recommendations(owner_id, status);
