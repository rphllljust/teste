import { withRC98SignedDbScope } from '../../../lib/api/staging-uat-db-scope.mjs';
import {z} from 'zod';
import {database} from '../../../db/raw';
import {clientFields,projectClient,type ClientRow} from '../../../lib/domain/clients';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../lib/api/http';

export const dynamic='force-dynamic';
const params=z.object({
  q:z.string().max(160).default(''),
  status:z.enum(['','active','inactive']).default(''),
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(50).default(25),
  sort:z.enum(['name.asc','name.desc','recent']).default('name.asc'),
}).strict();
const registration=z.object({id:z.string().uuid(),data:clientFields}).strict();

export async function GET(request:Request) {
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const search=new URL(request.url).searchParams;
    const parsed=params.safeParse({
      q:search.get('q')??'',status:search.get('status')??'',
      page:search.get('page')??'1',pageSize:search.get('pageSize')??'25',
      sort:search.get('sort')??'name.asc',
    });
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros de clientes inválidos.');
    const p=parsed.data,w=['owner_id=?'],bind:unknown[]=[context.actorId];
    if(p.status){w.push('status=?');bind.push(p.status);}
    if(p.q.trim()){w.push('(legal_name ILIKE ? OR coalesce(trade_name,\'\') ILIKE ? OR coalesce(document,\'\') ILIKE ?)');const like='%'+p.q.trim()+'%';bind.push(like,like,like);}
    const order=p.sort==='name.desc'?'legal_name DESC,id DESC':p.sort==='recent'?'created_at DESC,id DESC':'legal_name ASC,id ASC';
    const where=w.join(' AND ');
    const [clients,count]=await Promise.all([
      database().prepare(`SELECT * FROM clients WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .bind(...bind,p.pageSize,(p.page-1)*p.pageSize).all<ClientRow>(),
      database().prepare(`SELECT count(*)::int AS n FROM clients WHERE ${where}`)
        .bind(...bind).first<{n:number}>(),
    ]);
    const total=count?.n??0;
    return respond({items:clients.results.map(x=>({...projectClient(x),availableCommands:[]})),
      pageInfo:{page:p.page,limit:p.pageSize,offset:(p.page-1)*p.pageSize,total,
        sourceTotal:total,hasMore:p.page*p.pageSize<total}},context);
  }catch(err){return failure(err,context);}
}

async function rc98PostCore(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const parsed=registration.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Confira os campos do cliente.');
    const p=parsed.data,hash=await fingerprint({actor:context.actorId,action:'register_client',payload:p});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      const registered=await query(
        `INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
         VALUES($1,$2,'client',$3,'register',$4,'',$5,$6)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [p.id,context!.actorId,p.id,hash,context!.correlationId,now],
      );
      if(!registered.rowCount){
        const previous=await query('SELECT actor_id,request_hash,result FROM business_commands WHERE id=$1',[p.id]);
        const row=previous.rows[0] as {actor_id:string;request_hash:string;result:string}|undefined;
        if(!row||row.actor_id!==context!.actorId||row.request_hash!==hash||!row.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador de cadastro já utilizado.');
        return JSON.parse(row.result) as {resource:{id:string}};
      }
      if(p.data.document){
        const duplicate=await query('SELECT id FROM clients WHERE owner_id=$1 AND document=$2 LIMIT 1',
          [context!.actorId,p.data.document]);
        if(duplicate.rowCount)throw new ApiError(409,'CLIENT_DUPLICATE','Documento já associado a um cliente do ERP.');
      }
      const created=await query(
        `INSERT INTO clients(id,owner_id,legal_name,trade_name,document,email,phone,status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [p.id,context!.actorId,p.data.legalName,p.data.tradeName,
          p.data.document,p.data.email,p.data.phone,now],
      );
      if(!created.rowCount)throw new ApiError(409,'ALREADY_EXISTS','Cliente já cadastrado.');
      const receipt={ok:true,resource:{type:'client',id:p.id,rowVersion:1},refreshPolicy:['clients.list']};
      await query('UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',
        [JSON.stringify(receipt),p.id,context!.actorId]);
      return receipt;
    });
    return respond(result,context,201);
  }catch(err){return failure(err,context);}
}

export function POST(request:Request) { return withRC98SignedDbScope(request, ()=>rc98PostCore(request)); }
