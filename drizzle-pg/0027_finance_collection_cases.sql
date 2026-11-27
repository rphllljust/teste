-- Native collections cases. No email/SMS delivery, no implied cash receipt.
CREATE TABLE finance_collection_cases (
 id text PRIMARY KEY,
 actor_id text NOT NULL,
 receivable_id text NOT NULL REFERENCES receivables(id),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','promised','settled','cancelled')),
 row_version integer NOT NULL DEFAULT 1 CHECK (row_version>0),
 promise_date text,
 source_note text NOT NULL,
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 updated_at text NOT NULL,
 UNIQUE(actor_id,receivable_id)
);
--> statement-breakpoint
CREATE INDEX finance_collection_cases_owner_status_idx
 ON finance_collection_cases(actor_id,status,updated_at DESC,id);
--> statement-breakpoint
CREATE TABLE finance_collection_events (
 id text PRIMARY KEY,
 case_id text NOT NULL REFERENCES finance_collection_cases(id),
 actor_id text NOT NULL,
 action text NOT NULL CHECK (action IN ('opened','contact_logged','promise_recorded','settled','reopened','cancelled')),
 note text NOT NULL,
 promise_date text,
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 UNIQUE(case_id,request_hash)
);
--> statement-breakpoint
CREATE INDEX finance_collection_events_case_time_idx
 ON finance_collection_events(case_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER finance_collection_events_immutable
 BEFORE UPDATE OR DELETE ON finance_collection_events
 FOR EACH ROW EXECUTE FUNCTION cisne_payment_run_event_immutable();
