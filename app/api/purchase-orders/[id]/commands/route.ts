import { z } from 'zod';
import { database } from '../../../../../db/raw';
import {
  ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext,
} from '../../../../../lib/api/http';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
const uuid=z.string().uuid();
const cancel=z.object({
  key:uuid,version:z.number().int().positive(),command:z.literal('cancel'),
  reason:z.string().trim().min(3).max(500),
}).strict();

export async function POST(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const {id}=await params;
    if(!uuid.safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador de PO inválido.');
    const parsed=cancel.safeParse(await jsonBody(request));
    if(!parsed.success)
      throw new ApiError(400,'VALIDATION_FAILED','Informe a versão e o motivo do cancelamento.');
    const command=parsed.data;
    const hash=await fingerprint({actorId:context.actorId,id,command});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      const reserved=await query(
        `INSERT INTO business_commands
         (id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
         VALUES($1,$2,'purchaseOrder',$3,'cancel',$4,'',$5,$6)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [command.key,context!.actorId,id,hash,context!.correlationId,now],
      );
      if(!reserved.rowCount){
        const r=await query(
          'SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1',
          [command.key],
        );
        const row=r.rows[0] as {
          actor_id:string;entity_type:string;entity_id:string;request_hash:string;result:string;
        }|undefined;
        if(!row||row.actor_id!==context!.actorId||row.entity_id!==id||
          row.entity_type!=='purchaseOrder'||row.request_hash!==hash||!row.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Este comando já pertence a outra operação.');
        return JSON.parse(row.result) as {resource:{id:string;rowVersion:number}};
      }
      const locked=await query(
        `SELECT id,status,row_version FROM purchase_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [id,context!.actorId],
      );
      const po=locked.rows[0] as {status:string;row_version:number}|undefined;
      if(!po)throw new ApiError(404,'NOT_FOUND','PO não encontrada.');
      if(po.row_version!==command.version)
        throw new ApiError(409,'VERSION_CONFLICT','PO alterada. Atualize o contexto.');
      if(po.status!=='registered')
        throw new ApiError(409,'INVALID_STATE','Somente PO registrada pode ser cancelada.');
      // A PO with any registered contract is immutable. A later contract
      // registration must independently lock/recheck this same parent row.
      const contracts=await query(
        'SELECT id FROM contracts WHERE purchase_order_id=$1 AND owner_id=$2 LIMIT 1',
        [id,context!.actorId],
      );
      if(contracts.rowCount)
        throw new ApiError(409,'CONTRACT_LINKED','PO com contrato vinculado não pode ser cancelada.');
      const resultChange=await query(
        `UPDATE purchase_orders SET status='cancelled',cancel_reason=$1,
         row_version=row_version+1,updated_at=$2 WHERE id=$3 AND owner_id=$4
         RETURNING row_version`,
        [command.reason,now,id,context!.actorId],
      );
      const receipt={ok:true,resource:{type:'purchaseOrder',id,rowVersion:resultChange.rows[0].row_version},
        refreshPolicy:['purchaseOrders.list','purchaseOrders.detail']};
      await query('UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',
        [JSON.stringify(receipt),command.key,context!.actorId]);
      return receipt;
    });
    return respond(result,context);
  }catch(err){return failure(err,context);}
}
