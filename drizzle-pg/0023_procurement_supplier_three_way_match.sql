-- Native PO / goods receipt / supplier document matching. Deliberately additive.
-- No fiscal transmission, legacy backfill or default account mapping.
CREATE TABLE procurement_supplier_invoices (
 id text PRIMARY KEY,
 owner_id text NOT NULL,
 order_id text NOT NULL UNIQUE REFERENCES supplier_purchase_orders(id),
 supplier_id text NOT NULL REFERENCES suppliers(id),
 payable_id text NOT NULL UNIQUE REFERENCES payables(id),
 document_number text NOT NULL,
 issue_date text NOT NULL,
 due_date text NOT NULL,
 amount integer NOT NULL CHECK (amount>0),
 currency text NOT NULL DEFAULT 'BRL' CHECK (currency='BRL'),
 status text NOT NULL DEFAULT 'matched' CHECK (status='matched'),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 UNIQUE(owner_id,supplier_id,document_number)
);
--> statement-breakpoint
CREATE INDEX procurement_supplier_invoices_owner_created_idx
 ON procurement_supplier_invoices(owner_id,created_at,id);
--> statement-breakpoint
CREATE TABLE procurement_supplier_invoice_lines (
 id text PRIMARY KEY,
 supplier_invoice_id text NOT NULL REFERENCES procurement_supplier_invoices(id),
 order_line_id text NOT NULL REFERENCES supplier_purchase_order_lines(id),
 accepted_quantity integer NOT NULL CHECK (accepted_quantity>0),
 unit_price integer NOT NULL CHECK (unit_price>0),
 subtotal integer NOT NULL CHECK (subtotal>0),
 UNIQUE(supplier_invoice_id,order_line_id)
);
--> statement-breakpoint
CREATE TABLE procurement_supplier_invoice_receipts (
 id text PRIMARY KEY,
 supplier_invoice_id text NOT NULL REFERENCES procurement_supplier_invoices(id),
 receipt_line_id text NOT NULL UNIQUE REFERENCES procurement_receipt_lines(id),
 accepted_quantity integer NOT NULL CHECK (accepted_quantity>0)
);
--> statement-breakpoint
CREATE INDEX procurement_supplier_invoice_receipts_invoice_idx
 ON procurement_supplier_invoice_receipts(supplier_invoice_id,receipt_line_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cisne_procurement_supplier_invoice_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'CISNE_SUPPLIER_INVOICE_IMMUTABLE';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER procurement_supplier_invoice_immutable_trigger
 BEFORE UPDATE OR DELETE ON procurement_supplier_invoices
 FOR EACH ROW EXECUTE FUNCTION cisne_procurement_supplier_invoice_immutable();
--> statement-breakpoint
CREATE TRIGGER procurement_supplier_invoice_lines_immutable_trigger
 BEFORE UPDATE OR DELETE ON procurement_supplier_invoice_lines
 FOR EACH ROW EXECUTE FUNCTION cisne_procurement_supplier_invoice_immutable();
--> statement-breakpoint
CREATE TRIGGER procurement_supplier_invoice_receipts_immutable_trigger
 BEFORE UPDATE OR DELETE ON procurement_supplier_invoice_receipts
 FOR EACH ROW EXECUTE FUNCTION cisne_procurement_supplier_invoice_immutable();
