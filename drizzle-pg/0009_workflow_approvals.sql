CREATE TABLE IF NOT EXISTS workflow_approval_requests (
 id text PRIMARY KEY,
 owner_id text NOT NULL,
 entity_type text NOT NULL CHECK (entity_type IN ('finance_period_close')),
 entity_id text NOT NULL,
 command text NOT NULL CHECK (command IN ('close')),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
 requested_by text NOT NULL,
 approver_id text NOT NULL,
 expected_version integer NOT NULL CHECK (expected_version > 0),
 row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
 payload text NOT NULL CHECK (jsonb_typeof(payload::jsonb) = 'object'),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL,
 decided_at text
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_approval_pending_target
 ON workflow_approval_requests(owner_id,entity_type,entity_id,command)
 WHERE state='pending';
CREATE INDEX IF NOT EXISTS workflow_approval_inbox
 ON workflow_approval_requests(approver_id,state,created_at);

CREATE TABLE IF NOT EXISTS workflow_approval_events (
 id text PRIMARY KEY,
 request_id text NOT NULL REFERENCES workflow_approval_requests(id),
 event_type text NOT NULL CHECK (event_type IN ('submitted','approved','rejected')),
 actor_id text NOT NULL,
 from_state text,
 to_state text NOT NULL CHECK (to_state IN ('pending','approved','rejected')),
 version integer NOT NULL CHECK (version > 0),
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 metadata text NOT NULL CHECK (jsonb_typeof(metadata::jsonb) = 'object'),
 created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_approval_event_idempotency
 ON workflow_approval_events(request_id,request_hash);
CREATE INDEX IF NOT EXISTS workflow_approval_events_history
 ON workflow_approval_events(request_id,created_at,id);
