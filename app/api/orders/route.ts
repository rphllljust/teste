import {database} from '../../../db/raw';
import {z} from 'zod';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,validDate,type RequestContext} from '../../../lib/api/http';
import {previousResult} from '../../../lib/api/idempotency';
import {parseOrders,orderPredicates,orderSort} from '../../../lib/api/query';
import {projectOrder,orderMetrics,type OrderRow} from '../../../lib/projections/orders';
import {commercialToday} from '../../../lib/domain/proposals';
const input=z.object({id:z.string().uuid(),title:z.string().trim().min(3).max(160),client:z.string().trim().min(2).max(200).optional(),category:z.enum(['Locação','Serviços','Transporte','Obra']),description:z.string().trim().max(4000),dueDate:z.string().nullable(),clientId:z.string().uuid(),clientVersion:z.number().int().positive(),contractId:z.string().uuid().optional(),contractVersion:z.number().int().positive().optional()}).strict();
export async function GET(request:Request){let context:RequestContext|undefined;try{context=requestContext(request);const p=parseOrders(request),{where:baseWhere,values:baseValues}=orderPredicates(p),ownerScope=`(owner_id=? OR EXISTS(SELECT 1 FROM svc_needs n
 JOIN cisne_erp_owner_declarations d ON d.identity_actor_id=? AND d.identity_state='verified'
 JOIN enterprise_tenant_memberships m ON m.tenant_id=n.tenant_id AND m.actor_id=d.identity_actor_id AND m.role='owner' AND m.status='active'
 JOIN enterprise_tenants t ON t.id=n.tenant_id AND t.status='active'
 WHERE n.order_id=service_orders.id))`,where=baseWhere+(baseWhere?' AND ':' WHERE ')+ownerScope,values=[...baseValues,context.actorId,context.actorId],db=database();if(p.contractId&&!await db.prepare('SELECT id FROM contracts WHERE id=? AND owner_id=?').bind(p.contractId,context.actorId).first())throw new ApiError(404,'NOT_FOUND','Contrato não encontrado.');if(p.clientId&&!await db.prepare('SELECT id FROM clients WHERE id=? AND owner_id=?').bind(p.clientId,context.actorId).first())throw new ApiError(404,'NOT_FOUND','Cliente não encontrado.');const r=await db.batch([db.prepare('SELECT * FROM service_orders'+where+' ORDER BY '+orderSort(p.sort)+' LIMIT ? OFFSET ?').bind(...values,p.pageSize,(p.page-1)*p.pageSize),db.prepare('SELECT COUNT(*) AS total FROM service_orders'+where).bind(...values),db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS drafts,SUM(CASE WHEN due_date IS NOT NULL THEN 1 ELSE 0 END) AS planned,SUM(CASE WHEN status='completed' AND (NOT EXISTS(SELECT 1 FROM measurements m WHERE m.order_id=service_orders.id AND m.status<>'cancelled') OR EXISTS(SELECT 1 FROM measurements pending WHERE pending.order_id=service_orders.id AND pending.status IN ('draft','submitted')) OR EXISTS(SELECT 1 FROM execution_entries pending WHERE pending.order_id=service_orders.id AND pending.kind='report' AND NOT EXISTS(SELECT 1 FROM execution_entries rev WHERE rev.reverses_id=pending.id) AND NOT EXISTS(SELECT 1 FROM measurements done WHERE done.order_id=service_orders.id AND done.execution_entry_id=pending.id AND done.status<>'cancelled'))) THEN 1 ELSE 0 END) AS \"pendingMeasurements\" FROM service_orders WHERE "+ownerScope).bind(context.actorId,context.actorId)]);const items=(r[0].results as OrderRow[]).map(projectOrder),total=Number((r[1].results[0] as {total:number}).total),rawSummary=r[2].results[0] as {total:number|string;drafts:number|string|null;planned:number|string|null;pendingMeasurements:number|string|null},summary={total:Number(rawSummary.total)||0,drafts:rawSummary.drafts==null?0:Number(rawSummary.drafts)||0,planned:rawSummary.planned==null?0:Number(rawSummary.planned)||0,pendingMeasurements:rawSummary.pendingMeasurements==null?0:Number(rawSummary.pendingMeasurements)||0},generatedAt=new Date().toISOString();return respond({items,orders:items,total,summary,page:p.page,pageSize:p.pageSize,pageInfo:{page:p.page,limit:p.pageSize,offset:(p.page-1)*p.pageSize,total,sourceTotal:summary.total,hasMore:p.page*p.pageSize<total},aggregates:orderMetrics(summary,generatedAt),generatedAt,query:p},context);}catch(error){return failure(error,context);}}
export async function POST(request:Request){let context:RequestContext|undefined;try{context=requestContext(request,true);const parsed=input.safeParse(await jsonBody(request));if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Confira os campos da ordem.');const p=parsed.data;if(p.dueDate&&!validDate(p.dueDate))throw new ApiError(400,'VALIDATION_FAILED','Data prevista inválida.');const hash=await fingerprint({actor:context.actorId,scope:'serviceOrder',command:'create',payload:p});const prior=await previousResult(p.id,hash);if(prior)return respond(prior,context,201);if(p.contractId){
  if(!p.contractVersion||!p.clientVersion)
    throw new ApiError(400,'VALIDATION_FAILED','Versões de cliente e contrato são obrigatórias.');
  // The contract lock is held through insertion of the OS. A concurrent
  // close() obtains FOR UPDATE on the same row and cannot race the INSERT.
  const result=await database().transaction(async query=>{
    const contractRows=await query(
      `SELECT status,row_version,client_id,starts_on,ends_on FROM contracts
       WHERE id=$1 AND owner_id=$2 FOR SHARE`,
      [p.contractId,context!.actorId],
    );
    const contract=contractRows.rows[0] as {
      status:string;row_version:number;client_id:string;starts_on:string;ends_on:string|null;
    }|undefined;
    if(!contract)throw new ApiError(404,'NOT_FOUND','Contrato não encontrado.');
    if(contract.row_version!==p.contractVersion)
      throw new ApiError(409,'VERSION_CONFLICT','Contrato alterado. Atualize o contexto.');
    if(contract.status!=='active'||contract.client_id!==p.clientId)
      throw new ApiError(409,'INVALID_STATE','Contrato indisponível para este cliente.');
    const today=commercialToday();
    if(contract.starts_on>today||(contract.ends_on!==null&&contract.ends_on<today))
      throw new ApiError(409,'OUTSIDE_CONTRACT_TERM','A OS deve respeitar a vigência contratual.');
    if(p.dueDate&&(p.dueDate<contract.starts_on||
      (contract.ends_on!==null&&p.dueDate>contract.ends_on)))
      throw new ApiError(409,'OUTSIDE_CONTRACT_TERM','A data prevista da OS deve respeitar a vigência contratual.');
    const clientRows=await query(
      `SELECT legal_name,row_version,status FROM clients
       WHERE id=$1 AND owner_id=$2 FOR SHARE`,
      [p.clientId,context!.actorId],
    );
    const client=clientRows.rows[0] as {
      legal_name:string;row_version:number;status:string;
    }|undefined;
    if(!client)throw new ApiError(404,'NOT_FOUND','Cliente vinculado não encontrado.');
    if(client.row_version!==p.clientVersion)
      throw new ApiError(409,'VERSION_CONFLICT','Cliente alterado. Atualize o contexto.');
    if(client.status!=='active')
      throw new ApiError(409,'INVALID_STATE','Cliente inativo.');
    const now=new Date().toISOString();
    const receipt={
      id:p.id,ok:true,resource:{type:'serviceOrder',id:p.id,rowVersion:1},
      refreshPolicy:['serviceOrders.worklist'],
    };
    const inserted=await query(
      `INSERT INTO service_orders
       (id,title,client,category,description,due_date,created_at,client_id,owner_id,contract_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO NOTHING RETURNING id`,
      [p.id,p.title,client.legal_name,p.category,p.description,p.dueDate,now,
        p.clientId,context!.actorId,p.contractId],
    );
    if(!inserted.rowCount){
      const previous=await query(
        `SELECT actor_id,request_hash,result FROM order_events
         WHERE id=$1 AND command='create'`,
        [p.id],
      );
      const event=previous.rows[0] as {
        actor_id:string;request_hash:string;result:string;
      }|undefined;
      if(event?.actor_id===context!.actorId&&event.request_hash===hash&&event.result)
        return JSON.parse(event.result) as typeof receipt;
      throw new ApiError(409,'ALREADY_EXISTS','A ordem já existe com outro conteúdo.');
    }
    await query(
      `INSERT INTO order_events
       (id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id)
       VALUES($1,$1,'create',1,$2,$3,$4,$1,$5,$6)`,
      [p.id,now,context!.actorId,hash,JSON.stringify(receipt),context!.correlationId],
    );
    return receipt;
  });
  return respond(result,context,201);
}
let linkedClient:null|{legal_name:string;row_version:number;status:string}=null;if(p.clientId){if(!p.clientVersion)throw new ApiError(400,'VALIDATION_FAILED','Versão do cliente obrigatória.');linkedClient=await database().prepare('SELECT legal_name,row_version,status FROM clients WHERE id=? AND owner_id=?').bind(p.clientId,context.actorId).first();if(!linkedClient)throw new ApiError(404,'NOT_FOUND','Cliente não encontrado.');if(linkedClient.row_version!==p.clientVersion)throw new ApiError(409,'VERSION_CONFLICT','O cliente mudou. Atualize o cadastro.');if(linkedClient.status!=='active')throw new ApiError(409,'INVALID_STATE','O cliente está inativo.');}else if(p.clientVersion)throw new ApiError(400,'VALIDATION_FAILED','Versão sem cliente vinculado.');if(p.contractId){if(!p.contractVersion||!p.clientId)throw new ApiError(400,'VALIDATION_FAILED','Contrato exige cliente e versão.');const c=await database().prepare('SELECT status,row_version,client_id FROM contracts WHERE id=? AND owner_id=?').bind(p.contractId,context.actorId).first<{status:string;row_version:number;client_id:string}>();if(!c)throw new ApiError(404,'NOT_FOUND','Contrato não encontrado.');if(c.row_version!==p.contractVersion)throw new ApiError(409,'VERSION_CONFLICT','Contrato alterado.');if(c.status!=='active'||c.client_id!==p.clientId)throw new ApiError(409,'INVALID_STATE','Contrato não disponível para este cliente.');}else if(p.contractVersion)throw new ApiError(400,'VALIDATION_FAILED','Versão sem contrato.');const now=new Date().toISOString(),result={id:p.id,ok:true,resource:{type:'serviceOrder',id:p.id,rowVersion:1},refreshPolicy:['serviceOrders.worklist']};const r=await database().batch([database().prepare('INSERT INTO service_orders(id,title,client,category,description,due_date,created_at,client_id,owner_id,contract_id) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (CAST(? AS text) IS NULL OR EXISTS(SELECT 1 FROM clients c WHERE c.id=? AND c.owner_id=? AND c.status=\'active\' AND c.row_version=?)) AND (CAST(? AS text) IS NULL OR EXISTS(SELECT 1 FROM contracts ct WHERE ct.id=? AND ct.owner_id=? AND ct.row_version=? AND ct.status=\'active\' AND ct.client_id=?)) ON CONFLICT(id) DO NOTHING').bind(p.id,p.title,linkedClient!.legal_name,p.category,p.description,p.dueDate,now,p.clientId??null,context.actorId,p.contractId??null,p.clientId??null,p.clientId??null,context.actorId,p.clientVersion??null,p.contractId??null,p.contractId??null,context.actorId,p.contractVersion??null,p.clientId??null),database().prepare('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id) SELECT id,id,?,1,?,?,?,?,?,? FROM service_orders WHERE id=? AND changes()=1').bind('create',now,context.actorId,hash,p.id,JSON.stringify(result),context.correlationId,p.id)]);if(!r[0].meta.changes){const replay=await previousResult(p.id,hash);if(replay)return respond(replay,context,201);throw new ApiError(409,'VERSION_CONFLICT','Esta ordem já existe. Atualize a fila.');}return respond(result,context,201);}catch(error){return failure(error,context);}}
