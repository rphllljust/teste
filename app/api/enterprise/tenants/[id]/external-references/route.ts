import {z} from 'zod';
import {database} from '../../../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../../../lib/api/http';

export const dynamic='force-dynamic';
type Route={params:Promise<{id:string}>};
const entityType=z.enum(['legal_entity','client','proposal','purchase_order','contract','service_order','execution','measurement','invoice','receivable','settlement','journal_entry']);
const createCommand=z.object({
  id:z.string().uuid(),commandKey:z.string().uuid(),legalEntityId:z.string().uuid().nullable().optional(),
  entityType,entityId:z.string().uuid(),systemKey:z.string().regex(/^[A-Za-z0-9_-]{3,64}$/),
  externalId:z.string().trim().min(1).max(200),sourceUrl:z.string().url().refine(v=>/^https?:\/\//.test(v)),
  sourceLabel:z.string().trim().min(3).max(200),ownerDisplayName:z.string().trim().min(3).max(200).nullable().optional(),
  taxId:z.string().regex(/^\d{14}$/).nullable().optional(),
}).strict();

async function guardMember(query:(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>}>,
 tenantId:string,actorId:string,write=false){
 const r=await query(`SELECT m.role FROM enterprise_tenant_memberships m
  JOIN enterprise_tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=$1 AND m.actor_id=$2 AND m.status='active' AND t.status='active'
  FOR SHARE OF m,t`,[tenantId,actorId]);
 if(!r.rows.length)throw new ApiError(404,'NOT_FOUND','Empresa não encontrada no contexto autorizado.');
 const role=String(r.rows[0].role);
 if(write&&!['owner','admin'].includes(role))throw new ApiError(403,'FORBIDDEN','Sua função não permite registrar referências externas.');
}

export async function GET(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const tenantId=(await route.params).id;
  if(!z.string().uuid().safeParse(tenantId).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
  const p=new URL(request.url).searchParams;
  const parsed=z.object({entityType:entityType.optional(),entityId:z.string().uuid().optional(),status:z.enum(['pending_review','verified','rejected']).optional()}).safeParse({
    entityType:p.get('entityType')??undefined,entityId:p.get('entityId')??undefined,status:p.get('status')??undefined,
  });
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtro de integração inválido.');
  const items=await database().transaction(async query=>{
   await guardMember(query,tenantId,ctx!.actorId);
   const where=['tenant_id=$1'];const bind:unknown[]=[tenantId];
   if(parsed.data.entityType){where.push('entity_type=$'+(bind.length+1));bind.push(parsed.data.entityType);}
   if(parsed.data.entityId){where.push('entity_id=$'+(bind.length+1));bind.push(parsed.data.entityId);}
   if(parsed.data.status){where.push('status=$'+(bind.length+1));bind.push(parsed.data.status);}
   const r=await query(`SELECT id,legal_entity_id AS "legalEntityId",entity_type AS "entityType",
    entity_id AS "entityId",system_key AS "systemKey",external_id AS "externalId",
    source_url AS "sourceUrl",source_label AS "sourceLabel",
    owner_display_name AS "ownerDisplayName",tax_id AS "taxId",status,
    created_at AS "createdAt",updated_at AS "updatedAt",row_version AS "rowVersion"
    FROM enterprise_external_references WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC,id DESC LIMIT 200`,bind);
   return r.rows;
  });
  return respond({items,source:'enterprise_external_reference_registry',readOnly:true},ctx);
 }catch(error){return failure(error,ctx);}
}

export async function POST(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const tenantId=(await route.params).id;
  if(!z.string().uuid().safeParse(tenantId).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
  const parsed=createCommand.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Dados da referência externa inválidos.');
  const data=parsed.data;
  const hash=await fingerprint({scope:'enterprise.externalReference.create',tenantId,data});
  const result=await database().transaction(async query=>{
   await guardMember(query,tenantId,ctx!.actorId,true);
   const entityId=data.legalEntityId??data.entityId;
   const legal=await query(`SELECT id FROM enterprise_legal_entities WHERE id=$1 AND tenant_id=$2 AND status='active'`,[entityId,tenantId]);
   if(data.entityType==='legal_entity'&&!legal.rows.length)throw new ApiError(404,'NOT_FOUND','Unidade empresarial não encontrada.');
   if(data.legalEntityId){
    const linked=await query(`SELECT id FROM enterprise_legal_entities WHERE id=$1 AND tenant_id=$2 AND status='active'`,[data.legalEntityId,tenantId]);
    if(!linked.rows.length)throw new ApiError(404,'NOT_FOUND','Unidade empresarial não encontrada.');
   }
   const prior=await query('SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',[data.commandKey]);
   if(prior.rows.length){
    const old=prior.rows[0];
    if(old.actor_id!==ctx!.actorId||old.entity_type!=='enterpriseExternalReference'||old.entity_id!==data.id||old.request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já utilizada com outros dados.');
    return {...JSON.parse(String(old.result)),replayed:true};
   }
   const now=new Date().toISOString();
   await query(`INSERT INTO enterprise_external_references
    (id,tenant_id,legal_entity_id,entity_type,entity_id,system_key,external_id,source_url,source_label,owner_display_name,tax_id,status,created_by,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending_review',$12,$13,$13)`,
    [data.id,tenantId,data.legalEntityId??(data.entityType==='legal_entity'?data.entityId:null),data.entityType,data.entityId,data.systemKey,data.externalId,data.sourceUrl,data.sourceLabel,data.ownerDisplayName??null,data.taxId??null,ctx!.actorId,now]);
   await query(`INSERT INTO enterprise_permission_events(id,tenant_id,actor_id,action,resource_id,correlation_id,created_at)
    VALUES($1,$2,$3,'external_reference.created',$4,$5,$6)`,[crypto.randomUUID(),tenantId,ctx!.actorId,data.id,ctx!.correlationId,now]);
   const receipt={id:data.id,tenantId,status:'pending_review',systemKey:data.systemKey,externalId:data.externalId,rowVersion:1};
   await query(`INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
    VALUES($1,$2,'enterpriseExternalReference',$3,'create',$4,$5,$6,$7)`,[data.commandKey,ctx!.actorId,data.id,hash,JSON.stringify(receipt),ctx!.correlationId,now]);
   return {...receipt,replayed:false};
  });
  return respond(result,ctx,result.replayed?200:201);
 }catch(error){return failure(error,ctx);}
}
