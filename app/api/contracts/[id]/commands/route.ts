import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {
  ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext,
} from '../../../../../lib/api/http';
import {contractTerms} from '../../../../../lib/domain/contracts';
import {commercialToday} from '../../../../../lib/domain/proposals';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
const uuid=z.string().uuid();
const base={key:uuid,version:z.number().int().positive()};
const commandSchema=z.discriminatedUnion('command',[
  z.object({...base,command:z.literal('revise'),terms:contractTerms}).strict(),
  z.object({...base,command:z.literal('activate'),
    signedReference:z.string().trim().min(3).max(160)}).strict(),
  z.object({...base,command:z.literal('cancel')}).strict(),
  z.object({...base,command:z.literal('close')}).strict(),
]);
type ContractState={
  status:string;row_version:number;proposal_id:string;purchase_order_id:string|null;
  client_id:string;starts_on:string;ends_on:string|null;
};

export async function POST(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const {id}=await params;
    if(!uuid.safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador de contrato inválido.');
    const parsed=commandSchema.safeParse(await jsonBody(request));
    if(!parsed.success)
      throw new ApiError(400,'VALIDATION_FAILED','Comando contratual inválido.');
    const command=parsed.data;
    const hash=await fingerprint({actorId:context.actorId,contractId:id,command});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      const reserved=await query(
        `INSERT INTO business_commands
         (id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
         VALUES($1,$2,'contract',$3,$4,$5,'',$6,$7)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [command.key,context!.actorId,id,command.command,hash,context!.correlationId,now],
      );
      if(!reserved.rowCount){
        const replay=await query(
          'SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1',
          [command.key],
        );
        const row=replay.rows[0] as {
          actor_id:string;entity_type:string;entity_id:string;request_hash:string;result:string;
        }|undefined;
        if(!row||row.actor_id!==context!.actorId||row.entity_type!=='contract'||
          row.entity_id!==id||row.request_hash!==hash||!row.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já utilizada para outra operação.');
        return JSON.parse(row.result) as {resource:{id:string;rowVersion:number}};
      }
      const locked=await query(
        `SELECT status,row_version,proposal_id,purchase_order_id,client_id,starts_on,ends_on
         FROM contracts WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [id,context!.actorId],
      );
      const record=locked.rows[0] as ContractState|undefined;
      if(!record)throw new ApiError(404,'NOT_FOUND','Contrato não encontrado.');
      if(record.row_version!==command.version)
        throw new ApiError(409,'VERSION_CONFLICT','O contrato mudou. Atualize o contexto.');
      const today=commercialToday();
      let status=record.status;
      switch(command.command){
        case 'revise':
          if(status!=='draft')
            throw new ApiError(409,'INVALID_STATE','Somente rascunho aceita revisão de termos.');
          await query(
            `UPDATE contracts SET scope=$1,starts_on=$2,ends_on=$3,
             row_version=row_version+1,updated_at=$4 WHERE id=$5 AND owner_id=$6`,
            [command.terms.scope,command.terms.startsOn,command.terms.endsOn,
              now,id,context!.actorId],
          );
          break;
        case 'activate':{
          if(status!=='draft'||(record.ends_on!==null&&record.ends_on<today))
            throw new ApiError(409,'INVALID_STATE','Contrato não está em rascunho vigente.');
          const proposal=await query(
            `SELECT status,evidence_reference FROM proposals
             WHERE id=$1 AND owner_id=$2`,[record.proposal_id,context!.actorId],
          );
          if(!proposal.rowCount||proposal.rows[0].status!=='accepted'||
            !proposal.rows[0].evidence_reference)
            throw new ApiError(409,'INVALID_SOURCE','Proposta de origem sem aceite registrado.');
          const client=await query(
            `SELECT id FROM clients WHERE id=$1 AND owner_id=$2 AND status='active' FOR SHARE`,
            [record.client_id,context!.actorId],
          );
          if(!client.rowCount)
            throw new ApiError(409,'CLIENT_NOT_AVAILABLE','Cliente inativo.');
          if(record.purchase_order_id){
            const linked=await query(
              `SELECT status,proposal_id,client_id FROM purchase_orders
               WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
              [record.purchase_order_id,context!.actorId],
            );
            if(!linked.rowCount||linked.rows[0].status!=='registered'||
              linked.rows[0].proposal_id!==record.proposal_id||
              linked.rows[0].client_id!==record.client_id)
              throw new ApiError(409,'INVALID_SOURCE','PO vinculada inválida ou cancelada.');
          }
          status='active';
          await query(
            `UPDATE contracts SET status='active',signed_reference=$1,
             row_version=row_version+1,updated_at=$2 WHERE id=$3 AND owner_id=$4`,
            [command.signedReference,now,id,context!.actorId],
          );
          break;
        }
        case 'cancel':{
          if(status!=='draft')
            throw new ApiError(409,'INVALID_STATE','Somente rascunho pode ser cancelado.');
          const orders=await query(
            'SELECT id FROM service_orders WHERE contract_id=$1 AND owner_id=$2 LIMIT 1',
            [id,context!.actorId],
          );
          if(orders.rowCount)
            throw new ApiError(409,'ORDERS_LINKED','Contrato já possui OS vinculada.');
          status='cancelled';
          await query(
            `UPDATE contracts SET status='cancelled',row_version=row_version+1,
             updated_at=$1 WHERE id=$2 AND owner_id=$3`,
            [now,id,context!.actorId],
          );
          break;
        }
        case 'close':{
          if(status!=='active')
            throw new ApiError(409,'INVALID_STATE','Somente contrato ativo pode ser encerrado.');
          const open=await query(
            `SELECT id FROM service_orders WHERE contract_id=$1 AND owner_id=$2
             AND status NOT IN ('completed','cancelled') LIMIT 1`,
            [id,context!.actorId],
          );
          if(open.rowCount)
            throw new ApiError(409,'OPEN_ORDERS','Conclua ou cancele as OS antes de encerrar o contrato.');
          status='closed';
          await query(
            `UPDATE contracts SET status='closed',row_version=row_version+1,
             updated_at=$1 WHERE id=$2 AND owner_id=$3`,
            [now,id,context!.actorId],
          );
          break;
        }
      }
      const receipt={ok:true,resource:{type:'contract',id,rowVersion:record.row_version+1},
        state:status,refreshPolicy:['contracts.list','contracts.detail']};
      await query(
        'UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',
        [JSON.stringify(receipt),command.key,context!.actorId],
      );
      return receipt;
    });
    return respond(result,context);
  }catch(err){return failure(err,context);}
}
