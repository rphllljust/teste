-- Additive, append-only source linkage; the legacy 36-table D1 inventory is untouched.
-- A single invoice is linked to one posted, balanced journal with exactly matching scaled totals.
CREATE TABLE accounting_invoice_links (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 invoice_id text NOT NULL REFERENCES invoices(id) UNIQUE,
 journal_id text NOT NULL REFERENCES journal_entries(id) UNIQUE,
 amount integer NOT NULL CHECK(amount>0),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX accounting_invoice_link_owner_idx ON accounting_invoice_links(actor_id,invoice_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_accounting_invoice_link_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CISNE_ACCOUNTING_LINK_IMMUTABLE';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounting_invoice_link_immutable_trigger
BEFORE UPDATE OR DELETE ON accounting_invoice_links
FOR EACH ROW EXECUTE FUNCTION cisne_accounting_invoice_link_immutable();
