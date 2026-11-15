import { z } from 'zod';
import { database } from '../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../lib/api/http';

export const dynamic = 'force-dynamic';

const key = z.string().uuid();
const id = z.string().uuid();
const createLead = z.object({
  action: z.literal('createLead'), key,
  lead: z.object({
    id, contactName: z.string().trim().min(2).max(120),
    companyName: z.string().trim().min(2).max(160),
    contactEmail: z.string().trim().email().max(254).nullable(),
    source: z.enum(['manual','referral','web','event']).default('manual'),
  }).strict(),
}).strict();
const qualifyLead = z.object({
  action: z.literal('qualifyLead'), key, leadId: id,
  expectedVersion: z.number().int().positive(),
  outcome: z.enum(['qualified','disqualified']),
  clientId: id.nullable(),
}).strict();
const createOpportunity = z.object({
  action: z.literal('createOpportunity'), key,
  opportunity: z.object({
    id, leadId: id, title: z.string().trim().min(3).max(160),
    amountCents: z.number().int().nonnegative().max(1000000000000),
  }).strict(),
}).strict();
const changeStage = z.object({
  action: z.literal('changeStage'), key, opportunityId: id,
  expectedVersion: z.number().int().positive(),
  stage: z.enum(['proposal','negotiation','won','lost']),
}).strict();
const crmCommand = z.discriminatedUnion('action', [
  createLead, qualifyLead, createOpportunity, changeStage,
]);
const allowedNext: Record<string,readonly string[]> = {
  discovery: ['proposal','lost'],
  proposal: ['negotiation','lost'],
  negotiation: ['won','lost'],
  won: [], lost: [],
};

type LeadRow = {
  id:string; contactName:string; companyName:string;
  contactEmail:string|null; source:string; status:string;
  clientId:string|null; rowVersion:number; createdAt:string;
};
type OpportunityRow = {
  id:string; leadId:string; clientId:string|null; title:string;
  amountCents:string; stage:string; rowVersion:number; createdAt:string;
};
const listLeadsSql = `SELECT id, contact_name AS "contactName", company_name AS "companyName",
 contact_email AS "contactEmail", source, status, client_id AS "clientId",
 row_version AS "rowVersion", created_at AS "createdAt"
 FROM crm_leads WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 100`;
const listOpportunitiesSql = `SELECT id, lead_id AS "leadId", client_id AS "clientId",
 title, amount_cents::text AS "amountCents", stage, row_version AS "rowVersion",
 created_at AS "createdAt"
 FROM crm_opportunities WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 100`;

export async function GET(request:Request) {
  let context:RequestContext|undefined;
  try {
    context=requestContext(request);
    const [leads,opportunities,clients,totals]=await Promise.all([
      database().prepare(listLeadsSql).bind(context.actorId).all<LeadRow>(),
      database().prepare(listOpportunitiesSql).bind(context.actorId).all<OpportunityRow>(),
      database().prepare(`SELECT id,legal_name AS "legalName"
        FROM clients WHERE owner_id=? AND status='active'
        ORDER BY legal_name,id LIMIT 100`)
        .bind(context.actorId).all<{id:string;legalName:string}>(),
      database().prepare(`SELECT
        (SELECT count(*)::int FROM crm_leads WHERE owner_id=?) AS "leads",
        (SELECT count(*)::int FROM crm_opportunities WHERE owner_id=?) AS "opportunities"`)
        .bind(context.actorId,context.actorId).first<{leads:number;opportunities:number}>(),
    ]);
    return respond({
      leads:leads.results, opportunities:opportunities.results, clients:clients.results,
      totals:totals??{leads:0,opportunities:0},
      limits:{leads:100,opportunities:100},
    },context);
  } catch(error) { return failure(error,context); }
}

export async function POST(request:Request) {
  let context:RequestContext|undefined;
  try {
    context=requestContext(request,true);
    const parsed=crmCommand.safeParse(await jsonBody(request));
    if(!parsed.success) throw new ApiError(400,'VALIDATION_FAILED','Revise os dados do comando comercial.');
    const command=parsed.data;
    if(command.action==='qualifyLead' && command.outcome==='disqualified' && command.clientId)
      throw new ApiError(400,'VALIDATION_FAILED','Um lead desqualificado não pode ser vinculado a cliente.');
    const hash=await fingerprint({actorId:context.actorId,command});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      // Unique command key serializes concurrent retries; the effect and receipt
      // commit atomically, so a timeout can safely be retried with the same key.
      const reserved=await query(
        `INSERT INTO crm_commands(id,actor_id,request_hash,action,correlation_id,created_at)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING id`,
        [command.key,context!.actorId,hash,command.action,context!.correlationId,now],
      );
      if(!reserved.rowCount) {
        const prior=await query('SELECT actor_id,request_hash,result FROM crm_commands WHERE id=$1',[command.key]);
        const row=prior.rows[0] as {actor_id:string;request_hash:string;result:string}|undefined;
        if(!row||row.actor_id!==context!.actorId||row.request_hash!==hash||!row.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já utilizada em outro comando.');
        return JSON.parse(row.result) as Record<string,unknown>;
      }
      let receipt:{id:string;action:string;state:string;rowVersion:number;resourceType:string};
      switch(command.action){
        case 'createLead':{
          const l=command.lead;
          const inserted=await query(
            `INSERT INTO crm_leads(id,owner_id,contact_name,company_name,contact_email,source,status,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,'new',$7,$7) ON CONFLICT(id) DO NOTHING RETURNING id`,
            [l.id,context!.actorId,l.contactName,l.companyName,l.contactEmail,l.source,now],
          );
          if(!inserted.rowCount) throw new ApiError(409,'ALREADY_EXISTS','Lead já cadastrado.');
          receipt={id:l.id,action:command.action,state:'new',rowVersion:1,resourceType:'lead'};
          break;
        }
        case 'qualifyLead':{
          const current=await query('SELECT row_version,status FROM crm_leads WHERE id=$1 AND owner_id=$2 FOR UPDATE',
            [command.leadId,context!.actorId]);
          const lead=current.rows[0] as {row_version:number;status:string}|undefined;
          if(!lead) throw new ApiError(404,'NOT_FOUND','Lead não encontrado.');
          if(lead.row_version!==command.expectedVersion) throw new ApiError(409,'VERSION_CONFLICT','O lead foi alterado. Atualize a consulta.');
          if(lead.status!=='new') throw new ApiError(409,'INVALID_STATE','Este lead já foi classificado.');
          if(command.clientId){
            const client=await query('SELECT status FROM clients WHERE id=$1 AND owner_id=$2',
              [command.clientId,context!.actorId]);
            if(!client.rows.length||client.rows[0].status!=='active')
              throw new ApiError(404,'CLIENT_NOT_AVAILABLE','Cliente do Field não encontrado ou inativo.');
          }
          const changed=await query(
            `UPDATE crm_leads SET status=$1,client_id=$2,row_version=row_version+1,updated_at=$3
             WHERE id=$4 AND owner_id=$5 RETURNING row_version`,
            [command.outcome,command.clientId,now,command.leadId,context!.actorId],
          );
          receipt={id:command.leadId,action:command.action,state:command.outcome,rowVersion:changed.rows[0].row_version,resourceType:'lead'};
          break;
        }
        case 'createOpportunity':{
          const o=command.opportunity;
          const lr=await query('SELECT status,client_id FROM crm_leads WHERE id=$1 AND owner_id=$2 FOR UPDATE',
            [o.leadId,context!.actorId]);
          const lead=lr.rows[0] as {status:string;client_id:string|null}|undefined;
          if(!lead)throw new ApiError(404,'NOT_FOUND','Lead não encontrado.');
          if(lead.status!=='qualified')throw new ApiError(409,'INVALID_STATE','Qualifique o lead antes de criar uma oportunidade.');
          const inserted=await query(
            `INSERT INTO crm_opportunities(id,owner_id,lead_id,client_id,title,amount_cents,stage,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,'discovery',$7,$7) ON CONFLICT(id) DO NOTHING RETURNING id`,
            [o.id,context!.actorId,o.leadId,lead.client_id,o.title,o.amountCents,now],
          );
          if(!inserted.rowCount)throw new ApiError(409,'ALREADY_EXISTS','Oportunidade já cadastrada.');
          receipt={id:o.id,action:command.action,state:'discovery',rowVersion:1,resourceType:'opportunity'};
          break;
        }
        case 'changeStage':{
          const curr=await query('SELECT row_version,stage FROM crm_opportunities WHERE id=$1 AND owner_id=$2 FOR UPDATE',
            [command.opportunityId,context!.actorId]);
          const row=curr.rows[0] as {row_version:number;stage:string}|undefined;
          if(!row)throw new ApiError(404,'NOT_FOUND','Oportunidade não encontrada.');
          if(row.row_version!==command.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','Oportunidade alterada. Atualize o funil.');
          if(!allowedNext[row.stage]?.includes(command.stage))throw new ApiError(409,'INVALID_STATE','Transição comercial não permitida.');
          const updated=await query(
            `UPDATE crm_opportunities SET stage=$1,row_version=row_version+1,updated_at=$2
             WHERE id=$3 AND owner_id=$4 RETURNING row_version`,
            [command.stage,now,command.opportunityId,context!.actorId],
          );
          receipt={id:command.opportunityId,action:command.action,state:command.stage,rowVersion:updated.rows[0].row_version,resourceType:'opportunity'};
          break;
        }
      }
      await query('UPDATE crm_commands SET result=$1,resource_id=$2 WHERE id=$3 AND actor_id=$4',
        [JSON.stringify(receipt),receipt.id,command.key,context!.actorId]);
      return receipt;
    });
    return respond({result},context,command.action==='createLead'||command.action==='createOpportunity'?201:200);
  }catch(error){return failure(error,context);}
}
