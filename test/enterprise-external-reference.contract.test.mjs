import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('drizzle-pg/0030_enterprise_external_references.sql');
const route=read('app/api/enterprise/tenants/[id]/external-references/route.ts');

test('external references are tenant-scoped and never auto-verified',()=>{
 if(!sql.includes('tenant_id text NOT NULL REFERENCES enterprise_tenants'))throw new Error('tenant scope missing');
 if(!sql.includes("status text NOT NULL DEFAULT 'pending_review'"))throw new Error('safe review default missing');
 if(!sql.includes("UNIQUE(tenant_id,system_key,external_id)"))throw new Error('idempotent external identity missing');
 if(!route.includes("status:'pending_review'"))throw new Error('route must return review state');
 if(!route.includes('guardMember'))throw new Error('membership guard missing');
 if(!route.includes('enterprise_external_references'))throw new Error('persistence missing');
});
