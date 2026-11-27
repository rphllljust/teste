-- Controlled multi-line assisted bank matching. Records explicit user approval, not automatic posting.
CREATE TABLE bank_assisted_match_batches (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 statement_id text NOT NULL REFERENCES bank_statements(id),
 match_count integer NOT NULL CHECK (match_count > 0 AND match_count <= 50),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 result jsonb NOT NULL CHECK (jsonb_typeof(result)='object')
);
--> statement-breakpoint
CREATE INDEX bank_assisted_match_batches_actor_created_idx
 ON bank_assisted_match_batches(actor_id,created_at DESC,id);
--> statement-breakpoint
CREATE TRIGGER bank_assisted_match_batches_immutable
 BEFORE UPDATE OR DELETE ON bank_assisted_match_batches
 FOR EACH ROW EXECUTE FUNCTION cisne_payment_run_event_immutable();
