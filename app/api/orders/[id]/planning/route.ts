import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';
import {pgConflict} from '../../../../../lib/domain/accounting';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
const uuid=z.string().uuid();
const setSchedule=z.object({
  key:uuid,command:z.literal('set_schedule'),expectedVersion:z.number().int().min(0),
  startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),
  location:z.string().trim().min(2).max(200),
}).strict();
const assign=z.object({key:uuid,command:z.literal('assign_person'),personId:uuid}).strict();
const unassign=z.object({key:uuid,command:z.literal('unassign_person'),personId:uuid}).strict();
const input=z.discriminatedUnion('command',[setSchedule,assign,unassign]);

export function schedulingRange(startsAt:string,endsAt:string) {
  const start=Date.parse(startsAt),end=Date.parse(endsAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>30*86400000)
    throw new ApiError(400,'INVALID_SCHEDULE','O término deve ser posterior ao início e o intervalo não pode exceder 30 dias.');
  return {startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()};
}
type TxQuery=(sql:string,params?:unknown[])=>Promise<{rows:Record<string,unknown>[];rowCount:number|null}>;
async function assertNoOverlap(query:TxQuery,owner:string,personId:string,orderId:string,start:unknown,end:unknown){
  const busy=await query(
    'SELECT a.order_id FROM field_order_assignments a JOIN field_order_schedules s ON s.order_id=a.order_id AND s.owner_id=a.owner_id JOIN service_orders o ON o.id=a.order_id AND o.owner_id=a.owner_id WHERE a.owner_id=$1 AND a.person_id=$2 AND a.active=true AND o.status IN (\'draft\',\'authorized\',\'executing\') AND a.order_id<>$3 AND s.starts_at<$4::timestamptz AND s.ends_at>$5::timestamptz LIMIT 1',
    [owner,personId,orderId,end,start],
  );
  if(busy.rows.length)throw new ApiError(409,'PERSON_SCHEDULE_CONFLICT','O profissional já está alocado nesse intervalo.');
}
async function lockPerson(query:TxQuery,owner:string,id:string){
  const r=await query('SELECT id FROM field_people WHERE owner_id=$1 AND id=$2 AND active=true FOR UPDATE',[owner,id]);
  if(!r.rows.length)throw new ApiError(404,'PERSON_NOT_FOUND','Profissional não encontrado ou inativo.');
}

export async function GET(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try {
    context=requestContext(request);
    const {id}=await params;
    if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','OS inválida.');
    const db=database();
    const own=await db.prepare('SELECT id,status,version FROM service_orders WHERE id=? AND owner_id=?')
      .bind(id,context.actorId).first();
    if(!own)throw new ApiError(404,'NOT_FOUND','Ordem não encontrada.');
    const result=await db.batch([
      db.prepare('SELECT starts_at AS "startsAt",ends_at AS "endsAt",location,version FROM field_order_schedules WHERE owner_id=? AND order_id=?').bind(context.actorId,id),
      db.prepare('SELECT a.id,a.person_id AS "personId",p.full_name AS "fullName",p.specialty FROM field_order_assignments a JOIN field_people p ON p.id=a.person_id AND p.owner_id=a.owner_id WHERE a.owner_id=? AND a.order_id=? AND a.active=true ORDER BY p.full_name,a.id').bind(context.actorId,id),
    ]);
    return respond({order:own,schedule:result[0].results[0]??null,assignments:result[1].results},context);
  }catch(error){return failure(error,context);}
}

export async function POST(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try {
    context=requestContext(request,true);
    const {id}=await params;
    if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','OS inválida.');
    const parsed=input.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Revise o comando de planejamento.');
    const p=parsed.data;
    const hash=await fingerprint({actorId:context.actorId,orderId:id,command:p});
    let replayed=false;
    const receipt=await database().transaction(async rawQuery=>{
      const query=rawQuery as TxQuery;
      const order=await query('SELECT id,status FROM service_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,context!.actorId]);
      if(!order.rows.length)throw new ApiError(404,'NOT_FOUND','Ordem não encontrada.');
      const prior=await query('SELECT owner_id,order_id,command,request_hash,receipt FROM field_planning_events WHERE id=$1',[p.key]);
      if(prior.rows.length){
        const old=prior.rows[0];
        if(old.owner_id!==context!.actorId||old.order_id!==id||old.request_hash!==hash||old.command!==p.command)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de comando já utilizada.');
        replayed=true;
        return old.receipt as Record<string,unknown>;
      }
      if(!['draft','authorized'].includes(String(order.rows[0].status)))
        throw new ApiError(409,'INVALID_STATE','Planejamento bloqueado para OS em execução, concluída ou cancelada.');
      let result:Record<string,unknown>;
      if(p.command==='set_schedule'){
        const times=schedulingRange(p.startsAt,p.endsAt);
        const existing=await query('SELECT version FROM field_order_schedules WHERE order_id=$1 AND owner_id=$2 FOR UPDATE',[id,context!.actorId]);
        const version=existing.rows.length?Number(existing.rows[0].version):0;
        if(version!==p.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','O agendamento foi alterado. Atualize e tente novamente.');
        // Lock each assigned professional and reject overlapping active assignments.
        const assigned=await query('SELECT person_id FROM field_order_assignments WHERE order_id=$1 AND owner_id=$2 AND active=true ORDER BY person_id',[id,context!.actorId]);
        for(const row of assigned.rows){
          const personId=String(row.person_id);
          await lockPerson(query,context!.actorId,personId);
          await assertNoOverlap(query,context!.actorId,personId,id,times.startsAt,times.endsAt);
        }
        if(version===0){
          await query(
            'INSERT INTO field_order_schedules(order_id,owner_id,starts_at,ends_at,location) VALUES($1,$2,$3,$4,$5)',
            [id,context!.actorId,times.startsAt,times.endsAt,p.location],
          );
        }else{
          const updated=await query(
            'UPDATE field_order_schedules SET starts_at=$1,ends_at=$2,location=$3,version=version+1,updated_at=now() WHERE order_id=$4 AND owner_id=$5 AND version=$6',
            [times.startsAt,times.endsAt,p.location,id,context!.actorId,version],
          );
          if(updated.rowCount!==1)throw new ApiError(409,'VERSION_CONFLICT','Agendamento alterado em concorrência.');
        }
        result={ok:true,resource:{type:'fieldSchedule',orderId:id,version:version+1}};
      }else if(p.command==='assign_person'){
        await lockPerson(query,context!.actorId,p.personId);
        const schedule=await query('SELECT starts_at,ends_at FROM field_order_schedules WHERE order_id=$1 AND owner_id=$2',[id,context!.actorId]);
        if(!schedule.rows.length)throw new ApiError(409,'SCHEDULE_REQUIRED','Agende a OS antes de atribuir profissionais.');
        await assertNoOverlap(query,context!.actorId,p.personId,id,schedule.rows[0].starts_at,schedule.rows[0].ends_at);
        const existing=await query(
          'SELECT id,active FROM field_order_assignments WHERE owner_id=$1 AND order_id=$2 AND person_id=$3 FOR UPDATE',
          [context!.actorId,id,p.personId],
        );
        if(existing.rows.length && existing.rows[0].active===true)
          throw new ApiError(409,'ALREADY_ASSIGNED','Profissional já designado.');
        const assignmentId=existing.rows.length?String(existing.rows[0].id):crypto.randomUUID();
        if(existing.rows.length){
          await query('UPDATE field_order_assignments SET active=true,updated_at=now() WHERE id=$1',[assignmentId]);
        }else{
          await query('INSERT INTO field_order_assignments(id,order_id,owner_id,person_id) VALUES($1,$2,$3,$4)',
            [assignmentId,id,context!.actorId,p.personId]);
        }
        result={ok:true,resource:{type:'fieldAssignment',id:assignmentId,personId:p.personId,orderId:id}};
      }else{
        const existing=await query(
          'UPDATE field_order_assignments SET active=false,updated_at=now() WHERE owner_id=$1 AND order_id=$2 AND person_id=$3 AND active=true RETURNING id',
          [context!.actorId,id,p.personId],
        );
        if(!existing.rowCount)throw new ApiError(404,'NOT_ASSIGNED','Profissional não está designado.');
        result={ok:true,resource:{type:'fieldAssignment',id:existing.rows[0].id,active:false}};
      }
      await query(
        'INSERT INTO field_planning_events(id,order_id,owner_id,command,request_hash,receipt) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
        [p.key,id,context!.actorId,p.command,hash,JSON.stringify(result)],
      );
      return result;
    }).catch(pgConflict);
    return respond({...receipt,replayed},context,replayed?200:201);
  }catch(error){return failure(error,context);}
}
