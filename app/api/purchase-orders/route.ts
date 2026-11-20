import { z } from 'zod';
import { database } from '../../../db/raw';
import {
  ApiError,failure,fingerprint,jsonBody,requestContext,respond,validDate,type RequestContext,
} from '../../../lib/api/http';
import {commercialToday} from '../../../lib/domain/proposals';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const create=z.object({
  id:uuid,proposalId:uuid,proposalVersion:z.number().int().positive(),
  reference:z.string().trim().min(3).max(160),
  receivedDate:z.string().refine(validDate),
}).strict();
const query=z.object({
  q:z.string().max(160).default(''),proposalId:z.union([uuid,z.literal('')]).default(''),
  status:z.enum(['','registered','cancelled']).default(''),
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(50).default(25),
  sort:z.enum(['recent','reference.asc','reference.desc','receivedDate.asc']).default('recent'),
}).strict();

type PORow={
  id:string;owner_id:string;client_id:string;proposal_id:string;
  reference:string;received_date:string;status:string;row_version:number;
  cancel_reason:string|null;created_at:string;
  client_name:string;proposal_title:string;proposal_total:number;
};
export function projectCustomerPO(r:PORow,allowCancel=true){
  return {
    id:r.id,reference:r.reference,receivedDate:r.received_date,
    clientId:r.client_id,clientName:r.client_name,
    proposalId:r.proposal_id,proposalTitle:r.proposal_title,
    proposalTotalScaled:String(r.proposal_total),cancelReason:r.cancel_reason,
    state:{code:r.status,label:r.status==='registered'?'Registrada':'Cancelada',
      rowVersion:r.row_version},
    availableCommands:allowCancel&&r.status==='registered'?
      [{id:'cancel',label:'Cancelar pedido recebido',expectedVersion:r.row_version}]:[],
    createdAt:r.created_at,
  };
}

export async function GET(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const sp=new URL(request.url).searchParams;
    const parsed=query.safeParse({
      q:sp.get('q')??'',proposalId:sp.get('proposalId')??'',
      status:sp.get('status')??'',page:sp.get('page')??'1',
      sort:sp.get('sort')??'recent',
      pageSize:sp.get('pageSize')??'25',
    });
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros de pedidos inválidos.');
    const p=parsed.data,terms=['po.owner_id=?'],bind:unknown[]=[context.actorId];
    if(p.proposalId){terms.push('po.proposal_id=?');bind.push(p.proposalId);}
    if(p.status){terms.push('po.status=?');bind.push(p.status);}
    if(p.q.trim()){
      terms.push('(po.reference ILIKE ? OR c.legal_name ILIKE ? OR p.title ILIKE ?)');
      const pat='%'+p.q.trim()+'%';bind.push(pat,pat,pat);
    }
    const where=terms.join(' AND ');
    const sortOrder=p.sort==='reference.asc'?'po.reference ASC,po.id ASC':p.sort==='reference.desc'?'po.reference DESC,po.id DESC':p.sort==='receivedDate.asc'?'po.received_date ASC,po.id ASC':'po.created_at DESC,po.id DESC';
    const joined=`FROM purchase_orders po
      JOIN proposals p ON p.id=po.proposal_id AND p.owner_id=po.owner_id
      JOIN clients c ON c.id=po.client_id AND c.owner_id=po.owner_id`;
    const [list,counts]=await Promise.all([
      database().prepare(`SELECT po.*,p.title AS proposal_title,p.total AS proposal_total,
        c.legal_name AS client_name
        ${joined} WHERE ${where}
        ORDER BY ${sortOrder} LIMIT ? OFFSET ?`)
        .bind(...bind,p.pageSize,(p.page-1)*p.pageSize).all<PORow>(),
      database().prepare(`SELECT count(*)::int AS total ${joined} WHERE ${where}`)
        .bind(...bind).first<{total:number}>(),
    ]);
    const total=counts?.total??0;
    return respond({items:list.results.map(x=>projectCustomerPO(x,false)),
      pageInfo:{page:p.page,limit:p.pageSize,offset:(p.page-1)*p.pageSize,
        total,sourceTotal:total,hasMore:p.page*p.pageSize<total}},context);
  }catch(err){return failure(err,context);}
}

export async function POST(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const parsed=create.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Revise os dados do pedido do cliente.');
    const po=parsed.data;
    if(po.receivedDate>commercialToday())
      throw new ApiError(400,'VALIDATION_FAILED','Data de recebimento não pode estar no futuro.');
    const hash=await fingerprint({actorId:context.actorId,kind:'customerPO',payload:po});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      const receipt=await query(
        `INSERT INTO business_commands
         (id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
         VALUES($1,$2,'purchaseOrder',$3,'register',$4,'',$5,$6)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [po.id,context!.actorId,po.id,hash,context!.correlationId,now],
      );
      if(!receipt.rowCount){
        const prior=await query(
          'SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1',
          [po.id],
        );
        const row=prior.rows[0] as {
          actor_id:string;entity_type:string;entity_id:string;request_hash:string;result:string;
        }|undefined;
        if(!row||row.actor_id!==context!.actorId||row.entity_type!=='purchaseOrder'||
          row.entity_id!==po.id||row.request_hash!==hash||!row.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador do pedido já utilizado.');
        return JSON.parse(row.result) as {resource:{id:string}};
      }
      const r=await query(
        `SELECT id,client_id,status,row_version,evidence_reference
         FROM proposals WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [po.proposalId,context!.actorId],
      );
      const proposal=r.rows[0] as {
        id:string;client_id:string;status:string;row_version:number;evidence_reference:string|null;
      }|undefined;
      if(!proposal)throw new ApiError(404,'NOT_FOUND','Proposta do ERP não encontrada.');
      if(proposal.row_version!==po.proposalVersion)
        throw new ApiError(409,'VERSION_CONFLICT','Proposta alterada. Atualize antes de registrar a PO.');
      if(proposal.status!=='accepted'||!proposal.evidence_reference)
        throw new ApiError(409,'INVALID_STATE','Somente proposta com aceite registrado pode originar PO.');
      const client=await query(
        `SELECT id FROM clients WHERE id=$1 AND owner_id=$2 AND status='active' FOR SHARE`,
        [proposal.client_id,context!.actorId],
      );
      if(!client.rowCount)throw new ApiError(409,'CLIENT_NOT_AVAILABLE','O cliente do ERP está inativo.');
      // Locking the parent proposal serializes requests for the same source.
      const duplicate=await query(
        `SELECT id FROM purchase_orders WHERE proposal_id=$1 AND owner_id=$2 AND reference=$3 LIMIT 1`,
        [po.proposalId,context!.actorId,po.reference],
      );
      if(duplicate.rowCount)
        throw new ApiError(409,'DUPLICATE_REFERENCE','Esta PO já foi registrada nesta proposta.');
      const inserted=await query(
        `INSERT INTO purchase_orders
         (id,owner_id,client_id,proposal_id,reference,received_date,status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'registered',$7,$7)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [po.id,context!.actorId,proposal.client_id,po.proposalId,po.reference,po.receivedDate,now],
      );
      if(!inserted.rowCount)throw new ApiError(409,'ALREADY_EXISTS','Pedido já registrado.');
      const result={ok:true,resource:{type:'purchaseOrder',id:po.id,rowVersion:1},
        refreshPolicy:['purchaseOrders.list','proposals.detail']};
      await query(
        'UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',
        [JSON.stringify(result),po.id,context!.actorId],
      );
      return result;
    });
    return respond(result,context,201);
  }catch(err){return failure(err,context);}
}
