-- Native AP accounting, append-only. No backfill and no default posting rules.
ALTER TABLE accounting_posting_rules DROP CONSTRAINT accounting_posting_rules_source_type_check;
--> statement-breakpoint
ALTER TABLE accounting_posting_rules ADD CONSTRAINT accounting_posting_rules_source_type_check
 CHECK (source_type IN ('invoice_billing','receivable_receipt','payable_accrual','payable_payment'));
--> statement-breakpoint
CREATE TABLE accounting_payable_links (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 payable_id text NOT NULL UNIQUE REFERENCES payables(id),
 journal_id text NOT NULL UNIQUE REFERENCES journal_entries(id),
 amount integer NOT NULL CHECK (amount>0),
 effective_date text NOT NULL,
 rule_version integer NOT NULL CHECK (rule_version>0),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX accounting_payable_links_owner_date_idx
 ON accounting_payable_links(actor_id,effective_date,payable_id);
--> statement-breakpoint
CREATE TABLE accounting_payable_payment_links (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 payment_id text NOT NULL UNIQUE REFERENCES payable_payments(id),
 journal_id text NOT NULL UNIQUE REFERENCES journal_entries(id),
 kind text NOT NULL CHECK (kind IN ('payment','reversal')),
 amount integer NOT NULL CHECK (amount>0),
 effective_date text NOT NULL,
 rule_version integer NOT NULL CHECK (rule_version>0),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX accounting_payable_payment_links_owner_date_idx
 ON accounting_payable_payment_links(actor_id,effective_date,payment_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_accounting_payable_link_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'CISNE_PAYABLE_LINK_IMMUTABLE';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounting_payable_link_immutable_trigger
 BEFORE UPDATE OR DELETE ON accounting_payable_links
 FOR EACH ROW EXECUTE FUNCTION cisne_accounting_payable_link_immutable();
--> statement-breakpoint
CREATE TRIGGER accounting_payable_payment_link_immutable_trigger
 BEFORE UPDATE OR DELETE ON accounting_payable_payment_links
 FOR EACH ROW EXECUTE FUNCTION cisne_accounting_payable_link_immutable();
