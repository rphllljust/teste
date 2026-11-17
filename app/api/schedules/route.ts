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
const pageParams=z.object({
  from:z.string().datetime({offset:true}).optional(),
  to:z.string().datetime({offset:true}).optional(),
  page:z.coerce.number().int().min(1).max(10000).default(1),
  pageSize:z.coerce.number().int().min(1).max(100).default(50),
  status:z.enum(['scheduled','confirmed','cancelled','completed']).optional(),
  orderId:z.string().uuid().optional(),
});
function utc(value:string){const parsed=Date.parse(value);if(!Number.isFinite(parsed))throw new ApiError(400,'VALIDATION_FAILED','Data inválida.');return new Date(parsed).toISOString();}
function assertTimezone(value:string){try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format();}catch{throw new ApiError(400,'VALIDATION_FAILED','Fuso horário IANA inválido.');}}
function assertWindow(startAt:string,endAt:string){const start=Date.parse(startAt),end=Date.parse(endAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new ApiError(400,'VALIDATION_FAILED','O término deve ser posterior ao início.');}

export async function GET(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const parsed=pageParams.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros de agenda inválidos.');
    const p=parsed.data,predicates=['s.owner_id=?'],values:(string|number)[]=[context.actorId];
    if(p.from){predicates.push('s.end_utc>?');values.push(utc(p.from));}
    if(p.to){predicates.push('s.start_utc<?');values.push(utc(p.to));}
    if(p.status){predicates.push('s.status=?');values.push(p.status);}
    if(p.orderId){predicates.push('s.order_id=?');values.push(p.orderId);}
    const where=predicates.join(' AND '),db=database();
    const [count,rows]=await Promise.all([
      db.prepare('SELECT COUNT(*) AS total FROM service_schedules s WHERE '+where).bind(...values).first<{total:number}>(),
      db.prepare('SELECT s.*,o.title,o.client,o.status AS order_status FROM service_schedules s JOIN service_orders o ON o.id=s.order_id WHERE '+where+' ORDER BY s.start_utc ASC,s.id ASC LIMIT ? OFFSET ?').bind(...values,p.pageSize,(p.page-1)*p.pageSize).all(),
    ]);
    const total=Number(count?.total??0);
    return respond({schedules:rows.results,page:p.page,pageSize:p.pageSize,total,hasMore:p.page*p.pageSize<total},context);
  }catch(error){return failure(error,context);}
}

export async function POST(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const parsed=input.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Confira os dados do agendamento.');
    const p=parsed.data;assertWindow(p.startAt,p.endAt);assertTimezone(p.timezone);
    if(Boolean(p.assigneeType)!==Boolean(p.assigneeId))throw new ApiError(400,'VALIDATION_FAILED','Tipo e responsável devem ser informados juntos.');
    const startUtc=utc(p.startAt),endUtc=utc(p.endAt);
    const hash=await fingerprint({actor:context.actorId,scope:'serviceSchedule',command:'create',payload:p});
    const db=database();
    const result=await db.transaction(async query=>{
      const order=await query('SELECT id,status FROM service_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE',[p.orderId,context!.actorId]);
      if(!order.rowCount)throw new ApiError(404,'NOT_FOUND','Ordem de serviço não encontrada.');
      if(!['draft','authorized','executing'].includes(String(order.rows[0].status)))throw new ApiError(409,'INVALID_STATE','A ordem não aceita novos agendamentos.');
      if(p.assigneeId){
        const person=await query('SELECT id FROM service_people WHERE id=$1 AND owner_id=$2 AND kind=$3 AND active=true',[p.assigneeId,context!.actorId,p.assigneeType]);
        if(!person.rowCount)throw new ApiError(404,'NOT_FOUND','Pessoa/equipe não encontrada ou inativa.');
      }
      const prior=await query('SELECT request_hash,result FROM business_commands WHERE entity_type=$1 AND entity_id=$2 AND command=$3 AND actor_id=$4 ORDER BY created_at DESC LIMIT 1',['serviceSchedule',p.id,'create',context!.actorId]);
      if(prior.rowCount){if(prior.rows[0].request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','A chave do agendamento já foi usada com outro conteúdo.');return JSON.parse(String(prior.rows[0].result));}
      const now=new Date().toISOString(),result={ok:true,id:p.id,resource:{type:'serviceSchedule',id:p.id,rowVersion:1},refreshPolicy:['serviceOrders.schedule']};
      await query('INSERT INTO service_schedules(id,owner_id,order_id,start_at,end_at,start_utc,end_utc,timezone,assignee_type,assignee_id,status,notes,version,created_at,updated_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$13,$2,$14,$15)',[p.id,context!.actorId,p.orderId,p.startAt,p.endAt,startUtc,endUtc,p.timezone,p.assigneeType??null,p.assigneeId??null,'scheduled',p.notes??null,now,hash,context!.correlationId]);
      await query('INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[crypto.randomUUID(),context!.actorId,'serviceSchedule',p.id,'create',hash,JSON.stringify(result),context!.correlationId,now]);
      return result;
    });
    return respond(result,context,201);
  }catch(error){return failure(error,context);}
}