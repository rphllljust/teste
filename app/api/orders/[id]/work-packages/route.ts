import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,validDate,type RequestContext} from '../../../../../lib/api/http';
import {nextWorkPackageState} from '../../../../../lib/domain/service-order-workplan.mjs';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const day=z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).refine(validDate);
const scaled=z.string().regex(/^(0|[1-9][0-9]{0,17})$/).refine(v=>BigInt(v)<=999999999999999n);
const cost=z.string().regex(/^(0|[1-9][0-9]{0,17})$/).refine(v=>BigInt(v)<=999999999999999999n);
const packageData=z.object({
 reference:z.string().trim().min(3).max(60),
 title:z.string().trim().min(3).max(160),
 description:z.string().trim().max(2000).default(''),
 category:z.enum(['labor','material','equipment','subcontract','milestone']),
 plannedStartOn:day,plannedEndOn:day,
 plannedHoursScaled:scaled,plannedCostScaled:cost,
 responsibleProfessionalId:uuid.nullable().default(null),
 dependsOnId:uuid.nullable().default(null),
}).strict().refine(p=>p.plannedEndOn>=p.plannedStartOn,
 {message:'O término previsto não pode anteceder o início.',path:['plannedEndOn']});
const commands=z.union([
 z.object({action:z.literal('create'),key:uuid,packageId:uuid,data:packageData}).strict(),
 z.object({action:z.literal('revise'),key:uuid,packageId:uuid,expectedVersion:z.number().int().positive(),data:packageData}).strict(),
 z.object({action:z.enum(['ready','start','complete','cancel']),key:uuid,packageId:uuid,
  expectedVersion:z.number().int().positive(),evidenceReference:z.string().trim().max(240).optional(),
  reason:z.string().trim().max(240).optional()}).strict(),
]);
const filters=z.object({
 page:z.coerce.number().int().min(1).max(10000).default(1),
 state:z.enum(['all','draft','ready','in_progress','done','cancelled']).default('all'),
}).strict();
type SQLRow=Record<string,unknown>;
type Query=(sql:string,params?:unknown[])=>Promise<{rows:SQLRow[];rowCount:number|null}>;
const resultOf=(raw:unknown)=>typeof raw==='string'?JSON.parse(raw) as Record<string,unknown>:raw as Record<string,unknown>;
const numberOf=(v:unknown)=>Number(v??0);
const textOf=(v:unknown)=>String(v??'0');
const project=(r:SQLRow)=>({
 id:String(r.id),reference:String(r.reference),title:String(r.title),
 description:String(r.description),category:String(r.category),state:String(r.state),
 plannedStartOn:String(r.planned_start_on),plannedEndOn:String(r.planned_end_on),
 plannedHoursScaled:textOf(r.planned_hours_scaled),plannedCostScaled:textOf(r.planned_cost_scaled),
 dependsOnId:r.depends_on_id?String(r.depends_on_id):null,
 dependencyTitle:r.dependency_title?String(r.dependency_title):null,
 dependencyState:r.dependency_state?String(r.dependency_state):null,
 responsibleProfessionalId:r.responsible_professional_id?String(r.responsible_professional_id):null,
 responsibleName:r.responsible_name?String(r.responsible_name):null,
 rowVersion:numberOf(r.row_version),
 startedAt:r.started_at?String(r.started_at):null,
 completedAt:r.completed_at?String(r.completed_at):null,
 overdue:Boolean(r.overdue),blocked:Boolean(r.blocked),
});
const lockOrder=async(q:Query,id:string,actor:string,forUpdate:boolean)=>{
 const o=await q('SELECT id,status FROM service_orders WHERE id=$1 AND owner_id=$2 '+(forUpdate?'FOR UPDATE':'LIMIT 1'),[id,actor]);
 if(!o.rowCount)throw new ApiError(404,'NOT_FOUND','Ordem de serviço não encontrada no contexto autenticado.');
 return String(o.rows[0].status);
};
const assertPlanRelation=async(q:Query,p: z.infer<typeof packageData>,id:string,actor:string,packageId:string,revise:boolean)=>{
 if(p.dependsOnId===packageId)throw new ApiError(409,'DEPENDENCY_CYCLE','Uma atividade não pode depender de si mesma.');
 if(p.responsibleProfessionalId){
  const person=await q("SELECT id FROM professionals WHERE id=$1 AND owner_id=$2 AND status='active'",[p.responsibleProfessionalId,actor]);
  if(!person.rowCount)throw new ApiError(409,'RESPONSIBLE_UNAVAILABLE','O profissional precisa estar ativo e pertencer à empresa.');
 }
 if(p.dependsOnId){
  const dependency=await q("SELECT id,state FROM enterprise_os_work_packages WHERE id=$1 AND order_id=$2 AND owner_id=$3",
   [p.dependsOnId,id,actor]);
  if(!dependency.rowCount||dependency.rows[0].state==='cancelled')
   throw new ApiError(409,'INVALID_DEPENDENCY','A atividade predecessora precisa pertencer à mesma OS e estar vigente.');
  if(revise){
   // Prevent A→B→C→A even when modifying an existing package.
   const chain=await q(`WITH RECURSIVE ancestors(id,depends_on_id,depth,path) AS (
     SELECT id,depends_on_id,1,ARRAY[id]::text[] FROM enterprise_os_work_packages
      WHERE id=$1 AND owner_id=$2 AND order_id=$3
     UNION ALL
     SELECT next.id,next.depends_on_id,a.depth+1,a.path||next.id
      FROM enterprise_os_work_packages next JOIN ancestors a ON next.id=a.depends_on_id
      WHERE next.owner_id=$2 AND next.order_id=$3 AND a.depth<100
        AND NOT next.id=ANY(a.path)
    ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=$4) AS cycle,
      EXISTS(SELECT 1 FROM ancestors WHERE depth>=100) AS too_deep`,
    [p.dependsOnId,actor,id,packageId]);
   if(chain.rows[0]?.cycle||chain.rows[0]?.too_deep)
    throw new ApiError(409,'DEPENDENCY_CYCLE','A dependência cria um ciclo ou excede o limite seguro de 100 níveis.');
  }
 }
};

/** Owner-scoped, repeatable-read WBS. Aggregate covers ALL tasks, not only page. */
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const {id}=await params;
  if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Ordem inválida.');
  const parsed=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtro de planejamento inválido.');
  const f=parsed.data,actor=ctx.actorId;
  const report=await database().transaction(async q=>{
   await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const orderStatus=await lockOrder(q,id,actor,false);
   const [summary,costs,rows,history,people]=await (async()=>{ return [
    await q(`SELECT COUNT(*)::int AS total,
     COUNT(*) FILTER(WHERE state='done')::int AS done,
     COUNT(*) FILTER(WHERE state='in_progress')::int AS running,
     COUNT(*) FILTER(WHERE state='draft')::int AS drafts,
     COUNT(*) FILTER(WHERE state='cancelled')::int AS cancelled,
     COUNT(*) FILTER(WHERE state NOT IN ('done','cancelled') AND planned_end_on<to_char(CURRENT_DATE,'YYYY-MM-DD'))::int AS overdue,
     COALESCE(SUM(planned_cost_scaled) FILTER(WHERE state<>'cancelled'),0)::text AS budget,
     COALESCE(SUM(planned_hours_scaled) FILTER(WHERE state<>'cancelled'),0)::text AS hours
     FROM enterprise_os_work_packages WHERE order_id=$1 AND owner_id=$2`,[id,actor]),
    await q(`SELECT COALESCE(SUM(CASE WHEN kind='allocate' THEN amount::bigint ELSE -amount::bigint END),0)::text AS actual
     FROM enterprise_project_cost_allocations WHERE service_order_id=$1 AND actor_id=$2`,[id,actor]),
    await q(`SELECT p.*,d.title AS dependency_title,d.state AS dependency_state,prof.name AS responsible_name,
     (p.state NOT IN ('done','cancelled') AND p.planned_end_on<to_char(CURRENT_DATE,'YYYY-MM-DD')) AS overdue,
     (p.depends_on_id IS NOT NULL AND d.state<>'done' AND p.state NOT IN ('done','cancelled')) AS blocked
     FROM enterprise_os_work_packages p
     LEFT JOIN enterprise_os_work_packages d ON d.id=p.depends_on_id AND d.owner_id=p.owner_id AND d.order_id=p.order_id
     LEFT JOIN professionals prof ON prof.id=p.responsible_professional_id AND prof.owner_id=p.owner_id
     WHERE p.owner_id=$2 AND p.order_id=$1 AND ($3='all' OR p.state=$3)
     ORDER BY p.planned_start_on ASC,p.reference ASC,p.id ASC LIMIT 26 OFFSET $4`,
      [id,actor,f.state,(f.page-1)*25]),
    await q(`SELECT e.command,e.version,e.package_id,e.changed_at,e.receipt
     FROM enterprise_os_work_package_events e WHERE e.owner_id=$2 AND e.order_id=$1
     ORDER BY e.changed_at DESC,e.id DESC LIMIT 12`,[id,actor]),
    await q("SELECT id,name FROM professionals WHERE owner_id=$1 AND status='active' ORDER BY name,id LIMIT 51",[actor]),
   ]; })();
   const all=summary.rows[0],planned=BigInt(textOf(all?.budget)),actual=BigInt(textOf(costs.rows[0]?.actual));
   const active=numberOf(all?.total)-numberOf(all?.cancelled);
   return {
    orderId:id,orderStatus,
    items:rows.rows.slice(0,25).map(project),
    pageInfo:{page:f.page,pageSize:25,hasMore:rows.rows.length>25,
     total: f.state==='all'?numberOf(all?.total):null,filter:f.state},
    summary:{total:numberOf(all?.total),active,done:numberOf(all?.done),
     running:numberOf(all?.running),drafts:numberOf(all?.drafts),
     cancelled:numberOf(all?.cancelled),overdue:numberOf(all?.overdue),
     completionRatePercent:active?Math.floor(numberOf(all?.done)*100/active):null,
     plannedCostScaled:String(planned),plannedHoursScaled:textOf(all?.hours),
     attributedCostScaled:String(actual),varianceScaled:String(planned-actual),
     varianceAvailable:planned>0n,unbudgetedActual:planned===0n&&actual>0n},
    history:history.rows.map(e=>({command:String(e.command),version:numberOf(e.version),
     packageId:String(e.package_id),changedAt:String(e.changed_at),receipt:resultOf(e.receipt)})),
    professionals:people.rows.slice(0,50).map(p=>({id:String(p.id),name:String(p.name)})),
    professionalsTruncated:people.rows.length>50,
   };
  });
  return respond({...report,source:'owner_scoped_os_work_packages_and_real_project_cost_attributions',
   warnings:['Planos de atividade não são apontamentos de produção e a conclusão da tarefa não cria medição.',
    'Custos realizados representam somente atribuições analíticas de contas a pagar à OS; horas efetivas e custos indiretos não estão estimados.',
    'A diferença entre orçamento e custos atribuídos não representa lucro, EBITDA, nem certificação contábil.']},ctx);
 }catch(error){return failure(error,ctx);}
}

/** Atomic WBS command; every transition is versioned, idempotent and audited. */
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const {id}=await params;
  if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Ordem inválida.');
  const parsed=commands.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando ou planejamento de atividade inválido.');
  const command=parsed.data,actor=ctx.actorId;
  if(command.action==='complete'&&(!command.evidenceReference||command.evidenceReference.trim().length<8))
   throw new ApiError(400,'EVIDENCE_REQUIRED','Informe a referência documental da conclusão.');
  if(command.action==='cancel'&&(!command.reason||command.reason.trim().length<8))
   throw new ApiError(400,'JUSTIFICATION_REQUIRED','Informe a justificativa do cancelamento.');
  const hash=await fingerprint({actor,orderId:id,command});
  const response=await database().transaction(async q=>{
   const orderStatus=await lockOrder(q,id,actor,true);
   const prior=await q('SELECT owner_id,order_id,request_hash,receipt FROM enterprise_os_work_package_events WHERE id=$1',[command.key]);
   if(prior.rowCount){
    const item=prior.rows[0];
    if(item.owner_id!==actor||item.order_id!==id||item.request_hash!==hash)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Esta chave já pertence a outro comando.');
    return {...resultOf(item.receipt),replayed:true};
   }
   if(orderStatus==='cancelled'||orderStatus==='completed')
    throw new ApiError(409,'INVALID_ORDER_STATE','OS encerrada não aceita alteração de planejamento.');
   const now=new Date().toISOString();
   let version=1,state='draft';
   if(command.action==='create'){
    if(command.packageId===command.data.dependsOnId)
     throw new ApiError(409,'DEPENDENCY_CYCLE','A tarefa não pode depender de si mesma.');
    await assertPlanRelation(q,command.data,id,actor,command.packageId,false);
    const existing=await q('SELECT id FROM enterprise_os_work_packages WHERE id=$1',[command.packageId]);
    if(existing.rowCount)throw new ApiError(409,'PACKAGE_ID_CONFLICT','Identificador da atividade já utilizado.');
    const p=command.data;
    await q(`INSERT INTO enterprise_os_work_packages(
     id,owner_id,order_id,reference,title,description,category,state,
     planned_start_on,planned_end_on,planned_hours_scaled,planned_cost_scaled,
     responsible_professional_id,depends_on_id,row_version,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,1,$14,$14)`,
     [command.packageId,actor,id,p.reference,p.title,p.description,p.category,p.plannedStartOn,
      p.plannedEndOn,p.plannedHoursScaled,p.plannedCostScaled,p.responsibleProfessionalId,p.dependsOnId,now]);
   }else{
    const current=await q('SELECT * FROM enterprise_os_work_packages WHERE id=$1 AND owner_id=$2 AND order_id=$3 FOR UPDATE',
     [command.packageId,actor,id]);
    if(!current.rowCount)throw new ApiError(404,'NOT_FOUND','Atividade não encontrada nesta OS.');
    const row=current.rows[0],prevVersion=numberOf(row.row_version);
    if(prevVersion!==command.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','A atividade mudou. Atualize os dados.');
    version=prevVersion+1;
    state=String(row.state);
    if(command.action==='revise'){
     if(!['draft','ready'].includes(state))
      throw new ApiError(409,'INVALID_STATE','Planejamento não pode ser reescrito após o início da atividade.');
     await assertPlanRelation(q,command.data,id,actor,command.packageId,true);
     const p=command.data;
     await q(`UPDATE enterprise_os_work_packages SET
       reference=$4,title=$5,description=$6,category=$7,
       planned_start_on=$8,planned_end_on=$9,planned_hours_scaled=$10,planned_cost_scaled=$11,
       responsible_professional_id=$12,depends_on_id=$13,row_version=$14,updated_at=$15
       WHERE id=$1 AND owner_id=$2 AND order_id=$3`,
      [command.packageId,actor,id,p.reference,p.title,p.description,p.category,p.plannedStartOn,
       p.plannedEndOn,p.plannedHoursScaled,p.plannedCostScaled,p.responsibleProfessionalId,p.dependsOnId,version,now]);
    }else{
     const dependency=row.depends_on_id?await q('SELECT state FROM enterprise_os_work_packages WHERE id=$1 AND owner_id=$2 AND order_id=$3',
       [row.depends_on_id,actor,id]):null;
     const downstream=command.action==='cancel'?await q(`SELECT id FROM enterprise_os_work_packages
       WHERE depends_on_id=$1 AND owner_id=$2 AND order_id=$3 AND state NOT IN ('cancelled','done') LIMIT 1`,
      [command.packageId,actor,id]):null;
     const verdict=nextWorkPackageState({current:state,command:command.action,orderState:orderStatus,
      dependencyState:dependency?.rows[0]?.state==null?null:String(dependency.rows[0].state),
      hasActiveDependents:Boolean(downstream?.rowCount)});
     if(!verdict.ok)throw new ApiError(409,String(verdict.code),'A transição não é permitida neste estado ou possui dependências abertas.');
     state=verdict.state;
     await q(`UPDATE enterprise_os_work_packages SET state=$4,row_version=$5,updated_at=$6,
       started_at=CASE WHEN $4='in_progress' THEN $6 ELSE started_at END,
       completed_at=CASE WHEN $4='done' THEN $6 ELSE completed_at END,
       cancelled_at=CASE WHEN $4='cancelled' THEN $6 ELSE cancelled_at END
       WHERE id=$1 AND owner_id=$2 AND order_id=$3`,
      [command.packageId,actor,id,state,version,now]);
    }
   }
   const receipt={ok:true,resource:{type:'osWorkPackage',id:command.packageId,
    orderId:id,rowVersion:version,state},action:command.action,
    evidenceReference:command.action==='complete'?command.evidenceReference??null:null,
    justification:command.action==='cancel'?command.reason??null:null,
    refreshPolicy:['service-orders','os-work-packages','operations']};
   await q(`INSERT INTO enterprise_os_work_package_events(
      id,package_id,owner_id,order_id,command,version,actor_id,
      request_hash,correlation_id,receipt,changed_at)
     VALUES($1,$2,$3,$4,$5,$6,$3,$7,$8,$9,$10)`,
     [command.key,command.packageId,actor,id,command.action,version,hash,ctx!.correlationId,JSON.stringify(receipt),now]);
   return {...receipt,replayed:false};
  });
  return respond(response,ctx,response.replayed?200:201);
 }catch(error){
  if(error instanceof Error&&(/enterprise_os_work_packages_owner|cisne_os_package_unique_reference|duplicate key value/i).test(error.message))
   return failure(new ApiError(409,'PACKAGE_CONFLICT','A atividade já existe ou viola a identidade documental.'),ctx);
  return failure(error,ctx);
 }
}
