import {z} from 'zod';
import {ApiError,fingerprint} from '../api/http';
import {memberRole,isVerifiedOwner,type Query} from './service-needs';

type Context={tenantId:string;needId:string;actorId:string;correlationId:string};
const uuid=z.string().uuid();
export const prepareServiceMeasurementInput=z.object({
 id:uuid,commandKey:uuid,description:z.string().trim().min(10).max(1000),
 amountCents:z.number().int().positive().max(2147483647),
}).strict();
export const approveServiceMeasurementInput=z.object({
 commandKey:uuid,reason:z.string().trim().min(3).max(1000),
 expectedVersion:z.literal(1),
}).strict();
type Prepare=z.infer<typeof prepareServiceMeasurementInput>;
type Approve=z.infer<typeof approveServiceMeasurementInput>;

const notFound=()=>new ApiError(404,'NOT_FOUND','Registro não encontrado no contexto autorizado.');
async function requireController(q:Query,c:Context){
 await memberRole(q,c.tenantId,c.actorId);
 if(!await isVerifiedOwner(q,c.tenantId,c.actorId))
  throw new ApiError(403,'FORBIDDEN','A medição e o faturamento exigem controlador verificado.');
}
async function replay(q:Query,c:Context,key:string,event:string,hash:string){
 const r=await q('SELECT need_id,event,actor_id,request_hash,detail FROM svc_need_events WHERE tenant_id=$1 AND command_key=$2',[c.tenantId,key]);
 if(!r.rows.length)return null;
 const row=r.rows[0];
 if(String(row.need_id)!==c.needId||row.actor_id!==c.actorId||row.event!==event||row.request_hash!==hash)
  throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave usada com outro comando, ator ou conteúdo.');
 return row.detail as Record<string,unknown>;
}
async function log(q:Query,c:Context,key:string,event:string,requestHash:string,reason:string|null,detail:Record<string,unknown>){
 await q(`INSERT INTO svc_need_events(id,tenant_id,need_id,command_key,event,actor_id,reason,detail,correlation_id,request_hash)
 VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,[
  c.tenantId,c.needId,key,event,c.actorId,reason,JSON.stringify(detail),c.correlationId,requestHash,
 ]);
}
async function lockNeed(q:Query,c:Context){
 const r=await q('SELECT id,status,order_id,client_name,proposal_ref,contract_ref,po_ref,rc_ref,commercial_limit_cents FROM svc_needs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[c.tenantId,c.needId]);
 if(!r.rows.length)throw notFound();
 return r.rows[0];
}

/** This is a priced, auditable bridge; no measurement may be invented from
 * a draft order or unreviewed field report. All cents use integers only. */
export async function prepareServiceMeasurement(q:Query,c:Context,p:Prepare){
 await requireController(q,c);
 const need=await lockNeed(q,c);
 const hash=await fingerprint({scope:'svc.measurement.prepare',tenantId:c.tenantId,needId:c.needId,actorId:c.actorId,payload:p});
 const prior=await replay(q,c,p.commandKey,'measurement_prepared',hash);
 if(prior)return {ok:true,replayed:true,measurementId:String(prior.measurementId),status:'draft'};
 if(need.status!=='completed'||!need.order_id)
  throw new ApiError(409,'INVALID_STATE','Somente a OS concluída com aceite de campo pode ser medida.');
 const canonical=await q('SELECT status FROM service_orders WHERE id=$1 FOR SHARE',[need.order_id]);
 if(canonical.rows[0]?.status!=='completed')throw new ApiError(409,'INVALID_STATE','OS canônica não está concluída.');
 const exists=await q('SELECT measurement_id FROM svc_measurement_links WHERE tenant_id=$1 AND need_id=$2',[c.tenantId,c.needId]);
 if(exists.rows.length)throw new ApiError(409,'ALREADY_MEASURED','A OS já possui medição vinculada. Não duplique cobrança.');
 const historical=await q('SELECT 1 FROM measurements WHERE order_id=$1 LIMIT 1',[need.order_id]);
 if(historical.rows.length)throw new ApiError(409,'ALREADY_MEASURED','Há medição legada desta OS; regularize antes de criar outra para evitar cobrança duplicada.');
 const reports=await q(`SELECT r.id,r.actual_snapshot,r.plan_revision,r.planned_snapshot
 FROM svc_work_reports r JOIN svc_work_report_reviews v
 ON v.report_id=r.id AND v.tenant_id=r.tenant_id AND v.need_id=r.need_id AND v.decision='accepted'
 WHERE r.tenant_id=$1 AND r.need_id=$2 ORDER BY r.submitted_at DESC,r.id DESC LIMIT 1`,[c.tenantId,c.needId]);
 if(!reports.rows.length)throw new ApiError(409,'INVALID_STATE','Nenhum relatório de campo foi aceito.');
 const report=reports.rows[0];
 const terms=await q(`SELECT pricing_mode,global_sale_cents,max_financial_cents,max_quantity_milli,payment_method,payment_terms,customer_rules
 FROM svc_commercial_terms_versions WHERE tenant_id=$1 AND need_id=$2
 ORDER BY created_at DESC,id DESC LIMIT 1`,[c.tenantId,c.needId]);
 const commercial=terms.rows[0];
 if(!commercial||!['global','itemized'].includes(commercial.pricing_mode))
  throw new ApiError(409,'COMMERCIAL_NOT_READY','Registre preço global ou linhas comerciais aprovadas antes da medição.');
 let base=0n;
 if(commercial.pricing_mode==='global')base=BigInt(commercial.global_sale_cents??0);
 else{
  const sums=await q(`SELECT count(*)::int AS quantity,
   count(*) FILTER(WHERE p.sale_unit_price_cents IS NULL)::int AS missing,
   COALESCE(sum(round(p.quantity_milli::numeric*p.sale_unit_price_cents/1000)),0)::text AS total
   FROM svc_commercial_price_lines p
   WHERE p.tenant_id=$1 AND p.need_id=$2 AND NOT EXISTS
    (SELECT 1 FROM svc_commercial_price_lines s WHERE s.supersedes_id=p.id)`,[c.tenantId,c.needId]);
  if(!sums.rows[0]?.quantity||sums.rows[0]?.missing)
   throw new ApiError(409,'COMMERCIAL_NOT_READY','Linhas itemizadas sem preços de venda definidos.');
  base=BigInt(sums.rows[0].total);
 }
 const extras=await q(`SELECT COALESCE(sum(approved_sale_price_cents),0)::text AS total,
 count(*) FILTER(WHERE approved_sale_price_cents IS NULL)::int AS unpriced
 FROM svc_additional_decisions WHERE tenant_id=$1 AND need_id=$2 AND decision='approved'`,[c.tenantId,c.needId]);
 const additions=BigInt(extras.rows[0]?.total??0),pricedCeiling=base+additions;
 if(pricedCeiling<=0n)throw new ApiError(409,'COMMERCIAL_NOT_READY','Preço autorizado deve ser positivo.');
 let limit=pricedCeiling;
 if(commercial.max_financial_cents!=null && BigInt(commercial.max_financial_cents)<limit)limit=BigInt(commercial.max_financial_cents);
 if(need.commercial_limit_cents!=null&&BigInt(need.commercial_limit_cents)<limit)limit=BigInt(need.commercial_limit_cents);
 if(BigInt(p.amountCents)>limit)
  throw new ApiError(409,'COMMERCIAL_LIMIT','Medição superior ao valor comercial autorizado e aos limites de cliente.');
 const snapshot={
  pricingMode:String(commercial.pricing_mode),baseSaleCents:String(base),
  approvedAdditionalSaleCents:String(additions),unpricedAdditionalCount:Number(extras.rows[0]?.unpriced??0),
  authorizedCeilingCents:String(limit),measuredCents:String(p.amountCents),
  proposalRef:need.proposal_ref,contractRef:need.contract_ref,poRef:need.po_ref,rcRef:need.rc_ref,
  clientName:need.client_name,planRevision:Number(report.plan_revision),reportId:String(report.id),
  paymentMethod:commercial.payment_method,paymentTerms:commercial.payment_terms,
 };
 const now=new Date().toISOString();
 await q(`INSERT INTO measurements(id,order_id,description,amount,status,version,created_at)
 VALUES($1,$2,$3,$4,'draft',1,$5)`,[p.id,need.order_id,p.description,p.amountCents,now]);
 await q(`INSERT INTO svc_measurement_links(id,tenant_id,need_id,report_id,measurement_id,commercial_snapshot,executed_snapshot,proposed_amount_cents,created_by_actor_id,correlation_id)
 VALUES(gen_random_uuid(),$1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`,[
  c.tenantId,c.needId,report.id,p.id,JSON.stringify(snapshot),JSON.stringify(report.actual_snapshot),
  p.amountCents,c.actorId,c.correlationId,
 ]);
 const result={ok:true,measurementId:p.id,status:'draft',amountCents:p.amountCents,authorizedCeilingCents:String(limit)};
 await q(`INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id)
 VALUES($1,$2,'measure',1,$3,$4,$5,$6,$7,$8)`,[p.commandKey,need.order_id,now,c.actorId,hash,p.id,JSON.stringify(result),c.correlationId]);
 await log(q,c,p.commandKey,'measurement_prepared',hash,null,{measurementId:p.id,reportId:report.id,amountCents:p.amountCents});
 return result;
}

export async function approveServiceMeasurement(q:Query,c:Context,measurementId:string,p:Approve){
 await requireController(q,c);
 const need=await lockNeed(q,c);
 const hash=await fingerprint({scope:'svc.measurement.approve',tenantId:c.tenantId,needId:c.needId,actorId:c.actorId,measurementId,payload:p});
 const prior=await replay(q,c,p.commandKey,'measurement_approved',hash);
 if(prior)return {ok:true,replayed:true,measurementId:String(prior.measurementId),status:'approved'};
 if(need.status!=='completed')throw new ApiError(409,'INVALID_STATE','A OS deve estar concluída.');
 const rows=await q(`SELECT m.status,m.version,l.created_by_actor_id,l.report_id,l.proposed_amount_cents
 FROM svc_measurement_links l JOIN measurements m ON m.id=l.measurement_id
 WHERE l.tenant_id=$1 AND l.need_id=$2 AND l.measurement_id=$3 FOR UPDATE OF m`,[c.tenantId,c.needId,measurementId]);
 if(!rows.rows.length)throw notFound();
 const m=rows.rows[0];
 if(m.created_by_actor_id===c.actorId)
  throw new ApiError(403,'FOUR_EYES_REQUIRED','Outro controlador verificado deve aprovar a medição.');
 if(m.status!=='draft'||Number(m.version)!==p.expectedVersion)
  throw new ApiError(409,'VERSION_CONFLICT','A medição já foi alterada ou aprovada.');
 const now=new Date().toISOString();
 await q(`INSERT INTO svc_measurement_approvals(id,measurement_id,tenant_id,need_id,reason,approved_by_actor_id,correlation_id)
 VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,[measurementId,c.tenantId,c.needId,p.reason,c.actorId,c.correlationId]);
 await q("UPDATE measurements SET status='approved',version=version+1 WHERE id=$1 AND status='draft' AND version=1",[measurementId]);
 const result={ok:true,measurementId,status:'approved',version:2};
 await q(`INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id)
 VALUES($1,$2,'approve_measurement',2,$3,$4,$5,$6,$7,$8)`,[p.commandKey,need.order_id,now,c.actorId,hash,measurementId,JSON.stringify(result),c.correlationId]);
 await log(q,c,p.commandKey,'measurement_approved',hash,p.reason,{measurementId,version:2});
 return result;
}

export async function getServiceMeasurementDossier(q:Query,c:Context){
 await requireController(q,c);
 const need=await q('SELECT status,order_id FROM svc_needs WHERE tenant_id=$1 AND id=$2',[c.tenantId,c.needId]);
 if(!need.rows.length)throw notFound();
 const rows=await q(`SELECT l.measurement_id AS "measurementId",l.report_id AS "reportId",
 l.created_by_actor_id AS "preparedByActorId",l.created_at AS "preparedAt",
 l.commercial_snapshot AS "commercialSnapshot",l.executed_snapshot AS "executedSnapshot",
 m.description,m.amount AS "amountCents",m.status,m.version,
 a.approved_by_actor_id AS "approvedByActorId",a.reason AS "approvalReason",a.approved_at AS "approvedAt",
 i.id AS "invoiceId",i.amount AS "invoiceAmountCents",i.due_date AS "dueDate",
 rec.id AS "receivableId",rec.amount AS "receivableAmountCents",
 COALESCE((SELECT sum(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END)
 FROM receivable_settlements s WHERE s.receivable_id=rec.id),0)::bigint AS "settledCents"
 FROM svc_measurement_links l JOIN measurements m ON m.id=l.measurement_id
 LEFT JOIN svc_measurement_approvals a ON a.measurement_id=m.id
 LEFT JOIN invoices i ON i.measurement_id=m.id
 LEFT JOIN receivables rec ON rec.invoice_id=i.id
 WHERE l.tenant_id=$1 AND l.need_id=$2 ORDER BY l.created_at DESC,l.id DESC`,[c.tenantId,c.needId]);
 return {status:String(need.rows[0].status),orderId:need.rows[0].order_id,measurements:rows.rows};
}
