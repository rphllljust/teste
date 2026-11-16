import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, timestamp, check, index } from 'drizzle-orm/pg-core';
import { clients } from '../schema';

export const nextcrmErpIdentityMappings = pgTable('nextcrm_erp_identity_mappings', {
  erpActorId: text('erp_actor_id').primaryKey(),
  nextcrmSubjectId: text('nextcrm_subject_id').notNull(),
  instanceKey: text('instance_key').notNull(),
  active: boolean('active').notNull().default(false),
  verifiedSource: text('verified_source').notNull(),
  verifiedBy: text('verified_by').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t=>[
  check('nextcrm_identity_subject_uuid',sql`${t.nextcrmSubjectId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`),
  check('nextcrm_identity_instance',sql`${t.instanceKey} ~ '^[A-Za-z0-9_-]{3,128}$'`),
  check('nextcrm_identity_approval',sql`length(${t.verifiedBy}) BETWEEN 3 AND 200 AND length(${t.verifiedSource}) BETWEEN 8 AND 256`),
  index('nextcrm_identity_active_idx').on(t.instanceKey,t.active),
]);
export const nextcrmErpClientAccountMappings = pgTable('nextcrm_erp_client_account_mappings', {
  erpClientId: text('erp_client_id').primaryKey().references(()=>clients.id,{onDelete:'restrict'}),
  erpOwnerId: text('erp_owner_id').notNull(),
  nextcrmAccountId: text('nextcrm_account_id').notNull(),
  instanceKey: text('instance_key').notNull(),
  active: boolean('active').notNull().default(false),
  verifiedSource: text('verified_source').notNull(),
  verifiedBy: text('verified_by').notNull(),
  verifiedAt: timestamp('verified_at',{withTimezone:true}).notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  check('nextcrm_account_uuid',sql`${t.nextcrmAccountId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`),
  check('nextcrm_account_instance',sql`${t.instanceKey} ~ '^[A-Za-z0-9_-]{3,128}$'`),
  check('nextcrm_account_approval',sql`length(${t.verifiedBy}) BETWEEN 3 AND 200 AND length(${t.verifiedSource}) BETWEEN 8 AND 256`),
  index('nextcrm_client_account_owner_idx').on(t.erpOwnerId,t.instanceKey,t.active),
]);
