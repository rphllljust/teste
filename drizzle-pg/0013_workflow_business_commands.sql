-- 0009 created inline CHECK constraints with PostgreSQL-generated names.
-- Remove both generated and stable names so this is safe across histories.
ALTER TABLE workflow_approval_requests DROP CONSTRAINT IF EXISTS workflow_approval_requests_entity_type_check;
ALTER TABLE workflow_approval_requests DROP CONSTRAINT IF EXISTS workflow_approval_requests_command_check;
ALTER TABLE workflow_approval_requests DROP CONSTRAINT IF EXISTS workflow_approval_entity;
ALTER TABLE workflow_approval_requests DROP CONSTRAINT IF EXISTS workflow_approval_command;
ALTER TABLE workflow_approval_requests ADD CONSTRAINT workflow_approval_entity CHECK (entity_type IN ('finance_period_close','service_order','measurement'));
ALTER TABLE workflow_approval_requests ADD CONSTRAINT workflow_approval_command CHECK (command IN ('close','authorize','approve_measurement'));
