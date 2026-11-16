import { z } from 'zod';
import { database } from '../../../../../db/raw';
import {
  ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext,
} from '../../../../../lib/api/http';
import { commercialToday, proposalAmounts, proposalData } from '../../../../../lib/domain/proposals';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
const uuid=z.string().uuid();
const base={key:uuid,version:z.number().int().positive()};
const proposalCommand=z.discriminatedUnion('command',[
  z.object({...base,command:z.literal('revise'),data:proposalData}).strict(),
  z.object({...base,command:z.literal('issue')}).strict(),
  z.object({...base,command:z.literal('accept'),reference:z.string().trim().min(3).max(160)}).strict(),
  z.object({...base,command:z.literal('reject')}).strict(),
  z.object({...base,command:z.literal('expire')}).strict(),
  z.object({...base,command:z.literal('cancel')}).strict(),
]);
type ProposalState={id:string;status:string;row_version:number;valid_until:string;client_id:string};
function invalid(message:string):never{throw new ApiError(409,'INVALID_STATE',message);}

export async function POST(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const {id}=await params;
    if(!uuid.safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador de proposta inválido.');
    const parsed=proposalCommand.safeParse(await jsonBody(request));
    if(!parsed.success)
      throw new ApiError(400,'VALIDATION_FAILED','Comando comercial inválido.');
    const command=parsed.data;
    const today=commercialToday();
    let amounts:ReturnType<typeof proposalAmounts>|null=null;
    if(command.command==='revise'){
      if(command.data.validUntil<today)
        throw new ApiError(400,'VALIDATION_FAILED','A validade da proposta não pode estar no passado.');
      try{amounts=proposalAmounts(command.data);}
      catch(e){throw new ApiError(400,'VALIDATION_FAILED',e instanceof Error?e.message:'Itens inválidos.');}
      if(!Number.isSafeInteger(amounts.total)||amounts.total<=0||amounts.total>2147483647)
        throw new ApiError(400,'VALIDATION_FAILED','Total comercial fora da faixa suportada.');
    }
    const hash=await fingerprint({actorId:context.actorId,proposalId:id,command});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      // Retry receipt and business mutation live inside the same PostgreSQL
      // transaction. The unique command key serializes concurrent retries.
      const reserved=await query(
        `INSERT INTO business_commands
         (id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
         VALUES($1,$2,'proposal',$3,$4,$5,'',$6,$7)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [command.key,context!.actorId,id,command.command,hash,context!.correlationId,now],
      );
      if(!reserved.rowCount){
        const previous=await query(
          'SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1',
          [command.key],
        );
        const old=previous.rows[0] as {
          actor_id:string;entity_type:string;entity_id:string;request_hash:string;result:string;
        }|undefined;
        if(!old||old.actor_id!==context!.actorId||old.entity_type!=='proposal'||old.entity_id!==id||
          old.request_hash!==hash||!old.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Este identificador já pertence a outro comando.');
        return JSON.parse(old.result) as {resource:{id:string;rowVersion:number}};
      }
      const existing=await query(
        `SELECT id,status,row_version,valid_until,client_id FROM proposals
         WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [id,context!.actorId],
      );
      const p=existing.rows[0] as ProposalState|undefined;
      if(!p)throw new ApiError(404,'NOT_FOUND','Proposta não encontrada.');
      if(p.row_version!==command.version)
        throw new ApiError(409,'VERSION_CONFLICT','A proposta foi alterada. Recarregue os dados.');
      const expired=p.valid_until<today;
      let status=p.status,reference:string|null=null;
      switch(command.command){
        case 'revise':
          if(p.status!=='draft')invalid('Somente rascunhos podem ter itens revisados.');
          // Lock the current ERP client as well, so a draft cannot be
          // revised during a concurrent deactivation of that client.
          {
            const client=await query(
              `SELECT id FROM clients WHERE id=$1 AND owner_id=$2 AND status='active' FOR SHARE`,
              [p.client_id,context!.actorId],
            );
            if(!client.rowCount)invalid('O cliente não está ativo.');
          }
          await query(
            `UPDATE proposals SET title=$1,scope=$2,valid_until=$3,total=$4,
             row_version=row_version+1,updated_at=$5
             WHERE id=$6 AND owner_id=$7`,
            [command.data.title,command.data.scope,command.data.validUntil,amounts!.total,
              now,id,context!.actorId],
          );
          await query('DELETE FROM proposal_lines WHERE proposal_id=$1',[id]);
          for(const line of amounts!.lines){
            await query(
              `INSERT INTO proposal_lines
               (id,proposal_id,position,description,unit,quantity,unit_price,amount)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
              [crypto.randomUUID(),id,line.position,line.description,line.unit,
                line.quantity,line.unitPrice,line.amount],
            );
          }
          break;
        case 'issue':
          if(p.status!=='draft'||expired)invalid('Somente rascunho válido pode ser emitido.');
          {
            const client=await query(
              `SELECT id FROM clients WHERE id=$1 AND owner_id=$2 AND status='active' FOR SHARE`,
              [p.client_id,context!.actorId],
            );
            if(!client.rowCount)invalid('Cliente inativo não pode receber emissão.');
            const counts=await query(
              `SELECT count(*)::int AS count,coalesce(sum(amount),0)::bigint AS total
               FROM proposal_lines WHERE proposal_id=$1`,[id],
            );
            const totals=await query('SELECT total FROM proposals WHERE id=$1',[id]);
            if(counts.rows[0].count===0||
              BigInt(counts.rows[0].total)!==BigInt(totals.rows[0].total))
              invalid('As linhas e o valor da proposta não estão íntegros.');
          }
          status='issued';
          await query(
            `UPDATE proposals SET status='issued',row_version=row_version+1,updated_at=$1
             WHERE id=$2 AND owner_id=$3`,[now,id,context!.actorId],
          );
          break;
        case 'accept':
          if(p.status!=='issued'||expired)invalid('A proposta precisa estar emitida e vigente.');
          status='accepted';reference=command.reference;
          await query(
            `UPDATE proposals SET status='accepted',evidence_reference=$1,
             row_version=row_version+1,updated_at=$2 WHERE id=$3 AND owner_id=$4`,
            [reference,now,id,context!.actorId],
          );
          break;
        case 'reject':
          if(p.status!=='issued'||expired)invalid('Somente proposta emitida e vigente pode ser rejeitada.');
          status='rejected';
          await query(
            `UPDATE proposals SET status='rejected',row_version=row_version+1,updated_at=$1
             WHERE id=$2 AND owner_id=$3`,[now,id,context!.actorId],
          );
          break;
        case 'expire':
          if(p.status!=='issued'||!expired)invalid('Somente proposta emitida com validade vencida pode expirar.');
          status='expired';
          await query(
            `UPDATE proposals SET status='expired',row_version=row_version+1,updated_at=$1
             WHERE id=$2 AND owner_id=$3`,[now,id,context!.actorId],
          );
          break;
        case 'cancel':
          if(!['draft','issued'].includes(p.status))invalid('Somente rascunho ou proposta emitida pode ser cancelada.');
          status='cancelled';
          await query(
            `UPDATE proposals SET status='cancelled',row_version=row_version+1,updated_at=$1
             WHERE id=$2 AND owner_id=$3`,[now,id,context!.actorId],
          );
          break;
      }
      const receipt={ok:true,resource:{type:'proposal',id,rowVersion:p.row_version+1},
        state:status,refreshPolicy:['proposals.list','proposals.detail']};
      await query(
        'UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',
        [JSON.stringify(receipt),command.key,context!.actorId],
      );
      return receipt;
    });
    return respond(result,context);
  }catch(err){return failure(err,context);}
}
