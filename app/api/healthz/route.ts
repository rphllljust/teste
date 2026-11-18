import { databasePool } from '../../../db/raw';

export async function GET(): Promise<Response> {
  const startedAt=Date.now();
  try {
    const db=databasePool();
    const result=await db.query(`SELECT
      to_regclass('public.service_schedules') AS schedules,
      to_regclass('public.service_people') AS people,
      to_regclass('public.chart_accounts') AS accounts,
      to_regclass('public.journal_entries') AS journals`);
    const row=result.rows[0]??{};
    const missing=['schedules','people','accounts','journals'].filter((key)=>!row[key]);
    if(missing.length) return Response.json({status:'degraded',database:'up',missing,latencyMs:Date.now()-startedAt},{status:503});
    return Response.json({status:'ok',database:'up',schema:'field-accounting-v1',latencyMs:Date.now()-startedAt},{status:200});
  } catch {
    return Response.json({status:'down',database:'unavailable',latencyMs:Date.now()-startedAt},{status:503});
  }
}
