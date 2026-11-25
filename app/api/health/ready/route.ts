import { database } from '../../../../db/raw';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};

/**
 * Deliberately unauthenticated for Railway health probes. No tenant IDs,
 * database version, connection details or operational secrets are returned.
 * This must prove the PostgreSQL business schema, not just an HTTP shell.
 */
export async function GET(){
 try{
  const result=await database().prepare(
   "SELECT (to_regclass('public.service_orders') IS NOT NULL AND "+
   "to_regclass('public.journal_entries') IS NOT NULL AND "+
   "to_regclass('public.enterprise_tenants') IS NOT NULL AND "+
   "EXISTS(SELECT 1 FROM public._cisne_schema_migrations "+
   "WHERE id='0017_enterprise_tenancy_foundation')) AS ready",
  ).first<{ready:boolean}>();
  if(result?.ready===true)return Response.json({ready:true},{status:200,headers});
 }catch{
  // Fail closed: do not expose SQL error strings, hostnames or credentials.
 }
 return Response.json({ready:false},{status:503,headers});
}
