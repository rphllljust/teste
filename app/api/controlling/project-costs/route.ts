import {z} from 'zod';
import {database} from '../../../../db/raw';
import {lockFinancePeriodScope,assertFinancePeriodOpen} from '../../../../lib/application/finance';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const amount=z.string().regex(/^[1-9][0-9]{0,9}$/).refine(v=>BigInt(v)<=2147483647n);
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('allocate'),id:uuid,serviceOrderId:uuid,payableId:uuid,
  amountScaled:amount,reference:z.string().trim().min(3).max(160)}).strict(),
 z.object({action:z.literal('reverse'),id:uuid,allocationId:uuid,
  reference:z.string().trim().min(3).max(160)}).strict(),
]);
const filters=z.object({q:z.string().trim().max(120).default(''),
 page:z.coerce.number().int().min(1).max(10000).default(1),orderId:uuid.optional()}).strict();
type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number|null}>;

/** All monetary facts are PostgreSQL integer amounts scaled by 10_000. Report only
 * attributed payable costs, not inferred operating profit, payment or GL expense.
 */
export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const parsed=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtro de custos por operação inválido.');
  const f=parsed.data;
  const data=await database().transaction(async q=>{
   await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   if(f.orderId){
    const owned=await q('SELECT id FROM service_orders WHERE id=$1 AND owner_id=$2',[f.orderId,ctx!.actorId]);
    if(!owned.rows.length)throw new ApiError(404,'NOT_FOUND','Operação indisponível.');
   }
   const where="o.owner_id=$1 AND ($2='' OR o.title ILIKE $2 OR o.client ILIKE $2 OR o.id ILIKE $2)";
   const search=f.q?'%'+f.q+'%':'';
   const count=await q('SELECT count(*)::int AS total FROM service_orders o WHERE '+where,[ctx!.actorId,search]);
   const projects=await q(
    'WITH billed AS (SELECT i.order_id,SUM(i.amount)::bigint amount FROM invoices i '+
      'JOIN service_orders o ON o.id=i.order_id AND o.owner_id=$1 GROUP BY i.order_id),'+
    "cost AS (SELECT service_order_id,SUM(CASE WHEN kind='allocate' THEN amount::bigint ELSE -amount::bigint END) amount "+
     'FROM enterprise_project_cost_allocations WHERE actor_id=$1 GROUP BY service_order_id) '+
    'SELECT o.id,o.title,o.client,o.status,o.contract_id AS "contractId",'+
     'COALESCE(b.amount,0)::text AS "billedScaled",COALESCE(c.amount,0)::text AS "costScaled" '+
    'FROM service_orders o LEFT JOIN billed b ON b.order_id=o.id '+
    'LEFT JOIN cost c ON c.service_order_id=o.id WHERE '+where+
    ' ORDER BY o.created_at DESC,o.id DESC LIMIT 26 OFFSET $3',
    [ctx!.actorId,search,(f.page-1)*25]);
   const payables=await q(
    "WITH allocated AS (SELECT payable_id,SUM(CASE WHEN kind='allocate' THEN amount::bigint "+
     'ELSE -amount::bigint END) amount FROM enterprise_project_cost_allocations '+
     'WHERE actor_id=$1 GROUP BY payable_id) '+
    'SELECT p.id,p.supplier,p.source_reference AS "sourceReference",'+
     'p.amount::text AS "principalScaled",(p.amount::bigint-COALESCE(a.amount,0))::text AS "remainingScaled",'+
     'si.order_id AS "purchaseOrderId",po.reference AS "purchaseOrderReference" '+
    'FROM payables p LEFT JOIN allocated a ON a.payable_id=p.id '+
     'LEFT JOIN procurement_supplier_invoices si ON si.payable_id=p.id AND si.owner_id=p.actor_id '+
     'LEFT JOIN supplier_purchase_orders po ON po.id=si.order_id AND po.owner_id=p.actor_id '+
    'WHERE p.actor_id=$1 AND p.amount::bigint>COALESCE(a.amount,0) '+
    'ORDER BY p.created_at DESC,p.id DESC LIMIT 51',[ctx!.actorId]);
   const allocations=f.orderId?await q(
    'SELECT a.id,a.kind,a.amount::text AS "amountScaled",a.reverses_id AS "reversesId",'+
     'a.reference,a.created_at AS "createdAt",a.payable_id AS "payableId",p.supplier,'+
     'p.source_reference AS "sourceReference",si.order_id AS "purchaseOrderId",'+
     'po.reference AS "purchaseOrderReference",'+
     'EXISTS(SELECT 1 FROM enterprise_project_cost_allocations r WHERE r.reverses_id=a.id) AS reversed '+
    'FROM enterprise_project_cost_allocations a JOIN payables p ON p.id=a.payable_id AND p.actor_id=a.actor_id '+
     'LEFT JOIN procurement_supplier_invoices si ON si.payable_id=p.id AND si.owner_id=p.actor_id '+
     'LEFT JOIN supplier_purchase_orders po ON po.id=si.order_id AND po.owner_id=p.actor_id '+
    'WHERE a.actor_id=$1 AND a.service_order_id=$2 ORDER BY a.created_at DESC,a.id DESC LIMIT 101',
    [ctx!.actorId,f.orderId]):{rows:[]};
   return {total:Number(count.rows[0]?.total??0),projects:projects.rows,payables:payables.rows,allocations:allocations.rows};
  });
  const items=data.projects.slice(0,25).map(row=>({
   ...row,contributionScaled:(BigInt(String(row.billedScaled))-BigInt(String(row.costScaled))).toString()
  }));
  return respond({
   items,pageInfo:{page:f.page,pageSize:25,total:data.total,hasMore:f.page*25<data.total},
   payables:data.payables.slice(0,50),payablesTruncated:data.payables.length>50,
   allocations:data.allocations.slice(0,100),allocationsTruncated:data.allocations.length>100,
   selectedOrderId:f.orderId??null,generatedAt:new Date().toISOString(),
   source:'owned_invoice_totals_and_immutable_payable_cost_attributions',
   warnings:['Atribuição analítica não cria baixa, documento fiscal, diário ou transação bancária.',
    'Receita faturada menos custo atribuído é contribuição parcial, não margem ou lucro final; custos indiretos e de pessoal não estão integrados.',
    'É possível distribuir uma obrigação entre OS até seu valor nominal; reversões mantêm trilha imutável.'],
  },ctx);
 }catch(error){return failure(error,ctx);}
}

/** Atomic owner-scoped cost allocation. Reversal is a new immutable fact. */
export async function POST(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const parsed=command.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando ou valor de atribuição inválido.');
  const v=parsed.data;
  const hash=await fingerprint({actor:ctx.actorId,scope:'project_cost',data:v});
  const result=await database().transaction(async(q:Query)=>{
   await lockFinancePeriodScope(q,ctx!.actorId);
   const prior=await q('SELECT actor_id,request_hash,kind FROM enterprise_project_cost_allocations WHERE id=$1 FOR UPDATE',[v.id]);
   if(prior.rows.length){
    if(prior.rows[0].actor_id!==ctx!.actorId||prior.rows[0].request_hash!==hash||prior.rows[0].kind!==v.action)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de atribuição utilizada em outro comando.');
    return {id:v.id,replayed:true};
   }
   const now=new Date().toISOString();
   await assertFinancePeriodOpen(q,ctx!.actorId,now.slice(0,10));
   let orderId:string,payableId:string,amountScaled:number,reversesId:string|null=null;
   if(v.action==='allocate'){
    orderId=v.serviceOrderId;payableId=v.payableId;amountScaled=Number(v.amountScaled);
    const payable=await q('SELECT id,amount FROM payables WHERE id=$1 AND actor_id=$2 FOR UPDATE',[payableId,ctx!.actorId]);
    const order=await q("SELECT id FROM service_orders WHERE id=$1 AND owner_id=$2 AND status<>'cancelled' FOR SHARE",
     [orderId,ctx!.actorId]);
    if(!payable.rows.length||!order.rows.length)
     throw new ApiError(404,'NOT_FOUND','Operação ativa ou obrigação não pertence à empresa.');
    const used=await q("SELECT COALESCE(SUM(CASE WHEN kind='allocate' THEN amount::bigint ELSE -amount::bigint END),0)::text AS used "+
     'FROM enterprise_project_cost_allocations WHERE actor_id=$1 AND payable_id=$2',[ctx!.actorId,payableId]);
    const available=BigInt(String(payable.rows[0].amount))-BigInt(String(used.rows[0].used));
    if(BigInt(amountScaled)>available)throw new ApiError(409,'COST_ALLOCATION_EXCEEDS_PAYABLE',
     'Atribuição excede o valor nominal não distribuído da obrigação.');
   }else{
    const source=await q("SELECT * FROM enterprise_project_cost_allocations WHERE id=$1 AND actor_id=$2 AND kind='allocate' FOR UPDATE",
     [v.allocationId,ctx!.actorId]);
    if(!source.rows.length)throw new ApiError(404,'NOT_FOUND','Atribuição original não encontrada.');
    const undo=await q('SELECT id FROM enterprise_project_cost_allocations WHERE reverses_id=$1',[v.allocationId]);
    if(undo.rows.length)throw new ApiError(409,'COST_ALLOCATION_REVERSED','Esta atribuição já foi estornada.');
    const row=source.rows[0];
    orderId=String(row.service_order_id);payableId=String(row.payable_id);
    amountScaled=Number(row.amount);reversesId=v.allocationId;
    await q('SELECT id FROM payables WHERE id=$1 AND actor_id=$2 FOR UPDATE',[payableId,ctx!.actorId]);
   }
   await q('INSERT INTO enterprise_project_cost_allocations(id,actor_id,service_order_id,payable_id,'+
    'kind,amount,reverses_id,reference,request_hash,correlation_id,created_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [v.id,ctx!.actorId,orderId,payableId,v.action,amountScaled,reversesId,v.reference,hash,ctx!.correlationId,now]);
   await q('INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) '+
    "VALUES($1,'project_cost_allocation',$2,$3,$4,$5,$6,$7,$8)",
    [crypto.randomUUID(),v.id,v.action==='allocate'?'attributed':'reversed',ctx!.actorId,hash,ctx!.correlationId,
     JSON.stringify({serviceOrderId:orderId,payableId,amountScaled,reversesId}),now]);
   return {id:v.id,state:v.action,serviceOrderId:orderId,payableId,amountScaled:String(amountScaled),replayed:false};
  });
  return respond(result,ctx,result.replayed?200:201);
 }catch(error){return failure(error,ctx);}
}
