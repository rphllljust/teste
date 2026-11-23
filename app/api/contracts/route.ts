import { z } from 'zod';
import { database } from '../../../db/raw';
import {
  ApiError, failure, fingerprint, jsonBody, requestContext, respond,
  type RequestContext,
} from '../../../lib/api/http';
import { contractTerms, projectContract, type ContractRow } from '../../../lib/domain/contracts';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const register=z.object({
  id:uuid,
  proposalId:uuid,
  proposalVersion:z.number().int().positive(),
  purchaseOrderId:uuid.nullable(),
  reference:z.string().trim().min(3).max(160),
  terms:contractTerms,
}).strict();
const filters=z.object({
  q:z.string().trim().max(160).default(''),
  clientId:z.string().uuid().optional(),
  status:z.enum(['','draft','active','closed','cancelled']).default(''),
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(50).default(25),
  sort:z.enum(['recent','reference.asc','reference.desc','startsOn.asc']).default('recent'),
}).strict();

const from=`FROM contracts ct
  JOIN proposals p ON p.id=ct.proposal_id AND p.owner_id=ct.owner_id
  JOIN clients c ON c.id=ct.client_id AND c.owner_id=ct.owner_id
  LEFT JOIN purchase_orders po ON po.id=ct.purchase_order_id AND po.owner_id=ct.owner_id`;
const select=`SELECT ct.*,c.legal_name AS client_name,
  p.title AS proposal_title,po.reference AS po_reference,
  (SELECT count(*)::int FROM service_orders so
   WHERE so.contract_id=ct.id AND so.owner_id=ct.owner_id
   AND so.status NOT IN ('completed','cancelled')) AS open_orders`;
export async function GET(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const params=new URL(request.url).searchParams;
    const parsed=filters.safeParse({
      q:params.get('q')??'',clientId:params.get('clientId')??undefined,status:params.get('status')??'',
      page:params.get('page')??'1',sort:params.get('sort')??'recent',pageSize:params.get('pageSize')??'25',
    });
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros de contratos inválidos.');
    const p=parsed.data,where=['ct.owner_id=?'],values:unknown[]=[context.actorId];
    if(p.clientId){where.push('ct.client_id=?');values.push(p.clientId);}
    if(p.status){where.push('ct.status=?');values.push(p.status);}
    if(p.q){where.push('(ct.reference ILIKE ? OR c.legal_name ILIKE ? OR p.title ILIKE ?)');
      const like='%'+p.q+'%';values.push(like,like,like);}
    const expression=where.join(' AND ');
    const sortOrder=p.sort==='reference.asc'?'ct.reference ASC,ct.id ASC':p.sort==='reference.desc'?'ct.reference DESC,ct.id DESC':p.sort==='startsOn.asc'?'ct.starts_on ASC,ct.id ASC':'ct.created_at DESC,ct.id DESC';
    const [items,totalResult]=await Promise.all([
      database().prepare(`${select} ${from} WHERE ${expression}
        ORDER BY ${sortOrder} LIMIT ? OFFSET ?`)
        .bind(...values,p.pageSize,(p.page-1)*p.pageSize).all<ContractRow>(),
      database().prepare(`SELECT count(*)::int AS total ${from} WHERE ${expression}`)
        .bind(...values).first<{total:number}>(),
    ]);
    const total=totalResult?.total??0;
    return respond({
      items:items.results.map(projectContract),
      pageInfo:{page:p.page,limit:p.pageSize,offset:(p.page-1)*p.pageSize,
        total,sourceTotal:total,hasMore:p.page*p.pageSize<total},
    },context);
  }catch(err){return failure(err,context);}
}

export async function POST(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const parsed=register.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Revise os termos e a origem do contrato.');
    const p=parsed.data;
    const hash=await fingerprint({actorId:context.actorId,action:'registerContract',payload:p});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      // Serialize reference registration for the same ERP owner even when
      // concurrent contracts come from different accepted proposals.
      await query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[context!.actorId]);
      const reserved=await query(
        `INSERT INTO business_commands
         (id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
         VALUES($1,$2,'contract',$3,'register',$4,'',$5,$6)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [p.id,context!.actorId,p.id,hash,context!.correlationId,now],
      );
      if(!reserved.rowCount){
        const replay=await query(
          'SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1',
          [p.id],
        );
        const row=replay.rows[0] as {
          actor_id:string;entity_type:string;entity_id:string;request_hash:string;result:string;
        }|undefined;
        if(!row||row.actor_id!==context!.actorId||row.entity_type!=='contract'||
          row.entity_id!==p.id||row.request_hash!==hash||!row.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador já utilizado em outro contrato.');
        return JSON.parse(row.result) as {resource:{id:string;rowVersion:number}};
      }
      // The proposal lock serializes contract registration from one source.
      const proposalResult=await query(
        'SELECT status,client_id,row_version,evidence_reference FROM proposals WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [p.proposalId,context!.actorId],
      );
      const proposal=proposalResult.rows[0] as {
        status:string;client_id:string;row_version:number;evidence_reference:string|null;
      }|undefined;
      if(!proposal)throw new ApiError(404,'NOT_FOUND','Proposta de origem não encontrada.');
      if(proposal.row_version!==p.proposalVersion)
        throw new ApiError(409,'VERSION_CONFLICT','A proposta mudou. Atualize o contexto comercial.');
      if(proposal.status!=='accepted'||!proposal.evidence_reference)
        throw new ApiError(409,'INVALID_STATE','O contrato exige uma proposta com aceite registrado.');
      const client=await query(
        `SELECT id FROM clients WHERE id=$1 AND owner_id=$2 AND status='active' FOR SHARE`,
        [proposal.client_id,context!.actorId],
      );
      if(!client.rowCount)
        throw new ApiError(409,'CLIENT_NOT_AVAILABLE','O cliente da proposta não está ativo.');
      if(p.purchaseOrderId){
        // PO cancellation obtains the same row lock; neither operation can
        // observe a stale registered status while the other commits.
        const poResult=await query(
          `SELECT proposal_id,client_id,status FROM purchase_orders
           WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
          [p.purchaseOrderId,context!.actorId],
        );
        const po=poResult.rows[0] as {
          proposal_id:string;client_id:string;status:string;
        }|undefined;
        if(!po)throw new ApiError(404,'NOT_FOUND','PO de origem não encontrada.');
        if(po.status!=='registered'||po.proposal_id!==p.proposalId||
          po.client_id!==proposal.client_id)
          throw new ApiError(409,'INVALID_SOURCE','A PO não pertence à proposta ou está cancelada.');
      }
      const duplicate=await query(
        `SELECT id FROM contracts WHERE owner_id=$1
         AND (reference=$2 OR ($3::text IS NOT NULL AND purchase_order_id=$3))
         LIMIT 1`,
        [context!.actorId,p.reference,p.purchaseOrderId],
      );
      if(duplicate.rowCount)
        throw new ApiError(409,'DUPLICATE_CONTRACT','Referência ou PO já vinculada a um contrato.');
      const inserted=await query(
        `INSERT INTO contracts
         (id,owner_id,client_id,proposal_id,purchase_order_id,reference,scope,
          starts_on,ends_on,status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$10)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [p.id,context!.actorId,proposal.client_id,p.proposalId,
          p.purchaseOrderId,p.reference,p.terms.scope,p.terms.startsOn,
          p.terms.endsOn,now],
      );
      if(!inserted.rowCount)
        throw new ApiError(409,'ALREADY_EXISTS','Identificador do contrato já cadastrado.');
      const receipt={ok:true,resource:{type:'contract',id:p.id,rowVersion:1},
        refreshPolicy:['contracts.list','contracts.detail']};
      await query(
        'UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',
        [JSON.stringify(receipt),p.id,context!.actorId],
      );
      return receipt;
    });
    return respond(result,context,201);
  }catch(err){return failure(err,context);}
}
