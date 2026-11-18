-- Additive Field planning schema. Never writes legacy OS, client, contract or NextCRM data.
-- Compound foreign keys preserve owner isolation even if another SQL caller bypasses the API.
CREATE UNIQUE INDEX IF NOT EXISTS "field_service_orders_owner_idx"
  ON "service_orders" ("owner_id","id");
--> statement-breakpoint
CREATE TABLE "field_people" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "full_name" text NOT NULL,
  "specialty" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "request_hash" text NOT NULL,
  CONSTRAINT "field_people_owner_id_unique" UNIQUE ("owner_id","id"),
  CONSTRAINT "field_people_name_valid" CHECK (char_length("full_name") BETWEEN 2 AND 160),
  CONSTRAINT "field_people_hash_valid" CHECK ("request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "field_order_schedules" (
  "order_id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "location" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "field_schedule_owner_fk" FOREIGN KEY ("owner_id","order_id")
    REFERENCES "service_orders" ("owner_id","id") ON DELETE RESTRICT,
  CONSTRAINT "field_schedule_range_valid" CHECK ("ends_at">"starts_at"),
  CONSTRAINT "field_schedule_version_valid" CHECK ("version">0)
);
--> statement-breakpoint
CREATE TABLE "field_order_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "owner_id" text NOT NULL,
  "person_id" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "field_assignment_order_fk" FOREIGN KEY ("owner_id","order_id")
    REFERENCES "service_orders" ("owner_id","id") ON DELETE RESTRICT,
  CONSTRAINT "field_assignment_person_fk" FOREIGN KEY ("owner_id","person_id")
    REFERENCES "field_people" ("owner_id","id") ON DELETE RESTRICT,
  CONSTRAINT "field_assignment_unique" UNIQUE ("owner_id","order_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "field_planning_events" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "owner_id" text NOT NULL,
  "command" text NOT NULL,
  "request_hash" text NOT NULL,
  "receipt" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "field_event_owner_fk" FOREIGN KEY ("owner_id","order_id")
    REFERENCES "service_orders" ("owner_id","id") ON DELETE RESTRICT,
  CONSTRAINT "field_event_command_valid" CHECK ("command" IN ('set_schedule','assign_person','unassign_person')),
  CONSTRAINT "field_event_hash_valid" CHECK ("request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX "field_people_owner_active_idx" ON "field_people" ("owner_id","active","full_name");
--> statement-breakpoint
CREATE INDEX "field_schedule_owner_start_idx" ON "field_order_schedules" ("owner_id","starts_at");
--> statement-breakpoint
CREATE INDEX "field_assignment_order_active_idx" ON "field_order_assignments" ("owner_id","order_id","active");
--> statement-breakpoint
CREATE INDEX "field_planning_event_order_idx" ON "field_planning_events" ("owner_id","order_id","created_at");
