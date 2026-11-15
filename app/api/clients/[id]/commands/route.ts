import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {clientFields} from '../../../../../lib/domain/clients';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';

export const dynamic='force-dynamic';
const uuid=z.string().uuid(),base={key:uuid,version:z.number().int().positive()};
const command=z.discriminatedUnion('command',[
  z.object({...base,command:z.literal('revise'),data:clientFields}).strict(),
  z.object({...base,command:z.literal('activate')}).strict(),
  z.object({...base,command:z.literal('deactivate')}).strict(),
]);
type RouteContext={params:Promise<{id:string}>};
export async function POST(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const {id}=await params;
    if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Identificador inválido.');
    const parsed=command.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando de cliente inválido.');
    const p=parsed.data;
    const hash=await fingerprint({actorId:context.actorId,id,command:p});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      const reserved=await query(
        `INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
         VALUES($1,$2,'client',$3,$4,$5,'',$6,$7)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [p.key,context!.actorId,id,p.command,hash,context!.correlationId,now],
      );
      if(!reserved.rowCount){
        const old=await query('SELECT actor_id,request_hash,result FROM business_commands WHERE id=$1',[p.key]);
        const row=old.rows[0] as {actor_id:string;request_hash:string;result:string}|undefined;
        if(!row||row.actor_id!==context!.actorId||row.request_hash!==hash||!row.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador de comando já utilizado.');
        return JSON.parse(row.result) as {resource:{id:string;rowVersion:number}};
      }
      const state=await query('SELECT row_version,status FROM clients WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [id,context!.actorId]);
      const row=state.rows[0] as {row_version:number;status:string}|undefined;
      if(!row)throw new ApiError(404,'NOT_FOUND','Cliente não encontrado.');
      if(row.row_version!==p.version)
        throw new ApiError(409,'VERSION_CONFLICT','Cadastro atualizado. Recarregue o cliente.');
      let updated;
      if(p.command==='revise'){
        if(p.data.document){
          const duplicate=await query('SELECT id FROM clients WHERE owner_id=$1 AND document=$2 AND id<>$3 LIMIT 1',
            [context!.actorId,p.data.document,id]);
          if(duplicate.rowCount)throw new ApiError(409,'CLIENT_DUPLICATE','Documento já pertence a outro cliente.');
        }
        updated=await query(
          `UPDATE clients SET legal_name=$1,trade_name=$2,document=$3,email=$4,
           phone=$5,row_version=row_version+1,updated_at=$6
           WHERE id=$7 AND owner_id=$8 RETURNING row_version`,
          [p.data.legalName,p.data.tradeName,p.data.document,p.data.email,p.data.phone,
            now,id,context!.actorId],
        );
      }else{
        const target=p.command==='activate'?'active':'inactive';
        if(row.status===target)
          throw new ApiError(409,'INVALID_STATE','Cliente já está nesta situação.');
        updated=await query(
          `UPDATE clients SET status=$1,row_version=row_version+1,updated_at=$2
           WHERE id=$3 AND owner_id=$4 RETURNING row_version`,
          [target,now,id,context!.actorId],
        );
      }
      const receipt={ok:true,resource:{type:'client',id,rowVersion:updated.rows[0].row_version},
        refreshPolicy:['clients.list','clients.detail']};
      await query('UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',
        [JSON.stringify(receipt),p.key,context!.actorId]);
      return receipt;
    });
    return respond(result,context);
  }catch(err){return failure(err,context);}
}
