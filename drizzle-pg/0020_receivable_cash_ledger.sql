-- Expand the prior posting policy check; preserve existing invoice rules.
ALTER TABLE accounting_posting_rules DROP CONSTRAINT accounting_posting_rules_source_type_check;
--> statement-breakpoint
ALTER TABLE accounting_posting_rules ADD CONSTRAINT accounting_posting_rules_source_type_check
 CHECK (source_type IN ('invoice_billing','receivable_receipt'));
--> statement-breakpoint
CREATE TABLE accounting_settlement_links (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 settlement_id text NOT NULL UNIQUE REFERENCES receivable_settlements(id),
 journal_id text NOT NULL UNIQUE REFERENCES journal_entries(id),
 kind text NOT NULL CHECK (kind IN ('receipt','reversal')),
 amount integer NOT NULL CHECK (amount>0),
 effective_date text NOT NULL,
 rule_version integer NOT NULL CHECK (rule_version>0),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX accounting_settlement_links_owner_date_idx
 ON accounting_settlement_links(actor_id,effective_date,settlement_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_accounting_settlement_link_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'CISNE_SETTLEMENT_LINK_IMMUTABLE';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounting_settlement_link_immutable_trigger
BEFORE UPDATE OR DELETE ON accounting_settlement_links
FOR EACH ROW EXECUTE FUNCTION cisne_accounting_settlement_link_immutable();
