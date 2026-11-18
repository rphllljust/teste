import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {auditFieldPlanning} from './audit-field-planning-readonly.mjs';

if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required for Field planning migration');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
const db=await pool.connect();
const migrationId='0007_field_planning';
try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock($1)',[510230026]);
  const ready=await db.query(
    "SELECT id FROM _cisne_schema_migrations WHERE id='0006_cisne_company_service_catalog'",
  );
  if(!ready.rowCount)throw new Error('FIELD_PLANNING_NO_GO: catalog migration 0006 not present');
  const existing=await db.query('SELECT id FROM _cisne_schema_migrations WHERE id=$1',[migrationId]);
  if(!existing.rowCount){
    const raw=await readFile(new URL('../drizzle-pg/0007_field_planning.sql',import.meta.url),'utf8');
    const statements=raw.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
    for(const sql of statements)await db.query(sql);
    await db.query('INSERT INTO _cisne_schema_migrations(id) VALUES($1)',[migrationId]);
  }
  const evidence=await auditFieldPlanning(db);
  await db.query('COMMIT');
  console.log('FIELD_PLANNING_EVIDENCE_OK '+JSON.stringify(evidence));
} catch(error) {
  await db.query('ROLLBACK').catch(()=>{});
  console.error('FIELD_PLANNING_NO_GO',error instanceof Error?error.message:String(error));
  throw error;
} finally {
  db.release();
  await pool.end();
}
