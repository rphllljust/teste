import { sql } from 'drizzle-orm';
import { pgTable, text, integer, timestamp, check, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { orders, clients } from '../schema';

export const nextcrmOrderDocumentLinks = pgTable('nextcrm_order_document_links', {
  id: text('id').primaryKey(),
  serviceOrderId: text('service_order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  ownerId: text('owner_id').notNull(),
  erpClientId: text('erp_client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  tenantKey: text('tenant_key').notNull(),
  nextcrmAccountId: text('nextcrm_account_id').notNull(),
  nextcrmDocumentId: text('nextcrm_document_id').notNull(),
  documentKind: text('document_kind').notNull(),
  documentVersion: integer('document_version').notNull(),
  sha256: text('sha256'),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  createdBy: text('created_by').notNull(),
  correlationId: text('correlation_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [
  check('nextcrm_doc_link_version_valid', sql`${t.documentVersion} > 0`),
  check('nextcrm_doc_link_kind_valid', sql`${t.documentKind} IN ('attachment','contract','photo','service_report','inspection','invoice')`),
  check('nextcrm_doc_link_sha256_valid', sql`${t.sha256} IS NULL OR ${t.sha256} ~ '^[a-f0-9]{64}$'`),
  check('nextcrm_doc_link_hash_valid', sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  uniqueIndex('nextcrm_doc_link_owner_idempotency').on(t.ownerId, t.idempotencyKey),
  uniqueIndex('nextcrm_doc_link_logical_unique').on(t.serviceOrderId, t.ownerId, t.nextcrmDocumentId, t.documentVersion),
  index('nextcrm_doc_link_order_owner_idx').on(t.serviceOrderId, t.ownerId, t.createdAt),
  index('nextcrm_doc_link_tenant_idx').on(t.tenantKey, t.nextcrmAccountId),
]);

export const nextcrmOrderDocumentEvents = pgTable('nextcrm_order_document_events', {
  id: text('id').primaryKey(),
  linkId: text('link_id').notNull().references(() => nextcrmOrderDocumentLinks.id, { onDelete: 'restrict' }),
  eventType: text('event_type').notNull(),
  actorId: text('actor_id').notNull(),
  requestHash: text('request_hash').notNull(),
  correlationId: text('correlation_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [
  check('nextcrm_doc_event_type_valid', sql`${t.eventType} IN ('linked')`),
  check('nextcrm_doc_event_hash_valid', sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  uniqueIndex('nextcrm_doc_event_one_linked').on(t.linkId, t.eventType),
  index('nextcrm_doc_event_link_idx').on(t.linkId, t.occurredAt),
]);
