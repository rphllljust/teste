import { z } from 'zod';
import { database } from '../../../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../../lib/api/http';
const uuid=z.string().uuid();
const input=z.object({key:uuid,version:z.number().int().positive(),command:z.literal('submit')}).strict();
function storedResult(value:unknown){return typeof value==='string'?JSON.parse(value) as Record<string,unknown>:value as Record<string,unknown>;}
export async function POST(request:Request,{params}:{params:Promise<{id:string;measurementId:string}>}){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);const {id:orderId,measurementId}=await params;
    if(!uuid.safeParse(orderId).success||!uuid.safeParse(measurementId).success)throw new ApiError(400,'VALIDATION_FAILED','Identificador inválido.');
    const parsed=input.safeParse(await jsonBody(request));if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando de medição inválido.');const p=parsed.data;
    const hash=await fingerprint({actor:context!.actorId,orderId,measurementId,payload:p});
    const result=await database().transaction(async query=>{
      const prior=await query('SELECT request_hash,result FROM field_measurement_events WHERE id=$1',[p.key]);
      if(prior.rows.length){if(prior.rows[0].request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de comando já utilizada.');return {replayed:true,...storedResult(prior.rows[0].result)};}
      const rows=await query('SELECT m.id,m.status,m.version FROM measurements m JOIN service_orders o ON o.id=m.order_id WHERE m.id=$1 AND m.order_id=$2 AND o.owner_id=$3 FOR UPDATE',[measurementId,orderId,context!.actorId]);
      if(!rows.rows.length)throw new ApiError(404,'NOT_FOUND','Medição não encontrada.');const measurement=rows.rows[0] as {id:string;status:string;version:number};
      if(measurement.version!==p.version)throw new ApiError(409,'VERSION_CONFLICT','A medição mudou. Atualize o contexto.');
      if(measurement.status!=='draft')throw new ApiError(409,'INVALID_STATE','Somente medições em rascunho podem ser submetidas.');
      const now=new Date().toISOString(),updated=await query("UPDATE measurements SET status='submitted',version=version+1,submitted_at=$1,submitted_by=$2 WHERE id=$3 AND version=$4 RETURNING version",[now,context!.actorId,measurementId,p.version]);
      const receipt={ok:true,resource:{type:'measurement',id:measurementId,rowVersion:Number(updated.rows[0].version),status:'submitted'}};
      await query("INSERT INTO field_measurement_events(id,measurement_id,order_id,command,version,actor_id,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,'submit',$4,$5,$6,$7,$8,$9)",[p.key,measurementId,orderId,Number(updated.rows[0].version),context!.actorId,hash,JSON.stringify(receipt),context!.correlationId,now]);return receipt;
    });
    return respond(result,context,200);
  }catch(error){return failure(error,context);}
}
