DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid='service_schedules'::regclass
    AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%assignee_type IS NULL%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE service_schedules DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
ALTER TABLE service_people ALTER COLUMN id TYPE text USING id::text;
ALTER TABLE service_people ALTER COLUMN owner_id TYPE text USING owner_id::text;
ALTER TABLE service_schedules ADD CONSTRAINT service_schedules_assignee_pair_check
  CHECK ((assignee_type IS NULL AND assignee_id IS NULL)
      OR (assignee_type IN ('person','team') AND assignee_id IS NOT NULL));
