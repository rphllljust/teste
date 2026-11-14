CREATE TABLE IF NOT EXISTS service_schedules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES service_orders(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Porto_Velho',
  assignee_type TEXT,
  assignee_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  CHECK (status IN ('scheduled','confirmed','cancelled','completed')),
  CHECK (assignee_type IS NULL AND assignee_id IS NULL),
  CHECK (version > 0),
  CHECK (end_utc > start_utc)
);
CREATE INDEX IF NOT EXISTS service_schedules_owner_time ON service_schedules(owner_id,start_utc,end_utc);
CREATE INDEX IF NOT EXISTS service_schedules_order ON service_schedules(order_id,created_at);
CREATE INDEX IF NOT EXISTS service_schedules_assignee_time ON service_schedules(owner_id,assignee_type,assignee_id,start_utc,end_utc);

-- Responsáveis ainda não existem no modelo CISNE. Agendamentos são deliberadamente sem responsável nesta versão.
-- Conflitos por técnico/equipe serão adicionados em uma migração posterior, quando os cadastros reais
-- de pessoas e equipes forem integrados. Não declarar essa regra como homologada antes disso.
