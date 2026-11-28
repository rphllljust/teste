import {ApiError} from '../api/http';
import {memberRole,isVerifiedOwner,type Query} from './service-needs';

type Finding={code:string;ok:boolean;detail:string};
/**
 * Operational GO is not inferred from a build or an HTTP 200.
 * These checks evaluate actual tenant/identity configuration without exposing
 * actor IDs, passwords, financial data or cross-tenant records.
 */
export async function serviceGoReadiness(q:Query,tenantId:string,actorId:string,authMode:string){
 await memberRole(q,tenantId,actorId);
 if(!await isVerifiedOwner(q,tenantId,actorId))
  throw new ApiError(403,'FORBIDDEN','Somente o controlador verificado consulta prontidão GO.');
 const declarations=await q(`SELECT d.owner_key,d.identity_actor_id,d.identity_state,
  EXISTS(SELECT 1 FROM enterprise_tenant_memberships m
   WHERE m.tenant_id=$1 AND m.actor_id=d.identity_actor_id AND m.role='owner' AND m.status='active') AS member_ok,
  EXISTS(SELECT 1 FROM cisne_login_accounts a
   WHERE a.actor_id=d.identity_actor_id AND a.enabled) AS credential_ok
  FROM cisne_erp_owner_declarations d WHERE d.owner_key IN ('abrahim','rafael') ORDER BY d.owner_key`,[tenantId]);
 const rows=declarations.rows;
 const distinct=new Set(rows.filter(x=>x.identity_actor_id).map(x=>String(x.identity_actor_id)));
 const controllers=rows.length===2&&rows.every(x=>x.identity_state==='verified'&&x.identity_actor_id&&x.member_ok&&x.credential_ok)&&distinct.size===2;
 const employees=await q(`SELECT count(DISTINCT l.employee_actor_id)::int AS n
  FROM svc_employee_links l
  JOIN enterprise_tenant_memberships m ON m.tenant_id=l.tenant_id AND m.actor_id=l.employee_actor_id
  JOIN cisne_login_accounts a ON a.actor_id=l.employee_actor_id AND a.enabled
  WHERE l.tenant_id=$1 AND m.status='active' AND m.role='operator'`,[tenantId]);
 const migrations=await q("SELECT id FROM _cisne_schema_migrations WHERE id IN ('0034_service_need_to_execution','0035_service_ops_enterprise_commercial_field','0036_cisne_individual_auth_and_evidence')",[ ]);
 const ledger=new Set(migrations.rows.map(x=>String(x.id)));
 const schema=['0034_service_need_to_execution','0035_service_ops_enterprise_commercial_field','0036_cisne_individual_auth_and_evidence'].every(x=>ledger.has(x));
 const evidence=await q("SELECT to_regclass('public.svc_evidence_files') IS NOT NULL AS installed",[]);
 const results:Finding[]=[
  {code:'staging_personal_auth',ok:authMode==='individual',detail:'Autenticação individual ativada, sem identidade compartilhada'},
  {code:'dual_verified_owners',ok:controllers,detail:'Abrahim e Rafael vinculados a atores distintos, verificados e com credenciais pessoais'},
  {code:'assigned_employee_identity',ok:Number(employees.rows[0]?.n??0)>0,detail:'Pelo menos um empregado ativo e vinculado possui credencial individual'},
  {code:'schema_0034_0036',ok:schema,detail:'Migrações de processo, comercial e evidências estão registradas'},
  {code:'evidence_storage',ok:Boolean(evidence.rows[0]?.installed),detail:'Armazenamento binário com escopo empresarial está disponível'},
 ];
 return {
  status:results.every(x=>x.ok)?'READY_FOR_PERSONAL_UAT':'NO_GO',
  findings:results,
  caution:'Prontidão de infraestrutura não substitui a jornada ponta a ponta com sessões reais distintas e aceite operacional. Produção não é promovida automaticamente.',
  checkedAt:new Date().toISOString(),
 };
}
