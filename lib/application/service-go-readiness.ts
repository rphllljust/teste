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
 const migrations=await q("SELECT id FROM _cisne_schema_migrations WHERE id IN ('0034_service_need_to_execution','0035_service_ops_enterprise_commercial_field','0036_cisne_individual_auth_and_evidence' ,'0037_service_plan_revision_and_acceptance','0038_service_measurement_finance_bridge')",[ ]);
 const ledger=new Set(migrations.rows.map(x=>String(x.id)));
 const schema=['0034_service_need_to_execution','0035_service_ops_enterprise_commercial_field','0036_cisne_individual_auth_and_evidence' ,'0037_service_plan_revision_and_acceptance','0038_service_measurement_finance_bridge'].every(x=>ledger.has(x));
 const evidence=await q("SELECT to_regclass('public.svc_evidence_files') IS NOT NULL AS installed",[]);
 const linkedFinance=await q("SELECT to_regclass('public.svc_measurement_links') IS NOT NULL AS installed, to_regclass('public.svc_measurement_approvals') IS NOT NULL AS approvals",[]);
 const posting=await q(`SELECT count(*)::int AS configured_owners FROM (
 SELECT d.identity_actor_id FROM cisne_erp_owner_declarations d
 JOIN enterprise_tenant_memberships m ON m.actor_id=d.identity_actor_id AND m.tenant_id=$1
  AND m.role='owner' AND m.status='active'
 JOIN accounting_posting_rules p ON p.actor_id=d.identity_actor_id AND p.active=1
  AND p.source_type IN ('invoice_billing','receivable_receipt')
 JOIN chart_accounts debit ON debit.id=p.debit_account_id AND debit.actor_id=d.identity_actor_id
  AND debit.active=1 AND debit.type='asset'
 JOIN chart_accounts credit ON credit.id=p.credit_account_id AND credit.actor_id=d.identity_actor_id
  AND credit.active=1
 WHERE d.owner_key IN ('abrahim','rafael') AND d.identity_state='verified'
 GROUP BY d.identity_actor_id
 HAVING count(DISTINCT p.source_type) FILTER(
  WHERE (p.source_type='invoice_billing' AND credit.type='revenue')
     OR (p.source_type='receivable_receipt' AND credit.type='asset')
 )=2
 ) configured`,[tenantId]);
 const results:Finding[]=[
  {code:'staging_personal_auth',ok:authMode==='individual',detail:'Autenticação individual ativada, sem identidade compartilhada'},
  {code:'dual_verified_owners',ok:controllers,detail:'Abrahim e Rafael vinculados a atores distintos, verificados e com credenciais pessoais'},
  {code:'assigned_employee_identity',ok:Number(employees.rows[0]?.n??0)>0,detail:'Pelo menos um empregado ativo e vinculado possui credencial individual'},
  {code:'schema_0034_0038',ok:schema,detail:'Migrações 0034–0038 de processo, comercial, planejamento, aceite e medição/faturamento estão registradas'},
  {code:'evidence_storage',ok:Boolean(evidence.rows[0]?.installed),detail:'Armazenamento binário com escopo empresarial está disponível'},
  {code:'measurement_finance_link',ok:Boolean(linkedFinance.rows[0]?.installed&&linkedFinance.rows[0]?.approvals),detail:'Vínculo imutável entre execução, medição, controle de quatro olhos e financeiro instalado'},
  {code:'dual_owner_financial_posting',ok:Number(posting.rows[0]?.configured_owners??0)===2,detail:'Os dois controladores possuem regras válidas de faturamento e baixa em contas a receber no próprio razão'},
 ];
 return {
  status:results.every(x=>x.ok)?'READY_FOR_PERSONAL_UAT':'NO_GO',
  findings:results,
  caution:'Prontidão de infraestrutura não substitui a jornada ponta a ponta com sessões reais distintas e aceite operacional. Produção não é promovida automaticamente.',
  checkedAt:new Date().toISOString(),
 };
}
