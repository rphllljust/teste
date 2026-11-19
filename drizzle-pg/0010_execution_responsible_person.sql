-- Associate execution facts with an active Field professional.
ALTER TABLE "execution_entries" ADD COLUMN IF NOT EXISTS "responsible_person_id" text;
ALTER TABLE "execution_entries" ADD CONSTRAINT "execution_entries_responsible_person_fk"
  FOREIGN KEY ("responsible_person_id") REFERENCES "field_people"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "execution_entries_responsible_person_idx"
  ON "execution_entries" ("responsible_person_id", "created_at");
