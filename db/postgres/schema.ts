/**
 * CISNE PostgreSQL adapter schema: first domain slice only.
 *
 * The legacy D1 schema remains in db/schema.ts. This is NOT a switch of the
 * running application. Never import this module in a Cloudflare D1 handler.
 *
 * For the initial migration we intentionally retain text IDs and ISO
 * timestamp strings. Strict date conversion follows data reconciliation.
 */
import {sql} from 'drizzle-orm';
import {pgTable, text, integer, bigint, index, check} from 'drizzle-orm/pg-core';

export const clients = pgTable('clients', {
  id:text('id').primaryKey(),
  ownerId:text('owner_id').notNull(),
  legalName:text('legal_name').notNull(),
  tradeName:text('trade_name'),
  document:text('document'),
  email:text('email'),
  phone:text('phone'),
  status:text('status').notNull().default('active'),
  rowVersion:integer('row_version').notNull().default(1),
  createdAt:text('created_at').notNull(),
  updatedAt:text('updated_at').notNull(),
}, t => [
  index('clients_owner_id_idx').on(t.ownerId,t.id),
  check('clients_row_version_positive',sql`${t.rowVersion} > 0`),
]);

export const proposals = pgTable('proposals', {
  id:text('id').primaryKey(),
  ownerId:text('owner_id').notNull(),
  clientId:text('client_id').notNull().references(()=>clients.id),
  predecessorId:text('predecessor_id'),
  title:text('title').notNull(),
  scope:text('scope').notNull(),
  validUntil:text('valid_until').notNull(),
  status:text('status').notNull().default('draft'),
  rowVersion:integer('row_version').notNull().default(1),
  total:bigint('total',{mode:'bigint'}).notNull(),
  evidenceReference:text('evidence_reference'),
  createdAt:text('created_at').notNull(),
  updatedAt:text('updated_at').notNull(),
}, t => [
  index('proposals_owner_client_idx').on(t.ownerId,t.clientId),
  check('proposals_row_version_positive',sql`${t.rowVersion} > 0`),
]);

export const purchaseOrders = pgTable('purchase_orders', {
  id:text('id').primaryKey(),
  ownerId:text('owner_id').notNull(),
  clientId:text('client_id').notNull().references(()=>clients.id),
  proposalId:text('proposal_id').notNull().references(()=>proposals.id),
  reference:text('reference').notNull(),
  receivedDate:text('received_date').notNull(),
  status:text('status').notNull().default('registered'),
  rowVersion:integer('row_version').notNull().default(1),
  cancelReason:text('cancel_reason'),
  createdAt:text('created_at').notNull(),
  updatedAt:text('updated_at').notNull(),
}, t => [
  index('purchase_orders_owner_client_idx').on(t.ownerId,t.clientId),
  check('purchase_orders_row_version_positive',sql`${t.rowVersion} > 0`),
]);

export const contracts = pgTable('contracts', {
  id:text('id').primaryKey(),
  ownerId:text('owner_id').notNull(),
  clientId:text('client_id').notNull().references(()=>clients.id),
  proposalId:text('proposal_id').notNull().references(()=>proposals.id),
  purchaseOrderId:text('purchase_order_id').references(()=>purchaseOrders.id),
  reference:text('reference').notNull(),
  scope:text('scope').notNull(),
  startsOn:text('starts_on').notNull(),
  endsOn:text('ends_on'),
  status:text('status').notNull().default('draft'),
  rowVersion:integer('row_version').notNull().default(1),
  signedReference:text('signed_reference'),
  createdAt:text('created_at').notNull(),
  updatedAt:text('updated_at').notNull(),
}, t => [
  index('contracts_owner_client_idx').on(t.ownerId,t.clientId),
  check('contracts_row_version_positive',sql`${t.rowVersion} > 0`),
]);

export const orders = pgTable('service_orders', {
  id:text('id').primaryKey(),
  contractId:text('contract_id'),
  clientId:text('client_id'),
  ownerId:text('owner_id'),
  title:text('title').notNull(),
  client:text('client').notNull(),
  category:text('category').notNull(),
  description:text('description').notNull(),
  dueDate:text('due_date'),
  createdAt:text('created_at').notNull(),
  status:text('status').notNull().default('draft'),
  version:integer('version').notNull().default(1),
}, t => [
  index('orders_created_idx').on(t.createdAt),
  index('orders_status_idx').on(t.status),
  index('orders_owner_status_idx').on(t.ownerId,t.status,t.createdAt),
  check('order_status_valid', sql`${t.status} IN ('draft','authorized','executing','completed','cancelled')`),
  check('order_version_valid',sql`${t.version} > 0`),
]);

export const events = pgTable('order_events', {
  id:text('id').primaryKey(),
  orderId:text('order_id').notNull().references(()=>orders.id),
  command:text('command').notNull(),
  version:integer('version').notNull(),
  createdAt:text('created_at').notNull(),
  actorId:text('actor_id'),
  requestHash:text('request_hash'),
  targetId:text('target_id'),
  result:text('result'),
  correlationId:text('correlation_id'),
}, t => [
  index('order_events_order_idx').on(t.orderId,t.createdAt,t.id),
]);

export const businessCommands = pgTable('business_commands', {
  id:text('id').primaryKey(),
  actorId:text('actor_id').notNull(),
  entityType:text('entity_type').notNull(),
  entityId:text('entity_id').notNull(),
  command:text('command').notNull(),
  requestHash:text('request_hash').notNull(),
  result:text('result').notNull(),
  correlationId:text('correlation_id').notNull(),
  createdAt:text('created_at').notNull(),
}, t => [
  index('business_commands_replay_idx').on(t.actorId,t.entityType,t.entityId,t.command,t.createdAt),
]);
