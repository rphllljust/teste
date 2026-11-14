-- Execute only against disposable cisne_core_ci PostgreSQL.
BEGIN;
INSERT INTO clients(id, owner_id, legal_name, created_at, updated_at)
VALUES ('client-one', 'owner-one', 'Empresa Teste', '2026-11-14T12:00:00Z', '2026-11-14T12:00:00Z');

INSERT INTO proposals(id, owner_id, client_id, title, scope, valid_until, total, created_at, updated_at)
VALUES ('proposal-one', 'owner-one', 'client-one', 'Manutencao', 'Servico', '2026-12-01', 9007199254740993, '2026-11-14T12:00:00Z', '2026-11-14T12:00:00Z');

INSERT INTO purchase_orders(id, owner_id, client_id, proposal_id, reference, received_date, created_at, updated_at)
VALUES ('po-one', 'owner-one', 'client-one', 'proposal-one', 'PO-01', '2026-11-14', '2026-11-14T12:00:00Z', '2026-11-14T12:00:00Z');

INSERT INTO contracts(id, owner_id, client_id, proposal_id, purchase_order_id, reference, scope, starts_on, created_at, updated_at)
VALUES ('contract-one', 'owner-one', 'client-one', 'proposal-one', 'po-one', 'CT-01', 'Servico', '2026-11-14', '2026-11-14T12:00:00Z', '2026-11-14T12:00:00Z');

INSERT INTO service_orders(id, owner_id, client_id, contract_id, title, client, category, description, created_at)
VALUES ('order-one', 'owner-one', 'client-one', 'contract-one', 'OS de teste', 'Empresa Teste', 'Servicos', 'Teste de integridade', '2026-11-14T12:00:00Z');

INSERT INTO order_events(id, order_id, command, version, created_at)
VALUES ('event-one', 'order-one', 'created', 1, '2026-11-14T12:00:00Z');

INSERT INTO business_commands(id, actor_id, entity_type, entity_id, command, request_hash, result, correlation_id, created_at)
VALUES ('command-one', 'owner-one', 'serviceOrder', 'order-one', 'create', 'hash', '{}', 'corr-one', '2026-11-14T12:00:00Z');

DO $test$
DECLARE count_ INTEGER; total_ BIGINT;
BEGIN
  SELECT COUNT(*) INTO count_ FROM order_events WHERE order_id='order-one';
  IF count_ <> 1 THEN RAISE EXCEPTION 'Expected one event linked to the OS'; END IF;
  SELECT total INTO total_ FROM proposals WHERE id='proposal-one';
  IF total_ <> 9007199254740993 THEN RAISE EXCEPTION 'Scaled integer precision lost'; END IF;

  BEGIN
    INSERT INTO order_events(id, order_id, command, version, created_at)
    VALUES ('bad-event', 'missing-order', 'created', 1, '2026-11-14T12:00:00Z');
    RAISE EXCEPTION 'Missing FK did not reject orphan event';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  BEGIN
    INSERT INTO service_orders(id, title, client, category, description, created_at, status)
    VALUES ('bad-order', 'Invalid', 'Invalid', 'Invalid', 'Invalid', '2026-11-14T12:00:00Z', 'unknown');
    RAISE EXCEPTION 'Invalid OS status was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO clients(id, owner_id, legal_name, row_version, created_at, updated_at)
    VALUES ('bad-client', 'owner-one', 'Invalid', 0, '2026-11-14T12:00:00Z', '2026-11-14T12:00:00Z');
    RAISE EXCEPTION 'Nonpositive row_version was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
ROLLBACK;
