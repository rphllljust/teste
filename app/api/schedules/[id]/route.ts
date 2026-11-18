import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

const input=z.object({
  status:z.enum(['scheduled','confirmed','cancelled','completed']),
  version:z.coerce.number().int().min(1),
}).strict();

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}):Promise<Response>{
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const {id}=await params;
    if(!z.string().uuid().safeParse(id).success) throw new ApiError(400,'VALIDATION_FAILED','Agendamento inválido.');
    const parsed=input.safeParse(await jsonBody(request));
    if(!parsed.success) throw new ApiError(400,'VALIDATION_FAILED','Estado do agendamento inválido.');
    const result=await database().transaction(async query=>{
      const current=await query('SELECT id,order_id,status,version FROM service_schedules WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,context!.actorId]);
      if(!current.rowCount) throw new ApiError(404,'NOT_FOUND','Agendamento não encontrado.');
      const row=current.rows[0];
      if(Number(row.version)!==parsed.data.version) throw new ApiError(409,'VERSION_CONFLICT','O agendamento foi alterado por outro operador.');
      const legal:{[key:string]:string[]}={
        scheduled:['confirmed','cancelled'],
        confirmed:['completed','cancelled'],
        cancelled:[],
        completed:[],
      };
      if(!legal[String(row.status)]?.includes(parsed.data.status) && row.status!==parsed.data.status)
        throw new ApiError(409,'INVALID_STATE','Transição de agenda não permitida.');
      const updated=await query(
        'UPDATE service_schedules SET status=$1,version=version+1,updated_at=now() WHERE id=$2 AND owner_id=$3 RETURNING id,status,version,updated_at',
        [parsed.data.status,id,context!.actorId],
      );
      let orderSync:{status:string;version:number}|null=null;
      if(parsed.data.status==='completed'){
        const order=await query('SELECT id,status,version FROM service_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE',[row.order_id,context!.actorId]);
        if(order.rowCount && order.rows[0].status==='executing'){
          const nextVersion=Number(order.rows[0].version)+1;
          await query('UPDATE service_orders SET status=$1,version=$2,updated_at=now() WHERE id=$3 AND owner_id=$4 AND status=$5 AND version=$6',['completed',nextVersion,row.order_id,context!.actorId,'executing',Number(order.rows[0].version)]);
          await query('INSERT INTO order_events (id,order_id,actor_id,command,version,created_at) VALUES ($1,$2,$3,$4,$5,now())',[crypto.randomUUID(),row.order_id,context!.actorId,'complete',nextVersion]);
          orderSync={status:'completed',version:nextVersion};
        }
      }
      return {schedule:updated.rows[0],orderSync};
    });
    return respond(result,context);
  }catch(error){return failure(error,context);}
}
