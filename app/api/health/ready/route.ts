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
   "to_regclass('public.enterprise_tenants') IS NOT NULL AND to_regclass('public.enterprise_external_references') IS NOT NULL AND to_regclass('public.enterprise_external_reference_events') IS NOT NULL AND "+
   "to_regclass('public.accounting_settlement_links') IS NOT NULL AND "+
   "to_regclass('public.accounting_payable_links') IS NOT NULL AND "+
   "to_regclass('public.accounting_payable_payment_links') IS NOT NULL AND "+
   "to_regclass('public.procurement_supplier_invoices') IS NOT NULL AND "+
   "to_regclass('public.enterprise_declared_cnaes') IS NOT NULL AND "+
   "to_regclass('public.cisne_erp_owner_declarations') IS NOT NULL AND "+
   "EXISTS(SELECT 1 FROM public.enterprise_declared_cnaes GROUP BY is_primary HAVING is_primary=true AND COUNT(*)=1) AND "+
   "(SELECT COUNT(*)=49 FROM public.enterprise_declared_cnaes) AND "+
   "EXISTS(SELECT 1 FROM public.cisne_erp_owner_declarations WHERE owner_key='abrahim' AND declared_role='owner') AND "+
   "EXISTS(SELECT 1 FROM public.cisne_erp_owner_declarations WHERE owner_key='rafael' AND declared_role='owner') AND "+
   "EXISTS(SELECT 1 FROM public._cisne_schema_migrations "+
   "WHERE id='0017_enterprise_tenancy_foundation') AND "+
   "EXISTS(SELECT 1 FROM public._cisne_schema_migrations "+
   "WHERE id='0020_receivable_cash_ledger') AND "+
   "EXISTS(SELECT 1 FROM public._cisne_schema_migrations "+
   "WHERE id='0022_native_payable_accounting') AND "+
   "EXISTS(SELECT 1 FROM public._cisne_schema_migrations WHERE id='0032_enterprise_cnae_activities') AND "+
   "EXISTS(SELECT 1 FROM public._cisne_schema_migrations WHERE id='0033_cisne_dual_owner_declarations') AND "+
   "EXISTS(SELECT 1 FROM public._cisne_schema_migrations "+
   "WHERE id='0023_procurement_supplier_three_way_match') AND EXISTS(SELECT 1 FROM public._cisne_schema_migrations WHERE id='0030_enterprise_external_references') AND EXISTS(SELECT 1 FROM public._cisne_schema_migrations WHERE id='0031_enterprise_external_reference_review')) AS ready",
  ).bind().first<{ready:boolean}>();
  if(result?.ready===true)return Response.json({ready:true},{status:200,headers});
 }catch{
  // Fail closed: do not expose SQL error strings, hostnames or credentials.
 }
 return Response.json({ready:false},{status:503,headers});
}
