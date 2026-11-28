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
 z.object({...base,command:z.literal('convert'),orderId:uuid}).strict(),
 z.object({...base,command:z.literal('set_plan'),lines:z.array(line).min(1).max(100)}).strict(),
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
 return r.rows;
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
 const out:Record<string,unknown>={need:n.rows[0],events:events.rows,planned:plan.rows,actual:actual.rows,additionals:adds.rows,
  assignments:assign.rows,release:rel.rows[0]??null,execution:exec.rows[0]??null};
 // Costs and margins are visible only to the authorized owners.
 if(await isVerifiedOwner(q,c.tenantId,c.actorId)){
  const f=await q('SELECT estimated_cost_cents::float8 AS "estimatedCostCents",margin_bps AS "marginBps" FROM svc_need_financials WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]);
  out.financials=f.rows[0]??null;
 }
 return out;
}

/** Employee inbox: only this actor's own assignments, no commercial limits/terms/costs. */
export async function employeeInbox(q:Query,c:Ctx){
 await memberRole(q,c.tenantId,c.actorId);
 const link=await q('SELECT professional_id FROM svc_employee_links WHERE tenant_id=$1 AND employee_actor_id=$2',[c.tenantId,c.actorId]);
 if(!link.rows.length)return [];
 const r=await q(`SELECT a.id AS "assignmentId",n.id AS "needId",n.status,n.client_name AS "clientName",n.service_description AS "serviceDescription",
   n.location,n.requested_date AS "requestedDate",n.priority,
   (SELECT array_agg(e.event ORDER BY e.created_at) FROM svc_inbox_events e WHERE e.assignment_id=a.id) AS events
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
    VALUES($1,$2,$3,'service',$4,$5,$6,$7,'draft')`,
    [cmd.orderId,String(need.service_description).slice(0,120),need.client_name,need.service_description,need.requested_date,new Date().toISOString(),c.actorId]);
   await q(`INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id)
    VALUES($1,$1,'create',1,$2,$3,$4,$1,$5,$6)`,[cmd.orderId,new Date().toISOString(),c.actorId,'svc-need:'+needId,JSON.stringify({ok:true,fromServiceNeed:needId}),c.correlationId]);
   await q('UPDATE svc_needs SET status=$3,order_id=$4,row_version=row_version+1 WHERE tenant_id=$1 AND id=$2',[c.tenantId,needId,'converted',cmd.orderId]);
   await log('converted_to_draft_order',null,{orderId:cmd.orderId});
   return {ok:true,status:'converted',orderId:cmd.orderId,orderStatus:'draft'};
  }
  case 'set_plan':{
   await requireOwner(q,c,'planejar a OS');
   state(need,['converted'],cmd.command);
   await q('DELETE FROM svc_plan_lines WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]);
   for(const l of cmd.lines)
    await q(`INSERT INTO svc_plan_lines(id,tenant_id,need_id,kind,resource_ref,quantity_milli,unit,planned_by_actor_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)`,
     [c.tenantId,needId,l.kind,l.resourceRef,l.quantityMilli,l.unit,c.actorId]);
   await log('plan_set',null,{lines:cmd.lines.length});
   return {ok:true,lines:cmd.lines.length};
  }
  case 'release':{
   await requireOwner(q,c,'liberar a execução');
   state(need,['converted'],cmd.command);
   const n=await q('SELECT count(*)::int AS n FROM svc_plan_lines WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,needId]);
   if(!n.rows[0].n)throw new ApiError(409,'INVALID_STATE','Planeje a necessidade antes de liberar.');
   const order=await q('SELECT status FROM service_orders WHERE id=$1 FOR SHARE',[need.order_id]);
   if(order.rows[0]?.status!=='authorized')throw new ApiError(409,'INVALID_STATE','Autorize a OS no fluxo operacional antes de liberar a execução.');
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
   await q(`INSERT INTO svc_actual_lines(id,tenant_id,need_id,kind,resource_ref,quantity_milli,unit,recorded_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [cmd.id,c.tenantId,needId,cmd.line.kind,cmd.line.resourceRef,cmd.line.quantityMilli,cmd.line.unit,c.actorId]);
   await log('actual_recorded',null,{lineId:cmd.id});
   return {ok:true};
  }
  case 'add_additional':{
   // Authorization is the act of a verified owner: the caller is the authorizer, never a claimed name.
   await requireOwner(q,c,'registrar adicionais operacionais');
   state(need,['executing'],cmd.command);
   if(cmd.supersedesId){
    const s=await q('SELECT 1 FROM svc_additionals WHERE id=$1 AND tenant_id=$2 AND need_id=$3',[cmd.supersedesId,c.tenantId,needId]);
    if(!s.rows.length)throw notFound();
   }
   await q(`INSERT INTO svc_additionals(id,tenant_id,need_id,supersedes_id,description,reason,evidence_ref,authorized_by_actor_id,recorded_by_actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,[cmd.id,c.tenantId,needId,cmd.supersedesId??null,cmd.description,cmd.reason,cmd.evidenceRef,c.actorId]);
   await log('additional_recorded',cmd.reason,{additionalId:cmd.id});
   return {ok:true};
  }
 }
}
