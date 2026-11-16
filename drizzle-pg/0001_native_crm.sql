-- CISNE native CRM v1. Additive, transactional, owner-scoped.
-- Existing Field records are preserved; no NextCRM DB is read or modified.
CREATE UNIQUE INDEX IF NOT EXISTS clients_owner_id_unique ON clients(owner_id,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_leads (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  contact_name text NOT NULL,
  company_name text NOT NULL,
  contact_email text,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'new',
  client_id text,
  row_version integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT crm_leads_status_ck CHECK (status IN ('new','qualified','disqualified')),
  CONSTRAINT crm_leads_version_ck CHECK (row_version>0),
  CONSTRAINT crm_leads_owner_id_unique UNIQUE (owner_id,id),
  CONSTRAINT crm_leads_client_owner_fk FOREIGN KEY (owner_id,client_id) REFERENCES clients(owner_id,id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_leads_owner_status_created ON crm_leads (owner_id,status,created_at DESC,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_opportunities (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  lead_id text NOT NULL,
  client_id text,
  title text NOT NULL,
  amount_cents bigint NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'discovery',
  row_version integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT crm_opportunities_stage_ck CHECK (stage IN ('discovery','proposal','negotiation','won','lost')),
  CONSTRAINT crm_opportunities_amount_ck CHECK (amount_cents BETWEEN 0 AND 100000000000000),
  CONSTRAINT crm_opportunities_version_ck CHECK (row_version>0),
  CONSTRAINT crm_opportunities_lead_owner_fk FOREIGN KEY(owner_id,lead_id) REFERENCES crm_leads(owner_id,id),
  CONSTRAINT crm_opportunities_client_owner_fk FOREIGN KEY(owner_id,client_id) REFERENCES clients(owner_id,id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_opportunities_owner_stage_created ON crm_opportunities(owner_id,stage,created_at DESC,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_commands (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  request_hash text NOT NULL,
  action text NOT NULL,
  resource_id text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT '',
  correlation_id text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_commands_actor_created ON crm_commands(actor_id,created_at DESC);
