/**
 * Read-only fail-closed schema and ledger verification for 0007.
 * Does not expose operational rows or depend on secrets.
 */
export async function auditFieldPlanning(client) {
  const ledger=await client.query(
    "SELECT 1 FROM _cisne_schema_migrations WHERE id='0007_field_planning' LIMIT 1",
  );
  if (ledger.rowCount!==1)throw new Error('FIELD_PLANNING_NO_GO: ledger missing');
  const tables=['field_people','field_order_schedules','field_order_assignments','field_planning_events'];
  const present=await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1::text[])",
    [tables],
  );
  if(present.rows.length!==tables.length)throw new Error('FIELD_PLANNING_NO_GO: tables missing');
  const fkNames=['field_schedule_owner_fk','field_assignment_order_fk','field_assignment_person_fk','field_event_owner_fk'];
  const fk=await client.query(
    "SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[]) AND contype='f' AND convalidated",
    [fkNames],
  );
  if(fk.rows.length!==fkNames.length)throw new Error('FIELD_PLANNING_NO_GO: foreign keys absent');
  const idx=await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname=ANY($1::text[])",
    [['field_service_orders_owner_idx','field_people_owner_active_idx',
      'field_schedule_owner_start_idx','field_assignment_order_active_idx',
      'field_planning_event_order_idx']],
  );
  if(idx.rows.length!==5)throw new Error('FIELD_PLANNING_NO_GO: indexes missing');
  return {migrationId:'0007_field_planning',tables:tables.length,validatedForeignKeys:fk.rows.length,
    indexes:idx.rows.length};
}
