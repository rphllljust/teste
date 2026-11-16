-- Native CRM -> ERP commercial draft bridge.
-- Strict one-to-one origin mapping, preserving both record owners.
-- This migration only adds indexes and a bridge table: it never rewrites
-- existing opportunities, clients, proposals or their lines.
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunities_owner_id_unique ON crm_opportunities(owner_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS proposals_owner_id_unique ON proposals(owner_id,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_opportunity_proposals (
  owner_id text NOT NULL,
  opportunity_id text NOT NULL,
  proposal_id text NOT NULL,
  command_key text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY(owner_id,opportunity_id),
  CONSTRAINT crm_opportunity_proposals_proposal_unique UNIQUE(proposal_id),
  CONSTRAINT crm_opportunity_proposals_command_unique UNIQUE(command_key),
  CONSTRAINT crm_opportunity_proposals_owner_opportunity_fk
    FOREIGN KEY(owner_id,opportunity_id) REFERENCES crm_opportunities(owner_id,id),
  CONSTRAINT crm_opportunity_proposals_owner_proposal_fk
    FOREIGN KEY(owner_id,proposal_id) REFERENCES proposals(owner_id,id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_opportunity_proposals_owner_proposal
  ON crm_opportunity_proposals(owner_id,proposal_id);
