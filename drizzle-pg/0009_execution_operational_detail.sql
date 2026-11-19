-- Additive execution detail. Existing append-only entries remain valid.
ALTER TABLE "execution_entries" ADD COLUMN IF NOT EXISTS "stage" text NOT NULL DEFAULT 'field_work';
ALTER TABLE "execution_entries" ADD COLUMN IF NOT EXISTS "started_at" timestamptz;
ALTER TABLE "execution_entries" ADD COLUMN IF NOT EXISTS "ended_at" timestamptz;
ALTER TABLE "execution_entries" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "execution_entries" ADD CONSTRAINT "execution_entries_stage_valid"
  CHECK ("stage" IN ('field_work','travel','pause','inspection','handover'));
ALTER TABLE "execution_entries" ADD CONSTRAINT "execution_entries_time_range_valid"
  CHECK ("ended_at" IS NULL OR "started_at" IS NULL OR "ended_at">="started_at");
