import { z } from 'zod';
import { database } from '../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../lib/api/http';
import { proposalData, proposalAmounts, projectProposal, commercialToday, type ProposalRow } from '../../../lib/domain/proposals';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const postInput=z.object({
  id:uuid, clientId:uuid,clientVersion:z.number().int().positive(),data:proposalData,
}).strict();
const getInput=z.object({
  q:z.string().max(160).default(''),
  status:z.enum(['','draft','issued','accepted','rejected','expired','cancelled']).default(''),
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export async function GET(request:Request) {
  let context:RequestContext|undefined;
  try {
    context=requestContext(request);
    const url=new URL(request.url),params=url.searchParams;
    const parsed=getInput.safeParse({
      q:params.get('q')??'',status:params.get('status')??'',
      page:params.get('page')??'1',pageSize:params.get('pageSize')??'25',
    });
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros comerciais inválidos.');
    const p=parsed.data,filters=['p.owner_id=?'],binds:unknown[]=[context.actorId];
    if(p.status){filters.push('p.status=?');binds.push(p.status);}
    if(p.q.trim()){filters.push('(p.title ILIKE ? OR c.legal_name ILIKE ?)');binds.push('%'+p.q.trim()+'%','%'+p.q.trim()+'%');}
    const where=filters.join(' AND ');
    const [list,total]=await Promise.all([
      database().prepare(`SELECT p.*,c.legal_name AS client_name
        FROM proposals p JOIN clients c ON c.id=p.client_id AND c.owner_id=p.owner_id
        WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`)
        .bind(...binds,p.pageSize,(p.page-1)*p.pageSize).all<ProposalRow>(),
      database().prepare(`SELECT count(*)::int AS total
        FROM proposals p JOIN clients c ON c.id=p.client_id AND c.owner_id=p.owner_id
        WHERE ${where}`).bind(...binds).first<{total:number}>(),
    ]);
    const count=total?.total??0;
    return respond({items:list.results.map(projectProposal),
      pageInfo:{page:p.page,limit:p.pageSize,offset:(p.page-1)*p.pageSize,total:count,
        sourceTotal:count,hasMore:p.page*p.pageSize<count}},context);
  }catch(err){return failure(err,context);}
}

export async function POST(request:Request) {
  let context:RequestContext|undefined;
  try {
    context=requestContext(request,true);
    const parsed=postInput.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Revise os dados da proposta.');
    const p=parsed.data;
    if(p.data.validUntil<commercialToday())
      throw new ApiError(400,'VALIDATION_FAILED','A validade da proposta não pode estar no passado.');
    let calculated:ReturnType<typeof proposalAmounts>;
    try{calculated=proposalAmounts(p.data);}
    catch(err){throw new ApiError(400,'VALIDATION_FAILED',err instanceof Error?err.message:'Itens comerciais inválidos.');}
    if(!Number.isSafeInteger(calculated.total)||calculated.total<=0||calculated.total>2147483647)
      throw new ApiError(400,'VALIDATION_FAILED','Total da proposta fora da faixa suportada.');
    const hash=await fingerprint({actor:context.actorId,action:'register_proposal',payload:p});
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      const inserted=await query(
        `INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
         VALUES($1,$2,'proposal',$3,'register',$4,'',$5,$6)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [p.id,context!.actorId,p.id,hash,context!.correlationId,now],
      );
      if(!inserted.rowCount){
        const r=await query('SELECT actor_id,request_hash,result FROM business_commands WHERE id=$1',[p.id]);
        const prior=r.rows[0] as {actor_id:string;request_hash:string;result:string}|undefined;
        if(!prior||prior.actor_id!==context!.actorId||prior.request_hash!==hash||!prior.result)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Comando de proposta utilizado anteriormente.');
        return JSON.parse(prior.result) as {resource:{id:string}};
      }
      const client=await query(
        'SELECT row_version,status FROM clients WHERE id=$1 AND owner_id=$2 FOR SHARE',
        [p.clientId,context!.actorId],
      );
      const found=client.rows[0] as {row_version:number;status:string}|undefined;
      if(!found)throw new ApiError(404,'NOT_FOUND','Cliente do ERP não encontrado.');
      if(found.row_version!==p.clientVersion)
        throw new ApiError(409,'VERSION_CONFLICT','O cliente foi atualizado. Atualize a proposta.');
      if(found.status!=='active')
        throw new ApiError(409,'INVALID_STATE','Cliente inativo não pode receber proposta.');
      const proposal=await query(
        `INSERT INTO proposals(id,owner_id,client_id,title,scope,valid_until,total,status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'draft',$8,$8)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [p.id,context!.actorId,p.clientId,p.data.title,p.data.scope,p.data.validUntil,calculated.total,now],
      );
      if(!proposal.rowCount)throw new ApiError(409,'ALREADY_EXISTS','Identificador de proposta já cadastrado.');
      for(const line of calculated.lines){
        await query(
          `INSERT INTO proposal_lines(id,proposal_id,position,description,unit,quantity,unit_price,amount)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [crypto.randomUUID(),p.id,line.position,line.description,line.unit,line.quantity,line.unitPrice,line.amount],
        );
      }
      const receipt={ok:true,resource:{type:'proposal',id:p.id,rowVersion:1},refreshPolicy:['proposals.list']};
      await query('UPDATE business_commands SET result=$1 WHERE id=$2 AND actor_id=$3',
        [JSON.stringify(receipt),p.id,context!.actorId]);
      return receipt;
    });
    return respond(result,context,201);
  }catch(err){return failure(err,context);}
}
