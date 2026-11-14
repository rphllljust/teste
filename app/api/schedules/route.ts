import {z} from 'zod';
import {database} from '../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../lib/api/http';

const input=z.object({
 id:z.string().uuid(),
 orderId:z.string().uuid(),
 startAt:z.string().datetime({offset:true}),
 endAt:z.string().datetime({offset:true}),
 timezone:z.string().trim().min(1).max(64).default('America/Porto_Velho'),
 assigneeType:z.enum(['person','team']).nullable().optional(),
 assigneeId:z.string().uuid().nullable().optional(),
 notes:z.string().trim().max(2000).nullable().optional(),
}).strict();

function assertWindow(startAt:string,endAt:string){
 const start=Date.parse(startAt),end=Date.parse(endAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new ApiError(400,'VALIDATION_FAILED','O término deve ser posterior ao início.');
}

export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const url=new URL(request.url), orderId=url.searchParams.get('orderId'), status=url.searchParams.get('status');
  const predicates=['s.owner_id=?']; const values:[string,...string[]]=[context.actorId];
  if(orderId){predicates.push('s.order_id=?');values.push(orderId);}
  if(status){predicates.push('s.status=?');values.push(status);}
  const rows=await database().prepare('SELECT s.*,o.title,o.client,o.status AS order_status FROM service_schedules s JOIN service_orders o ON o.id=s.order_id WHERE '+predicates.join(' AND ')+' ORDER BY s.start_at ASC,s.id ASC').bind(...values).all();
  return respond({schedules:rows.results},context);
 }catch(error){return failure(error,context);}
}

export async function POST(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const parsed=input.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Confira os dados do agendamento.');
  const p=parsed.data; assertWindow(p.startAt,p.endAt);
  if((p.assigneeType&&!p.assigneeId)||(!p.assigneeType&&p.assigneeId))throw new ApiError(400,'VALIDATION_FAILED','Responsável e tipo devem ser informados em conjunto.');
  const hash=await fingerprint({actor:context.actorId,scope:'serviceSchedule',command:'create',payload:p});
  const prior=await database().prepare('SELECT result FROM business_commands WHERE entity_type=? AND entity_id=? AND command=? AND request_hash=?').bind('serviceSchedule',p.id,'create',hash).first<{result:string}>();
  if(prior)return respond(JSON.parse(prior.result),context,201);
  const order=await database().prepare('SELECT id,status FROM service_orders WHERE id=? AND (owner_id IS NULL OR owner_id=?)').bind(p.orderId,context.actorId).first<{id:string;status:string}>();
  if(!order)throw new ApiError(404,'NOT_FOUND','Ordem de serviço não encontrada.');
  if(['cancelled','completed'].includes(order.status))throw new ApiError(409,'INVALID_STATE','A ordem não aceita novos agendamentos.');
  const conflict=await database().prepare("SELECT id FROM service_schedules WHERE owner_id=? AND assignee_type IS ? AND assignee_id IS ? AND status IN ('scheduled','confirmed') AND start_at < ? AND end_at > ? LIMIT 1").bind(context.actorId,p.assigneeType??null,p.assigneeId??null,p.endAt,p.startAt).first<{id:string}>();
  if(conflict)throw new ApiError(409,'SCHEDULE_CONFLICT','O responsável já possui um agendamento sobreposto.');
  const now=new Date().toISOString(),result={ok:true,id:p.id,resource:{type:'serviceSchedule',id:p.id,rowVersion:1},refreshPolicy:['serviceOrders.schedule']};
  const db=database();
  const write=await db.batch([
   db.prepare('INSERT INTO service_schedules(id,owner_id,order_id,start_at,end_at,timezone,assignee_type,assignee_id,status,notes,version,created_at,updated_at,actor_id,request_hash,correlation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(p.id,context.actorId,p.orderId,p.startAt,p.endAt,p.timezone,p.assigneeType??null,p.assigneeId??null,'scheduled',p.notes??null,1,now,now,context.actorId,hash,context.correlationId),
   db.prepare('INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),context.actorId,'serviceSchedule',p.id,'create',hash,JSON.stringify(result),context.correlationId,now),
  ]);
  if(!write[0].meta.changes)throw new ApiError(409,'VERSION_CONFLICT','Este agendamento já existe.');
  return respond(result,context,201);
 }catch(error){return failure(error,context);}
}
