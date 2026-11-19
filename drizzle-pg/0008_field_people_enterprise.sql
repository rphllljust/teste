-- Additive enterprise workforce attributes. Existing registrations remain valid.
ALTER TABLE "field_people" ADD COLUMN IF NOT EXISTS "employee_code" text;
ALTER TABLE "field_people" ADD COLUMN IF NOT EXISTS "department" text;
ALTER TABLE "field_people" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "field_people" ADD COLUMN IF NOT EXISTS "cost_hour_scaled" bigint;
ALTER TABLE "field_people" ADD CONSTRAINT "field_people_cost_hour_valid"
  CHECK ("cost_hour_scaled" IS NULL OR "cost_hour_scaled" >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS "field_people_owner_employee_code_idx"
  ON "field_people" ("owner_id", "employee_code")
  WHERE "employee_code" IS NOT NULL;
