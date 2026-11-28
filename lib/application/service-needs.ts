/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic SQL rows and JSON test payloads */
import {z} from 'zod';
import {ApiError,fingerprint} from '../api/http';

export type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,any>>}>;
type Ctx={tenantId:string;actorId:string;correlationId:string};

const uuid=z.string().uuid();
const text=(min:number,max:number)=>z.string().trim().min(min).max(max);
const opt=(max:number)=>z.string().trim().max(max).nullable().optional().transform(v=>v?v:null);
const kind=z.enum(['team','vehicle','equipment','material','hours','quantity']);
const line=z.object({kind,resourceRef:text(1,200),quantityMilli:z.number().int().positive().max(999999999999),unit:text(1,20)}).strict();
const cents=z.number().int().min(0).max(999999999999);
const fieldKind=z.enum(['pause','resume','occurrence','photo','document','odometer','hourmeter','observation']);
const priceKind=z.enum(['labor','vehicle','equipment','material','transport','daily','hour','displacement','service','other']);

export const createNeed=z.object({
 id:uuid,commandKey:uuid,
 channel:z.enum(['phone','whatsapp','email','portal','visit','contract','other']),
 originRef:text(1,200),clientName:text(2,200),contactName:text(2,200),
 contactPhone:opt(40),contactEmail:opt(200),
 serviceDescription:text(3,2000),location:text(2,300),
 requestedDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 priority:z.enum(['low','normal','high','urgent']),
 proposalRef:opt(120),contractRef:opt(120),poRef:opt(120),rcRef:opt(120),otherRefs:opt(500),
 commercialTerms:opt(2000),commercialLimitCents:z.number().int().min(0).max(999999999999).nullable().optional(),
}).strict();

const base={commandKey:uuid};
export const needCommand=z.discriminatedUnion('command',[
 z.object({...base,command:z.literal('start_analysis')}).strict(),
 z.object({...base,command:z.literal('approve'),reason:text(3,1000),financials:z.object({estimatedCostCents:z.number().int().min(0).max(999999999999),marginBps:z.number().int().min(-10000).max(10000)}).strict().optional()}).strict(),
 z.object({...base,command:z.literal('reject'),reason:text(3,1000)}).strict(),
 z.object({...base,command:z.literal('convert'),orderId:uuid,category:z.enum(['Locação','Serviços','Transporte','Obra']).default('Serviços')}).strict(),
 z.object({...base,command:z.literal('set_plan'),reason:text(3,500).optional(),lines:z.array(line).min(1).max(100)}).strict(),
 z.object({...base,command:z.literal('release')}).strict(),
 z.object({...base,command:z.literal('assign'),employeeActorId:text(1,200)}).strict(),
 z.object({...base,command:z.literal('mark_viewed'),assignmentId:uuid}).strict(),
 z.object({...base,command:z.literal('mark_received'),assignmentId:uuid}).strict(),
 z.object({...base,command:z.literal('start_execution'),assignmentId:uuid}).strict(),
 z.object({...base,command:z.literal('record_actual'),assignmentId:uuid,id:uuid,line}).strict(),
 z.object({...base,command:z.literal('add_additional'),id:uuid,supersedesId:uuid.nullable().optional(),description:text(3,1000),reason:text(3,1000),evidenceRef:text(3,500)}).strict(),
 z.object({...base,command:z.literal('set_commercial_terms'),id:uuid,pricingMode:z.enum(['global','itemized','unpriced']),globalSaleCents:cents.nullable().optional(),paymentMethod:opt(100),paymentTerms:opt(500),maxQuantityMilli:z.number().int().positive().max(999999999999).nullable().optional(),maxFinancialCents:cents.nullable().optional(),customerRules:opt(2000)}).strict(),
 z.object({...base,command:z.literal('register_commercial_document'),id:uuid,documentType:z.enum(['proposal','contract','po','rc','client_order','authorization','client_attachment','other']),reference:text(2,200),description:text(3,500),evidenceRef:opt(500)}).strict(),
 z.object({...base,command:z.literal('register_price_line'),id:uuid,supersedesId:uuid.nullable().optional(),kind:priceKind,itemRef:text(2,200),quantityMilli:z.number().int().positive().max(999999999999),unit:text(1,20),internalUnitCostCents:cents,saleUnitPriceCents:cents.nullable().optional()}).strict(),
 z.object({...base,command:z.literal('record_field_event'),id:uuid,assignmentId:uuid,eventType:fieldKind,description:text(3,1000),quantityMilli:z.number().int().min(0).max(999999999999).nullable().optional(),unit:opt(20),evidenceRef:opt(500)}).strict(),
 z.object({...base,command:z.literal('request_additional'),id:uuid,assignmentId:uuid,kind:priceKind,description:text(3,1000),reason:text(3,1000),quantityMilli:z.number().int().positive().max(999999999999),unit:text(1,20),evidenceRef:text(3,500)}).strict(),
 z.object({...base,command:z.literal('decide_additional'),requestId:uuid,decision:z.enum(['approved','rejected']),reason:text(3,1000),approvedInternalCostCents:cents.nullable().optional(),approvedSalePriceCents:cents.nullable().optional()}).strict(),
 z.object({...base,command:z.literal('submit_work_report'),id:uuid,assignmentId:uuid,summary:text(10,2000),evidenceRef:opt(500)}).strict(),
 z.object({...base,command:z.literal('review_work_report'),reportId:uuid,decision:z.enum(['accepted','returned']),reason:text(3,1000)}).strict(),
]);
export const linkEmployee=z.object({commandKey:uuid,employeeActorId:text(1,200),professionalId:text(1,200)}).strict();

const notFound=()=>new ApiError(404,'NOT_FOUND','Registro não encontrado no contexto autorizado.');
const forbidden=(m:string)=>new ApiError(403,'FORBIDDEN',m);

/** Active member of an active tenant; unknown tenant and non-member are indistinguishable (404). */
export async function memberRole(q:Query,tenantId:string,actorId:string){
 const r=await q(`SELECT m.role FROM enterprise_tenant_memberships m JOIN enterprise_tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=$1 AND m.actor_id=$2 AND m.status='active' AND t.status='active' FOR SHARE OF m,t`,[tenantId,actorId]);
 if(!r.rows.length)throw notFound();
 return String(r.rows[0].role);
}
/** Authorized owner = tenant role 'owner' AND a verified declared owner (Abrahim or Rafael) bound to this actor. */
export async function isVerifiedOwner(q:Query,tenantId:string,actorId:string){
 const r=await q(`SELECT 1 FROM cisne_erp_owner_declarations d JOIN enterprise_tenant_memberships m ON m.actor_id=d.identity_actor_id
  WHERE d.identity_actor_id=$2 AND d.identity_state='verified' AND d.owner_key IN ('abrahim','rafael')
  AND m.tenant_id=$1 AND m.role='owner' AND m.status='active'`,[tenantId,actorId]);
 return r.rows.length>0;
}
async function requireOwner(q:Query,c:Ctx,what:string){
 if(!await isVerifiedOwner(q,c.tenantId,c.actorId))throw forbidden('Somente os owners autorizados podem '+what+'.');
}

async function validateInternalEvidence(q:Query,c:Ctx,needId:string,reference:string|null|undefined,kind:'commercial'|'field',photo=false){
 if(!reference?.startsWith('cisne-file:'))return;
 const id=reference.slice('cisne-file:'.length);
 if(!uuid.safeParse(id).success)throw new ApiError(409,'EVIDENCE_SCOPE_MISMATCH','Referência interna inválida.');
 const rows=await q('SELECT mime_type FROM svc_evidence_files WHERE id=$1 AND tenant_id=$2 AND need_id=$3 AND category=$4',
  [id,c.tenantId,needId,kind]);
 if(rows.rows.length!==1||(photo&&!String(rows.rows[0].mime_type).startsWith('image/')))
  throw new ApiError(409,'EVIDENCE_SCOPE_MISMATCH','A evidência não pertence à operação.');
}

const NEED_COLS=`id,channel,origin_ref AS "originRef",client_name AS "clientName",contact_name AS "contactName",
 contact_phone AS "contactPhone",contact_email AS "contactEmail",service_description AS "serviceDescription",location,
 requested_date AS "requestedDate",priority,proposal_ref AS "proposalRef",contract_ref AS "contractRef",po_ref AS "poRef",
 rc_ref AS "rcRef",other_refs AS "otherRefs",commercial_terms AS "commercialTerms",commercial_limit_cents::float8 AS "commercialLimitCents",
 status,order_id AS "orderId",created_by_actor_id AS "createdByActorId",created_at AS "createdAt",row_version AS "rowVersion"`;

async function replay(q:Query,c:Ctx,needId:string,commandKey:string,event?:string,requestHash?:string){
 const r=await q('SELECT need_id,actor_id,event,request_hash FROM svc_need_events WHERE tenant_id=$1 AND command_key=$2',[c.tenantId,commandKey]);
 if(!r.rows.length)return null;
 const o=r.rows[0];
 if(String(o.need_id)!==needId||o.actor_id!==c.actorId||(event&&o.event!==event)||(requestHash&&o.request_hash!==requestHash))throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já utilizada com outros dados.');
 return {ok:true,replayed:true,needId};
}
async function audit(q:Query,c:Ctx,needId:string,commandKey:string,event:string,reason:string|null,detail:object={},requestHash:string|null=null){
 await q(`INSERT INTO svc_need_events(id,tenant_id,need_id,command_key,event,actor_id,reason,detail,correlation_id,request_hash)
  VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,[c.tenantId,needId,commandKey,event,c.actorId,reason,JSON.stringify(detail),c.correlationId,requestHash]);
}

export async function createServiceNeed(q:Query,c:Ctx,d:z.infer<typeof createNeed>){
 await memberRole(q,c.tenantId,c.actorId);
 await requireOwner(q,c,'registrar necessidades');
 const requestHash=await fingerprint({scope:'service-need.create',tenantId:c.tenantId,actorId:c.actorId,body:d});
 const prior=await replay(q,c,d.id,d.commandKey,'received',requestHash);
 if(prior)return prior;
 await q(`INSERT INTO svc_needs(id,tenant_id,channel,origin_ref,client_name,contact_name,contact_phone,contact_email,service_description,location,
  requested_date,priority,proposal_ref,contract_ref,po_ref,rc_ref,other_refs,commercial_terms,commercial_limit_cents,created_by_actor_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
  [d.id,c.tenantId,d.channel,d.originRef,d.clientName,d.contactName,d.contactPhone,d.contactEmail,d.serviceDescription,d.location,d.requestedDate,
   d.priority,d.proposalRef,d.contractRef,d.poRef,d.rcRef,d.otherRefs,d.commercialTerms,d.commercialLimitCents??null,c.actorId]);
 await audit(q,c,d.id,d.commandKey,'received',null,{channel:d.channel},requestHash);
 return {ok:true,needId:d.id,status:'received'};
}

export async function listNeeds(q:Query,c:Ctx){
 const role=await memberRole(q,c.tenantId,c.actorId);
 if(!['owner','admin','auditor'].includes(role))throw forbidden('Sua função não permite consultar a fila.');
 const r=await q(`SELECT ${NEED_COLS} FROM svc_needs WHERE tenant_id=$1 ORDER BY
  CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,requested_date,id LIMIT 200`,[c.tenantId]);
 if(await isVerifiedOwner(q,c.tenantId,c.actorId))return r.rows;
 return r.rows.map(row=>{const safe={...row};delete safe.commercialLimitCents;delete safe.commercialTerms;return safe;});
}

export async function needDetail(q:Query,c:Ctx,needId:string){
 const role=await memberRole(q,c.tenantId,c.actorId);
 if(!['owner','admin','auditor'].includes(role))throw forbidden('Sua função não permite consultar a necessidade.');
 const n=await q(`SELECT ${NEED_COLS} FROM svc_needs WHERE tenant_id=$1 AND id=$2`,[c.tenantId,needId]);
 if(!n.rows.length)throw notFound();
 const [events,plan,actual,adds,assign,rel,exec]=await Promise.all([
  q('SELECT event,actor_id AS "actorId",reason,created_at AS "createdAt" FROM svc_need_events WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at,id',[c.tenantId,needId]),
  q('SELECT id,kind,resource_ref AS "resourceRef",quantity_milli::float8 AS "quantityMilli",unit FROM svc_plan_lines WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at,id',[c.tenantId,needId]),
  q('SELECT id,kind,resource_ref AS "resourceRef",quantity_milli::float8 AS "quantityMilli",unit,recorded_by_actor_id AS "recordedByActorId" FROM svc_actual_lines WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at,id',[c.tenantId,needId]),
  q('SELECT id,supersedes_id AS "supersedesId",description,reason,evidence_ref AS "evidenceRef",authorized_by_actor_id AS "authorizedByActorId",created_at AS "createdAt" FROM svc_additionals WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at,id',[c.tenantId,needId]),
  q(`SELECT a.id,a.employee_actor_id AS "employeeActorId",(SELECT array_agg(e.event ORDER BY e.created_at) FROM svc_inbox_events e WHERE e.assignment_id=a.id) AS events
     FROM svc_assignments a WHERE a.tenant_id=$1 AND a.need_id=$2 ORDER BY a.created_at`,[c.tenantId,needId]),
  q('SELECT released_by_actor_id AS "releasedByActorId",released_at AS "releasedAt" FROM svc_releases WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]),
  q('SELECT started_by_actor_id AS "startedByActorId",started_at AS "startedAt" FROM svc_executions WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]),
 ]);
 const verified=await isVerifiedOwner(q,c.tenantId,c.actorId);
 const safeNeed={...n.rows[0]};
 if(!verified){delete safeNeed.commercialLimitCents;delete safeNeed.commercialTerms;}
 const out:Record<string,unknown>={need:safeNeed,events:events.rows,planned:plan.rows,actual:actual.rows,additionals:adds.rows,
  assignments:assign.rows,release:rel.rows[0]??null,execution:exec.rows[0]??null};
 const variance=await q(`WITH planned AS (
   SELECT kind,resource_ref,unit,sum(quantity_milli)::bigint AS planned
   FROM svc_plan_lines WHERE tenant_id=$1 AND need_id=$2
   GROUP BY kind,resource_ref,unit
  ), executed AS (
   SELECT kind,resource_ref,unit,sum(quantity_milli)::bigint AS executed
   FROM svc_actual_lines WHERE tenant_id=$1 AND need_id=$2
   GROUP BY kind,resource_ref,unit
  )
  SELECT COALESCE(p.kind,a.kind) AS kind,
    COALESCE(p.resource_ref,a.resource_ref) AS "resourceRef",
    COALESCE(p.unit,a.unit) AS unit,
    COALESCE(p.planned,0)::text AS "plannedMilli",
    COALESCE(a.executed,0)::text AS "actualMilli",
    (COALESCE(a.executed,0)-COALESCE(p.planned,0))::text AS "varianceMilli"
  FROM planned p FULL OUTER JOIN executed a
   ON p.kind=a.kind AND p.resource_ref=a.resource_ref AND p.unit=a.unit
  ORDER BY 1,2,3`,[c.tenantId,needId]);
 out.executionVariance=variance.rows;

 // Costs and margins are visible only to the authorized owners.
 if(verified){
  const f=await q('SELECT estimated_cost_cents::float8 AS "estimatedCostCents",margin_bps AS "marginBps" FROM svc_need_financials WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]);
  out.financials=f.rows[0]??null;
  const [terms,documents,prices,totals,fieldEvents,requests]=await Promise.all([
   q('SELECT id,pricing_mode AS "pricingMode",global_sale_cents::text AS "globalSaleCents",payment_method AS "paymentMethod",payment_terms AS "paymentTerms",max_quantity_milli::text AS "maxQuantityMilli",max_financial_cents::text AS "maxFinancialCents",customer_rules AS "customerRules",entered_by_actor_id AS "enteredByActorId",created_at AS "createdAt" FROM svc_commercial_terms_versions WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at DESC,id DESC LIMIT 25',[c.tenantId,needId]),
   q('SELECT id,document_type AS "documentType",reference,description,evidence_ref AS "evidenceRef",registered_by_actor_id AS "registeredByActorId",created_at AS "createdAt" FROM svc_commercial_documents WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100',[c.tenantId,needId]),
   q('SELECT p.id,p.supersedes_id AS "supersedesId",p.kind,p.item_ref AS "itemRef",p.quantity_milli::text AS "quantityMilli",p.unit,p.internal_unit_cost_cents::text AS "internalUnitCostCents",p.sale_unit_price_cents::text AS "saleUnitPriceCents",p.recorded_by_actor_id AS "recordedByActorId",p.created_at AS "createdAt",EXISTS(SELECT 1 FROM svc_commercial_price_lines x WHERE x.supersedes_id=p.id) AS superseded FROM svc_commercial_price_lines p WHERE p.tenant_id=$1 AND p.need_id=$2 ORDER BY p.created_at DESC,p.id DESC LIMIT 200',[c.tenantId,needId]),
   q('SELECT COALESCE(sum(round(p.quantity_milli::numeric*p.internal_unit_cost_cents/1000)),0)::text AS "estimatedInternalCostCents",COALESCE(sum(round(p.quantity_milli::numeric*COALESCE(p.sale_unit_price_cents,0)/1000)),0)::text AS "itemizedSaleCents" FROM svc_commercial_price_lines p WHERE p.tenant_id=$1 AND p.need_id=$2 AND NOT EXISTS(SELECT 1 FROM svc_commercial_price_lines s WHERE s.supersedes_id=p.id)',[c.tenantId,needId]),
   q('SELECT id,assignment_id AS "assignmentId",event_type AS "eventType",description,quantity_milli::text AS "quantityMilli",unit,evidence_ref AS "evidenceRef",actor_id AS "actorId",created_at AS "createdAt" FROM svc_field_events WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at DESC,id DESC LIMIT 200',[c.tenantId,needId]),
   q('SELECT r.id,r.assignment_id AS "assignmentId",r.kind,r.description,r.reason,r.quantity_milli::text AS "quantityMilli",r.unit,r.evidence_ref AS "evidenceRef",r.requested_by_actor_id AS "requestedByActorId",r.created_at AS "createdAt",COALESCE(d.decision,\'pending\') AS status,d.reason AS "decisionReason",d.decided_by_actor_id AS "decidedByActorId",d.approved_internal_cost_cents::text AS "approvedInternalCostCents",d.approved_sale_price_cents::text AS "approvedSalePriceCents" FROM svc_additional_requests r LEFT JOIN svc_additional_decisions d ON d.request_id=r.id WHERE r.tenant_id=$1 AND r.need_id=$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 200',[c.tenantId,needId])
  ]);
  out.commercial={terms:terms.rows[0]??null,history:terms.rows,documents:documents.rows,priceLines:prices.rows,totals:totals.rows[0]};
  out.fieldEvents=fieldEvents.rows;out.additionalRequests=requests.rows;
  const [plans,reports]=await Promise.all([
   q('SELECT id,revision,reason,lines,actor_id AS "actorId",correlation_id AS "correlationId",created_at AS "createdAt" FROM svc_plan_revisions WHERE tenant_id=$1 AND need_id=$2 ORDER BY revision DESC LIMIT 25',[c.tenantId,needId]),
   q(`SELECT r.id,r.assignment_id AS "assignmentId",r.summary,r.evidence_ref AS "evidenceRef",r.plan_revision AS "planRevision",
      r.planned_snapshot AS "plannedSnapshot",r.actual_snapshot AS "actualSnapshot",r.submitted_by_actor_id AS "submittedByActorId",
      r.submitted_at AS "submittedAt",COALESCE(v.decision,'pending') AS decision,v.reason AS "reviewReason",
      v.reviewed_by_actor_id AS "reviewedByActorId",v.reviewed_at AS "reviewedAt"
      FROM svc_work_reports r LEFT JOIN svc_work_report_reviews v ON v.report_id=r.id
      WHERE r.tenant_id=$1 AND r.need_id=$2 ORDER BY r.submitted_at DESC,r.id DESC LIMIT 25`,[c.tenantId,needId]),
  ]);
  out.planHistory=plans.rows;out.workReports=reports.rows;
 }
 return out;
}

/** Employee inbox: only this actor's own assignments, no commercial limits/terms/costs. */
export async function employeeInbox(q:Query,c:Ctx){
 await memberRole(q,c.tenantId,c.actorId);
 const link=await q('SELECT professional_id FROM svc_employee_links WHERE tenant_id=$1 AND employee_actor_id=$2',[c.tenantId,c.actorId]);
 if(!link.rows.length)return [];
 const r=await q(`SELECT a.id AS "assignmentId",n.id AS "needId",n.status,n.client_name AS "clientName",n.service_description AS "serviceDescription",
   n.location,n.requested_date AS "requestedDate",n.priority,n.order_id AS "orderId",
   (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',p.kind,'resourceRef',p.resource_ref,'quantityMilli',p.quantity_milli::text,'unit',p.unit) ORDER BY p.created_at,p.id),'[]'::jsonb) FROM svc_plan_lines p WHERE p.tenant_id=n.tenant_id AND p.need_id=n.id) AS planned,
   (SELECT array_agg(e.event ORDER BY e.created_at) FROM svc_inbox_events e WHERE e.assignment_id=a.id) AS events,
   (SELECT jsonb_build_object('reportId',r.id,'submittedAt',r.submitted_at,'status',COALESCE(v.decision,'pending'),'reason',v.reason)
    FROM svc_work_reports r LEFT JOIN svc_work_report_reviews v ON v.report_id=r.id
    WHERE r.tenant_id=n.tenant_id AND r.need_id=n.id AND r.assignment_id=a.id
    ORDER BY r.submitted_at DESC,r.id DESC LIMIT 1) AS "workReview"
  FROM svc_assignments a JOIN svc_needs n ON n.tenant_id=a.tenant_id AND n.id=a.need_id
  WHERE a.tenant_id=$1 AND a.employee_actor_id=$2 ORDER BY a.created_at DESC,a.id LIMIT 200`,[c.tenantId,c.actorId]);
 return r.rows;
}

export async function linkEmployeeProfessional(q:Query,c:Ctx,d:z.infer<typeof linkEmployee>){
 await requireOwner(q,c,'vincular empregados a profissionais');
 const m=await q(`SELECT 1 FROM enterprise_tenant_memberships WHERE tenant_id=$1 AND actor_id=$2 AND status='active'`,[c.tenantId,d.employeeActorId]);
 if(!m.rows.length)throw new ApiError(404,'NOT_FOUND','Empregado não é membro autenticado desta empresa.');
 const p=await q(`SELECT p.id FROM professionals p JOIN cisne_erp_owner_declarations o ON o.identity_actor_id=p.owner_id
  WHERE p.id=$1 AND p.status='active' AND o.identity_state='verified'`,[d.professionalId]);
 if(!p.rows.length)throw new ApiError(404,'NOT_FOUND','Profissional não encontrado no contexto autorizado.');
 try{
  await q(`INSERT INTO svc_employee_links(tenant_id,employee_actor_id,professional_id,linked_by_actor_id) VALUES($1,$2,$3,$4)`,
   [c.tenantId,d.employeeActorId,d.professionalId,c.actorId]);
 }catch(e){
  if(/duplicate key/.test(String((e as Error).message)))throw new ApiError(409,'CONFLICT','Vínculo já existente.');
  throw e;
 }
 return {ok:true};
}

async function ownAssignment(q:Query,c:Ctx,needId:string,assignmentId:string){
 const a=await q('SELECT id FROM svc_assignments WHERE id=$1 AND tenant_id=$2 AND need_id=$3 AND employee_actor_id=$4',[assignmentId,c.tenantId,needId,c.actorId]);
 if(!a.rows.length)throw notFound();
}
/** Authenticated read-only field state for one employee assignment. No prices exposed. */
export async function getServiceFieldState(q:Query,c:Ctx,needId:string,assignmentId:string){
 await memberRole(q,c.tenantId,c.actorId);
 await ownAssignment(q,c,needId,assignmentId);
 const need=await q('SELECT status FROM svc_needs WHERE tenant_id=$1 AND id=$2',[c.tenantId,needId]);
 if(!need.rows.length)throw notFound();
 const last=await q("SELECT event_type,created_at FROM svc_field_events WHERE tenant_id=$1 AND need_id=$2 AND event_type IN ('pause','resume') ORDER BY created_at DESC,id DESC LIMIT 1",[c.tenantId,needId]);
 const paused=last.rows[0]?.event_type==='pause',status=String(need.rows[0].status);
 return {status,paused,canRecordProduction:status==='executing'&&!paused,
  canSubmitReport:status==='executing'&&!paused,
  lastTransition:last.rows[0]?{eventType:String(last.rows[0].event_type),recordedAt:String(last.rows[0].created_at)}:null,
  source:'postgres_tenant_assignment_scoped_field_state',
  policy:'Durante paralisação, ocorrências e evidências de segurança continuam permitidas; produção e medidores exigem retomada. A transação final revalida a permissão.'};
}

async function hasInboxEvent(q:Query,assignmentId:string,event:string){
 return (await q('SELECT 1 FROM svc_inbox_events WHERE assignment_id=$1 AND event=$2',[assignmentId,event])).rows.length>0;
}
async function inbox(q:Query,c:Ctx,assignmentId:string,event:string){
 await q(`INSERT INTO svc_inbox_events(id,tenant_id,assignment_id,employee_actor_id,event,actor_id,correlation_id)
  SELECT gen_random_uuid(),tenant_id,id,employee_actor_id,$2,$3,$4 FROM svc_assignments WHERE id=$1 ON CONFLICT DO NOTHING`,[assignmentId,event,c.actorId,c.correlationId]);
}
function state(need:Record<string,any>,allowed:string[],cmd:string){
 if(!allowed.includes(need.status))throw new ApiError(409,'INVALID_STATE',`Comando ${cmd} não permitido no estado ${need.status}.`);
}

const eventByCommand: Record<z.infer<typeof needCommand>['command'], string> = {
  start_analysis: 'analysis_started',
  approve: 'approved',
  reject: 'rejected',
  convert: 'converted_to_draft_order',
  set_plan: 'plan_set',
  release: 'released',
  assign: 'assigned',
  mark_viewed: 'viewed',
  mark_received: 'received',
  start_execution: 'execution_started',
  record_actual: 'actual_recorded',
  add_additional: 'additional_recorded',
  set_commercial_terms: 'commercial_terms_recorded',
  register_commercial_document: 'commercial_document_registered',
  register_price_line: 'price_line_registered',
  record_field_event: 'field_event_recorded',
  request_additional: 'additional_requested',
  decide_additional: 'additional_decided',
  submit_work_report: 'work_report_submitted',
  review_work_report: 'work_report_reviewed',
};

export async function runNeedCommand(q:Query,c:Ctx,needId:string,cmd:z.infer<typeof needCommand>){
 await memberRole(q,c.tenantId,c.actorId);
 const locked=await q('SELECT * FROM svc_needs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[c.tenantId,needId]);
 if(!locked.rows.length)throw notFound();
 const need=locked.rows[0];
 const requestHash=await fingerprint({scope:'service-need.command',tenantId:c.tenantId,needId,actorId:c.actorId,command:cmd});
 const prior=await replay(q,c,needId,cmd.commandKey,eventByCommand[cmd.command],requestHash);
 if(prior)return prior;
 const log=(event:string,reason:string|null,detail:object={})=>audit(q,c,needId,cmd.commandKey,event,reason,detail,requestHash);
 const setStatus=(s:string)=>q('UPDATE svc_needs SET status=$3,row_version=row_version+1 WHERE tenant_id=$1 AND id=$2',[c.tenantId,needId,s]);
 switch(cmd.command){
  case 'start_analysis':
   await requireOwner(q,c,'analisar necessidades');
   state(need,['received'],cmd.command);
   await setStatus('in_analysis');await log('analysis_started',null);
   return {ok:true,status:'in_analysis'};
  case 'approve':
  case 'reject':{
   await requireOwner(q,c,'aprovar ou rejeitar necessidades');
   state(need,['in_analysis'],cmd.command);
   if(cmd.command==='approve'&&cmd.financials)
    await q('INSERT INTO svc_need_financials(need_id,tenant_id,estimated_cost_cents,margin_bps,recorded_by_actor_id) VALUES($1,$2,$3,$4,$5)',
     [needId,c.tenantId,cmd.financials.estimatedCostCents,cmd.financials.marginBps,c.actorId]);
   const to=cmd.command==='approve'?'approved':'rejected';
   await setStatus(to);await log(to,cmd.reason);
   return {ok:true,status:to};
  }
  case 'convert':{
   await requireOwner(q,c,'converter necessidades em ordens de serviço');
   state(need,['approved'],cmd.command);
   // Only a DRAFT service order is ever created; it needs the existing OS authorization flow afterwards.
   await q(`INSERT INTO service_orders(id,title,client,category,description,due_date,created_at,owner_id,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft')`,
    [cmd.orderId,String(need.service_description).slice(0,120),need.client_name,cmd.category,need.service_description,need.requested_date,new Date().toISOString(),c.actorId]);
   await q(`INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id)
    VALUES($1,$1,'create',1,$2,$3,$4,$1,$5,$6)`,[cmd.orderId,new Date().toISOString(),c.actorId,'svc-need:'+needId,JSON.stringify({ok:true,fromServiceNeed:needId}),c.correlationId]);
   await q('UPDATE svc_needs SET status=$3,order_id=$4,row_version=row_version+1 WHERE tenant_id=$1 AND id=$2',[c.tenantId,needId,'converted',cmd.orderId]);
   await log('converted_to_draft_order',null,{orderId:cmd.orderId});
   return {ok:true,status:'converted',orderId:cmd.orderId,orderStatus:'draft'};
  }
  case 'set_plan':{
   await requireOwner(q,c,'planejar a OS');
   state(need,['converted'],cmd.command);
   const latest=await q('SELECT COALESCE(max(revision),0)::int AS version FROM svc_plan_revisions WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]);
   const revision=Number(latest.rows[0].version)+1;
   if(revision>1&&!cmd.reason)throw new ApiError(400,'VALIDATION_FAILED','A alteração do planejamento exige justificativa auditável.');
   // The mutable working plan is an operational projection, never the historical source of truth.
   // Save the full replacement as an immutable version before updating that projection.
   const snapshot=cmd.lines.map(l=>({kind:l.kind,resourceRef:l.resourceRef,quantityMilli:l.quantityMilli,unit:l.unit}));
   await q(`INSERT INTO svc_plan_revisions(id,tenant_id,need_id,revision,reason,lines,actor_id,correlation_id)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,$5::jsonb,$6,$7)`,[c.tenantId,needId,revision,cmd.reason??'Planejamento inicial',JSON.stringify(snapshot),c.actorId,c.correlationId]);
   await q('DELETE FROM svc_plan_lines WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]);
   for(const l of cmd.lines)
    await q(`INSERT INTO svc_plan_lines(id,tenant_id,need_id,kind,resource_ref,quantity_milli,unit,planned_by_actor_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)`,
     [c.tenantId,needId,l.kind,l.resourceRef,l.quantityMilli,l.unit,c.actorId]);
   await q('UPDATE svc_needs SET row_version=row_version+1 WHERE tenant_id=$1 AND id=$2',[c.tenantId,needId]);
   await log('plan_set',cmd.reason??null,{lines:cmd.lines.length,revision,snapshot});
   return {ok:true,lines:cmd.lines.length,revision};
  }
  case 'release':{
   await requireOwner(q,c,'liberar a execução');
   state(need,['converted'],cmd.command);
   const n=await q('SELECT count(*)::int AS n FROM svc_plan_lines WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]);
   if(!n.rows[0].n)throw new ApiError(409,'INVALID_STATE','Planeje a necessidade antes de liberar.');
   const order=await q('SELECT status FROM service_orders WHERE id=$1 FOR SHARE',[need.order_id]);
   if(order.rows[0]?.status!=='authorized')throw new ApiError(409,'INVALID_STATE','Autorize a OS no fluxo operacional antes de liberar a execução.');
   const terms=await q('SELECT pricing_mode,global_sale_cents,max_financial_cents FROM svc_commercial_terms_versions WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[c.tenantId,needId]);
   if(terms.rows[0]?.pricing_mode==='itemized'){
    const prices=await q('SELECT count(*)::int AS n,count(*) FILTER(WHERE sale_unit_price_cents IS NULL)::int AS missing FROM svc_commercial_price_lines p WHERE tenant_id=$1 AND need_id=$2 AND NOT EXISTS(SELECT 1 FROM svc_commercial_price_lines s WHERE s.supersedes_id=p.id)',[c.tenantId,needId]);
    if(!prices.rows[0]?.n||prices.rows[0]?.missing)throw new ApiError(409,'INVALID_STATE','Regime itemizado exige preços de venda em todas as linhas ativas.');
   }
   const ceilings=[terms.rows[0]?.max_financial_cents,need.commercial_limit_cents]
    .filter((v:unknown)=>v!=null).map((v:unknown)=>BigInt(String(v)));
   const ceiling=ceilings.length?ceilings.reduce((a,b)=>a<b?a:b):null;
   if(terms.rows[0]?.pricing_mode==='global'&&ceiling!=null&&BigInt(terms.rows[0].global_sale_cents)>ceiling)
    throw new ApiError(409,'COMMERCIAL_LIMIT','Preço global excede o limite comercial registrado ou o teto do cliente.');
   if(terms.rows[0]?.pricing_mode==='itemized'&&ceiling!=null){
    const total=await q('SELECT COALESCE(sum(round(p.quantity_milli::numeric*p.sale_unit_price_cents/1000)),0)::text AS total FROM svc_commercial_price_lines p WHERE p.tenant_id=$1 AND p.need_id=$2 AND NOT EXISTS(SELECT 1 FROM svc_commercial_price_lines s WHERE s.supersedes_id=p.id)',[c.tenantId,needId]);
    if(BigInt(total.rows[0].total)>ceiling)
     throw new ApiError(409,'COMMERCIAL_LIMIT','Itens excedem o limite financeiro aprovado ou o teto do cliente.');
   }
   await q('INSERT INTO svc_releases(need_id,tenant_id,released_by_actor_id) VALUES($1,$2,$3)',[needId,c.tenantId,c.actorId]);
   await setStatus('released');await log('released',null);
   return {ok:true,status:'released'};
  }
  case 'assign':{
   await requireOwner(q,c,'atribuir execução');
   state(need,['released'],cmd.command);
   const l=await q('SELECT 1 FROM svc_employee_links WHERE tenant_id=$1 AND employee_actor_id=$2',[c.tenantId,cmd.employeeActorId]);
   if(!l.rows.length)throw new ApiError(409,'INVALID_STATE','Empregado sem vínculo autenticado com profissional.');
   const id=crypto.randomUUID();
   try{await q('INSERT INTO svc_assignments(id,tenant_id,need_id,employee_actor_id,assigned_by_actor_id) VALUES($1,$2,$3,$4,$5)',[id,c.tenantId,needId,cmd.employeeActorId,c.actorId]);}
   catch(e){if(/duplicate key/.test(String((e as Error).message)))throw new ApiError(409,'CONFLICT','Empregado já atribuído.');throw e;}
   await q(`INSERT INTO svc_inbox_events(id,tenant_id,assignment_id,employee_actor_id,event,actor_id,correlation_id) VALUES(gen_random_uuid(),$1,$2,$3,'assigned',$4,$5)`,
    [c.tenantId,id,cmd.employeeActorId,c.actorId,c.correlationId]);
   await log('assigned',null,{assignmentId:id});
   return {ok:true,assignmentId:id};
  }
  case 'mark_viewed':
  case 'mark_received':{
   await ownAssignment(q,c,needId,cmd.assignmentId);
   state(need,['released','executing'],cmd.command);
   const ev=cmd.command==='mark_viewed'?'viewed':'received';
   if(ev==='received'&&!await hasInboxEvent(q,cmd.assignmentId,'viewed'))throw new ApiError(409,'INVALID_STATE','Visualize a atribuição antes de confirmar o recebimento.');
   await inbox(q,c,cmd.assignmentId,ev);
   await log(ev,null,{assignmentId:cmd.assignmentId});
   return {ok:true,event:ev};
  }
  case 'start_execution':{
   await ownAssignment(q,c,needId,cmd.assignmentId);
   state(need,['released'],cmd.command);
   if(!await hasInboxEvent(q,cmd.assignmentId,'received'))throw new ApiError(409,'INVALID_STATE','Confirme o recebimento antes de iniciar a execução.');
   // The employee's confirmed receipt is the only permitted start for an OS
   // created from a service need. Advance both state machines atomically.
   const os=await q('SELECT id,status,version FROM service_orders WHERE id=$1 FOR UPDATE',[need.order_id]);
   if(os.rows[0]?.status!=='authorized')throw new ApiError(409,'INVALID_STATE','A OS deve estar autorizada para iniciar a execução.');
   const nextVersion=Number(os.rows[0].version)+1;
   await q("UPDATE service_orders SET status='executing',version=$2 WHERE id=$1",[need.order_id,nextVersion]);
   await q(`INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id)
    VALUES($1,$2,'start',$3,$4,$5,$6,$2,$7,$8)`,[
    crypto.randomUUID(),need.order_id,nextVersion,new Date().toISOString(),c.actorId,
    'svc-need:'+needId+':'+cmd.commandKey,
    JSON.stringify({ok:true,source:'service_need',assignmentId:cmd.assignmentId}),c.correlationId,
   ]);
   await q('INSERT INTO svc_executions(need_id,tenant_id,started_by_actor_id) VALUES($1,$2,$3)',[needId,c.tenantId,c.actorId]);
   await setStatus('executing');await log('execution_started',null,{assignmentId:cmd.assignmentId});
   return {ok:true,status:'executing',orderStatus:'executing',orderVersion:nextVersion};
  }
  case 'record_actual':{
   await ownAssignment(q,c,needId,cmd.assignmentId);
   state(need,['executing'],cmd.command);
   const lastPause=await q("SELECT event_type FROM svc_field_events WHERE tenant_id=$1 AND need_id=$2 AND event_type IN ('pause','resume') ORDER BY created_at DESC,id DESC LIMIT 1",[c.tenantId,needId]);
   if(lastPause.rows[0]?.event_type==='pause')throw new ApiError(409,'INVALID_STATE','Não é permitido registrar produção durante paralisação.');
   await q(`INSERT INTO svc_actual_lines(id,tenant_id,need_id,kind,resource_ref,quantity_milli,unit,recorded_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [cmd.id,c.tenantId,needId,cmd.line.kind,cmd.line.resourceRef,cmd.line.quantityMilli,cmd.line.unit,c.actorId]);
   await log('actual_recorded',null,{lineId:cmd.id});
   return {ok:true};
  }

  case 'set_commercial_terms':{
   await requireOwner(q,c,'definir condições comerciais');
   state(need,['received','in_analysis','approved','converted'],cmd.command);
   if((cmd.pricingMode==='global')!==(cmd.globalSaleCents!=null))
    throw new ApiError(400,'VALIDATION_FAILED','Preço global obrigatório somente no regime global.');
   await q('INSERT INTO svc_commercial_terms_versions(id,tenant_id,need_id,pricing_mode,global_sale_cents,payment_method,payment_terms,max_quantity_milli,max_financial_cents,customer_rules,entered_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[
    cmd.id,c.tenantId,needId,cmd.pricingMode,cmd.globalSaleCents??null,cmd.paymentMethod,cmd.paymentTerms,
    cmd.maxQuantityMilli??null,cmd.maxFinancialCents??null,cmd.customerRules,c.actorId]);
   await q('UPDATE svc_needs SET row_version=row_version+1 WHERE tenant_id=$1 AND id=$2',[c.tenantId,needId]);
   await log('commercial_terms_recorded',null,{termsId:cmd.id,pricingMode:cmd.pricingMode});
   return {ok:true,termsId:cmd.id,pricingMode:cmd.pricingMode};
  }
  case 'register_commercial_document':{
   await requireOwner(q,c,'vincular documentos comerciais');
   state(need,['received','in_analysis','approved','converted'],cmd.command);
   await validateInternalEvidence(q,c,needId,cmd.evidenceRef,'commercial');
   await q('INSERT INTO svc_commercial_documents(id,tenant_id,need_id,document_type,reference,description,evidence_ref,registered_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[
    cmd.id,c.tenantId,needId,cmd.documentType,cmd.reference,cmd.description,cmd.evidenceRef,c.actorId]);
   await log('commercial_document_registered',null,{documentId:cmd.id,documentType:cmd.documentType,reference:cmd.reference});
   return {ok:true,documentId:cmd.id};
  }
  case 'register_price_line':{
   await requireOwner(q,c,'registrar custo interno e preço de venda');
   state(need,['received','in_analysis','approved','converted'],cmd.command);
   if(cmd.supersedesId){
    const old=await q('SELECT id FROM svc_commercial_price_lines WHERE tenant_id=$1 AND need_id=$2 AND id=$3 AND NOT EXISTS(SELECT 1 FROM svc_commercial_price_lines p WHERE p.supersedes_id=$3)',[c.tenantId,needId,cmd.supersedesId]);
    if(!old.rows.length)throw new ApiError(409,'INVALID_STATE','Linha de preço inexistente ou já substituída.');
   }
   const latest=await q('SELECT pricing_mode,max_quantity_milli FROM svc_commercial_terms_versions WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[c.tenantId,needId]);
   if(latest.rows[0]?.max_quantity_milli!=null&&BigInt(cmd.quantityMilli)>BigInt(latest.rows[0].max_quantity_milli))
    throw new ApiError(409,'COMMERCIAL_LIMIT','Quantidade do item superior ao limite autorizado.');
   if(latest.rows[0]?.pricing_mode==='itemized'&&cmd.saleUnitPriceCents==null)
    throw new ApiError(409,'VALIDATION_FAILED','Operação itemizada exige preço unitário de venda.');
   await q('INSERT INTO svc_commercial_price_lines(id,tenant_id,need_id,supersedes_id,kind,item_ref,quantity_milli,unit,internal_unit_cost_cents,sale_unit_price_cents,recorded_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[
    cmd.id,c.tenantId,needId,cmd.supersedesId??null,cmd.kind,cmd.itemRef,cmd.quantityMilli,cmd.unit,cmd.internalUnitCostCents,cmd.saleUnitPriceCents??null,c.actorId]);
   await log('price_line_registered',null,{lineId:cmd.id,supersedesId:cmd.supersedesId??null,kind:cmd.kind});
   return {ok:true,lineId:cmd.id};
  }
  case 'record_field_event':{
   await ownAssignment(q,c,needId,cmd.assignmentId);
   state(need,['executing'],cmd.command);
   const meter=cmd.eventType==='odometer'||cmd.eventType==='hourmeter';
   if(meter!==Boolean(cmd.quantityMilli!=null&&cmd.unit))
    throw new ApiError(400,'VALIDATION_FAILED','Quilometragem e horímetro exigem valor e unidade; outros eventos não aceitam quantidade.');
   if(['photo','document'].includes(cmd.eventType)&&!cmd.evidenceRef)
    throw new ApiError(400,'VALIDATION_FAILED','Anexe referência verificável à evidência.');
   await validateInternalEvidence(q,c,needId,cmd.evidenceRef,'field',cmd.eventType==='photo');
   const last=await q("SELECT event_type FROM svc_field_events WHERE tenant_id=$1 AND need_id=$2 AND event_type IN ('pause','resume') ORDER BY created_at DESC,id DESC LIMIT 1",[c.tenantId,needId]);
   const paused=last.rows[0]?.event_type==='pause';
   if((cmd.eventType==='pause'&&paused)||(cmd.eventType==='resume'&&!paused))
    throw new ApiError(409,'INVALID_STATE','Transição de paralisação/retomada incompatível com o estado atual.');
   if(paused&&meter)throw new ApiError(409,'OPERATION_PAUSED','Retome a operação antes de registrar medidores de execução.');
   if(meter){
    const previous=await q('SELECT quantity_milli FROM svc_field_events WHERE tenant_id=$1 AND need_id=$2 AND assignment_id=$3 AND event_type=$4 ORDER BY created_at DESC,id DESC LIMIT 1',[c.tenantId,needId,cmd.assignmentId,cmd.eventType]);
    if(previous.rows.length&&BigInt(cmd.quantityMilli!)<BigInt(previous.rows[0].quantity_milli))
     throw new ApiError(409,'INVALID_STATE','Leitura de medidor inferior à anterior. Registre ocorrência para correção auditada.');
   }
   await q('INSERT INTO svc_field_events(id,tenant_id,need_id,assignment_id,event_type,description,quantity_milli,unit,evidence_ref,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[
    cmd.id,c.tenantId,needId,cmd.assignmentId,cmd.eventType,cmd.description,cmd.quantityMilli??null,cmd.unit,cmd.evidenceRef,c.actorId]);
   await log('field_event_recorded',null,{fieldEventId:cmd.id,eventType:cmd.eventType});
   return {ok:true,fieldEventId:cmd.id,eventType:cmd.eventType};
  }
  case 'request_additional':{
   await ownAssignment(q,c,needId,cmd.assignmentId);
   state(need,['executing'],cmd.command);
   await validateInternalEvidence(q,c,needId,cmd.evidenceRef,'field');
   await q('INSERT INTO svc_additional_requests(id,tenant_id,need_id,assignment_id,kind,description,reason,quantity_milli,unit,evidence_ref,requested_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[
    cmd.id,c.tenantId,needId,cmd.assignmentId,cmd.kind,cmd.description,cmd.reason,cmd.quantityMilli,cmd.unit,cmd.evidenceRef,c.actorId]);
   await log('additional_requested',cmd.reason,{requestId:cmd.id,kind:cmd.kind});
   return {ok:true,requestId:cmd.id,status:'pending'};
  }
  case 'decide_additional':{
   await requireOwner(q,c,'autorizar adicionais operacionais');
   state(need,['executing'],cmd.command);
   const requested=await q('SELECT r.id,r.description,r.reason,r.evidence_ref,r.requested_by_actor_id FROM svc_additional_requests r WHERE r.tenant_id=$1 AND r.need_id=$2 AND r.id=$3 AND NOT EXISTS(SELECT 1 FROM svc_additional_decisions d WHERE d.request_id=r.id) FOR UPDATE',[c.tenantId,needId,cmd.requestId]);
   if(!requested.rows.length)throw new ApiError(409,'INVALID_STATE','Solicitação inexistente ou já decidida.');
   const request=requested.rows[0];
   if(cmd.decision==='rejected'&&(cmd.approvedInternalCostCents!=null||cmd.approvedSalePriceCents!=null))
    throw new ApiError(400,'VALIDATION_FAILED','Uma rejeição não pode registrar custos ou preços aprovados.');
   // Additional prices are total amounts, NOT unit rates. Include already
   // approved additions in the same audited commercial ceiling established
   // before release, irrespective of the number of revisions.
   if(cmd.decision==='approved'&&cmd.approvedSalePriceCents!=null){
    const terms=await q('SELECT pricing_mode,global_sale_cents,max_financial_cents FROM svc_commercial_terms_versions WHERE tenant_id=$1 AND need_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[c.tenantId,needId]);
    const boundaries=[terms.rows[0]?.max_financial_cents,need.commercial_limit_cents]
     .filter((v:unknown)=>v!=null).map((v:unknown)=>BigInt(String(v)));
    const max=boundaries.length?boundaries.reduce((a,b)=>a<b?a:b):null;
    if(max!=null){
     const sold=await q('SELECT COALESCE(sum(approved_sale_price_cents),0)::text AS total FROM svc_additional_decisions WHERE tenant_id=$1 AND need_id=$2 AND decision=\'approved\'',[c.tenantId,needId]);
     let baseline=BigInt(terms.rows[0]?.global_sale_cents??0);
     if(terms.rows[0]?.pricing_mode==='itemized'){
      const active=await q('SELECT COALESCE(sum(round(p.quantity_milli::numeric*p.sale_unit_price_cents/1000)),0)::text AS total FROM svc_commercial_price_lines p WHERE p.tenant_id=$1 AND p.need_id=$2 AND NOT EXISTS(SELECT 1 FROM svc_commercial_price_lines s WHERE s.supersedes_id=p.id)',[c.tenantId,needId]);
      baseline=BigInt(active.rows[0].total);
     }
     const finalAmount=baseline+BigInt(sold.rows[0].total)+BigInt(cmd.approvedSalePriceCents);
     if(finalAmount>max)
      throw new ApiError(409,'COMMERCIAL_LIMIT','A aprovação do adicional excederia o limite financeiro comercial.');
    }
   }
   await q('INSERT INTO svc_additional_decisions(request_id,tenant_id,need_id,decision,reason,approved_internal_cost_cents,approved_sale_price_cents,decided_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[
    cmd.requestId,c.tenantId,needId,cmd.decision,cmd.reason,
    cmd.decision==='approved'?cmd.approvedInternalCostCents??null:null,
    cmd.decision==='approved'?cmd.approvedSalePriceCents??null:null,c.actorId]);
   if(cmd.decision==='approved'){
    await q('INSERT INTO svc_additionals(id,tenant_id,need_id,description,reason,evidence_ref,authorized_by_actor_id,recorded_by_actor_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)',[
     c.tenantId,needId,request.description,request.reason,request.evidence_ref,c.actorId,request.requested_by_actor_id]);
   }
   await log('additional_decided',cmd.reason,{requestId:cmd.requestId,decision:cmd.decision});
   return {ok:true,requestId:cmd.requestId,decision:cmd.decision};
  }

  case 'submit_work_report':{
   // Only the real assigned employee can put execution into owner review.
   await ownAssignment(q,c,needId,cmd.assignmentId);
   state(need,['executing'],cmd.command);
   await validateInternalEvidence(q,c,needId,cmd.evidenceRef,'field');
   const paused=await q("SELECT event_type FROM svc_field_events WHERE tenant_id=$1 AND need_id=$2 AND event_type IN ('pause','resume') ORDER BY created_at DESC,id DESC LIMIT 1",[c.tenantId,needId]);
   if(paused.rows[0]?.event_type==='pause')throw new ApiError(409,'INVALID_STATE','Retome a execução antes de solicitar conferência.');
   const pending=await q("SELECT count(*)::int AS n FROM svc_additional_requests r WHERE r.tenant_id=$1 AND r.need_id=$2 AND NOT EXISTS(SELECT 1 FROM svc_additional_decisions d WHERE d.request_id=r.id)",[c.tenantId,needId]);
   if(pending.rows[0].n)throw new ApiError(409,'PENDING_ADDITIONAL','Decida os adicionais pendentes antes da conferência final.');
   const actual=await q(`SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',a.kind,'resourceRef',a.resource_ref,'quantityMilli',a.quantity_milli,'unit',a.unit,'recordedBy',a.recorded_by_actor_id) ORDER BY a.created_at,a.id),'[]'::jsonb) AS lines
     FROM svc_actual_lines a WHERE a.tenant_id=$1 AND a.need_id=$2`,[c.tenantId,needId]);
   const actualLines=actual.rows[0]?.lines??[];
   if(!actualLines.length)throw new ApiError(409,'INVALID_STATE','Registre pelo menos um apontamento real antes do relatório final.');
   const version=await q('SELECT revision,lines FROM svc_plan_revisions WHERE tenant_id=$1 AND need_id=$2 ORDER BY revision DESC LIMIT 1',[c.tenantId,needId]);
   if(!version.rows.length)throw new ApiError(409,'INVALID_STATE','Não existe versão do planejamento para conferência.');
   await q(`INSERT INTO svc_work_reports(id,tenant_id,need_id,assignment_id,summary,evidence_ref,plan_revision,planned_snapshot,actual_snapshot,submitted_by_actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,[
    cmd.id,c.tenantId,needId,cmd.assignmentId,cmd.summary,cmd.evidenceRef,
    version.rows[0].revision,JSON.stringify(version.rows[0].lines),JSON.stringify(actualLines),c.actorId]);
   await setStatus('review_pending');
   await log('work_report_submitted',null,{reportId:cmd.id,assignmentId:cmd.assignmentId,planRevision:version.rows[0].revision});
   return {ok:true,status:'review_pending',reportId:cmd.id};
  }
  case 'review_work_report':{
   await requireOwner(q,c,'conferir e encerrar a execução');
   state(need,['review_pending'],cmd.command);
   const latest=await q('SELECT id FROM svc_work_reports WHERE tenant_id=$1 AND need_id=$2 ORDER BY submitted_at DESC,id DESC LIMIT 1',[c.tenantId,needId]);
   if(!latest.rows.length||String(latest.rows[0].id)!==cmd.reportId)throw new ApiError(409,'INVALID_STATE','A conferência exige o relatório atual.');
   const old=await q('SELECT decision FROM svc_work_report_reviews WHERE report_id=$1',[cmd.reportId]);
   if(old.rows.length)throw new ApiError(409,'INVALID_STATE','O relatório já recebeu decisão.');
   if(cmd.decision==='accepted'){
    const pending=await q("SELECT count(*)::int AS n FROM svc_additional_requests r WHERE r.tenant_id=$1 AND r.need_id=$2 AND NOT EXISTS(SELECT 1 FROM svc_additional_decisions d WHERE d.request_id=r.id)",[c.tenantId,needId]);
    if(pending.rows[0].n)throw new ApiError(409,'PENDING_ADDITIONAL','Há adicionais aguardando decisão administrativa.');
    const os=await q('SELECT status,version FROM service_orders WHERE id=$1 FOR UPDATE',[need.order_id]);
    if(os.rows[0]?.status!=='executing')throw new ApiError(409,'INVALID_STATE','OS canônica não está em execução.');
    const nextVersion=Number(os.rows[0].version)+1;
    await q("UPDATE service_orders SET status='completed',version=$2 WHERE id=$1",[need.order_id,nextVersion]);
    await q(`INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id)
     VALUES($1,$2,'complete',$3,$4,$5,$6,$2,$7,$8)`,[
     crypto.randomUUID(),need.order_id,nextVersion,new Date().toISOString(),c.actorId,
     'svc-need:'+needId+':'+cmd.commandKey,
     JSON.stringify({ok:true,source:'service_need',reportId:cmd.reportId}),c.correlationId,
    ]);
   }
   await q(`INSERT INTO svc_work_report_reviews(report_id,tenant_id,need_id,decision,reason,reviewed_by_actor_id)
    VALUES($1,$2,$3,$4,$5,$6)`,[cmd.reportId,c.tenantId,needId,cmd.decision,cmd.reason,c.actorId]);
   const nextStatus=cmd.decision==='accepted'?'completed':'executing';
   await setStatus(nextStatus);
   await log('work_report_reviewed',cmd.reason,{reportId:cmd.reportId,decision:cmd.decision});
   return {ok:true,status:nextStatus,reportId:cmd.reportId,decision:cmd.decision,readyForMeasurement:cmd.decision==='accepted'};
  }
  case 'add_additional':{
   // Authorization is the act of a verified owner: the caller is the authorizer, never a claimed name.
   await requireOwner(q,c,'registrar adicionais operacionais');
   state(need,['executing'],cmd.command);
   if(cmd.supersedesId){
    const s=await q('SELECT 1 FROM svc_additionals WHERE id=$1 AND tenant_id=$2 AND need_id=$3',[cmd.supersedesId,c.tenantId,needId]);
    if(!s.rows.length)throw notFound();
   }
   await validateInternalEvidence(q,c,needId,cmd.evidenceRef,'field');
   await q(`INSERT INTO svc_additionals(id,tenant_id,need_id,supersedes_id,description,reason,evidence_ref,authorized_by_actor_id,recorded_by_actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,[cmd.id,c.tenantId,needId,cmd.supersedesId??null,cmd.description,cmd.reason,cmd.evidenceRef,c.actorId]);
   await log('additional_recorded',cmd.reason,{additionalId:cmd.id});
   return {ok:true};
  }
 }
}
