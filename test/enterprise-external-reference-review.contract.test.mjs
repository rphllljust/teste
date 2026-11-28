import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('drizzle-pg/0031_enterprise_external_reference_review.sql');
const route=read('app/api/enterprise/tenants/[id]/external-references/[referenceId]/commands/route.ts');
test('external reference review is versioned, tenant-scoped and audited',()=>{
 for(const value of ["status='pending_review'","status IN ('verified','rejected')","enterprise_external_reference_events","row_version=row_version+1"])if(!sql.includes(value)&&!route.includes(value))throw new Error('missing review invariant: '+value);
 for(const value of ["'owner','admin','auditor'","expectedVersion","INVALID_TRANSITION","business_commands","enterprise_permission_events"])if(!route.includes(value))throw new Error('missing command guard: '+value);
});
