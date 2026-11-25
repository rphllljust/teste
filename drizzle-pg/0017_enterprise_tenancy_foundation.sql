-- ERP tenant foundation: add new tables only. No legacy data is modified.
CREATE TABLE enterprise_tenants (
 id text PRIMARY KEY,
 slug text NOT NULL UNIQUE,
 name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 created_by text NOT NULL,
 created_at text NOT NULL,
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version > 0)
);
--> statement-breakpoint
CREATE TABLE enterprise_tenant_memberships (
 tenant_id text NOT NULL REFERENCES enterprise_tenants(id),
 actor_id text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','admin','accountant','operator','auditor')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at text NOT NULL,
 PRIMARY KEY(tenant_id,actor_id)
);
--> statement-breakpoint
CREATE INDEX enterprise_member_actor_idx ON enterprise_tenant_memberships(actor_id,tenant_id);
--> statement-breakpoint
CREATE TABLE enterprise_legal_entities (
 id text PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES enterprise_tenants(id),
 code text NOT NULL,
 name text NOT NULL,
 tax_id text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_by text NOT NULL,
 created_at text NOT NULL,
 UNIQUE(tenant_id,code),
 UNIQUE(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE enterprise_permission_events (
 id text PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES enterprise_tenants(id),
 actor_id text NOT NULL,
 action text NOT NULL,
 resource_id text NOT NULL,
 correlation_id text NOT NULL,
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX enterprise_permission_events_tenant_created_idx ON enterprise_permission_events(tenant_id,created_at,id);
