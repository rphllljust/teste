import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { projectProposal, type ProposalRow } from '../../../../lib/domain/proposals';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
type CommercialLine={
  description:string;unit:string;quantityScaled:string;unitPriceScaled:string;amountScaled:string;
};
export async function GET(request:Request,{params}:RouteContext) {
  let context:RequestContext|undefined;
  try {
    context=requestContext(request);
    const {id}=await params;
    if(!z.string().uuid().safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador de proposta inválido.');
    const db=database();
    const [proposal,lines,related,revision,history,origin]=await Promise.all([
      db.prepare(`SELECT p.*,c.legal_name AS client_name
        FROM proposals p JOIN clients c ON c.id=p.client_id AND c.owner_id=p.owner_id
        WHERE p.id=? AND p.owner_id=?`)
        .bind(id,context.actorId).first<ProposalRow>(),
      db.prepare(`SELECT description,unit,quantity::text AS "quantityScaled",
        unit_price::text AS "unitPriceScaled",amount::text AS "amountScaled"
        FROM proposal_lines WHERE proposal_id=?
        AND EXISTS(SELECT 1 FROM proposals WHERE id=? AND owner_id=?)
        ORDER BY position,id`).bind(id,id,context.actorId).all<CommercialLine>(),
      db.prepare(`SELECT count(*)::int AS total FROM purchase_orders
        WHERE proposal_id=? AND owner_id=?`).bind(id,context.actorId).first<{total:number}>(),
      db.prepare(`SELECT id FROM proposals WHERE predecessor_id=? AND owner_id=?
        ORDER BY created_at DESC,id DESC LIMIT 1`).bind(id,context.actorId).first<{id:string}>(),
      db.prepare(`SELECT command,created_at AS "createdAt" FROM business_commands
        WHERE entity_type='proposal' AND entity_id=? AND actor_id=?
        UNION ALL SELECT action AS command,created_at AS "createdAt" FROM crm_commands
        WHERE resource_id=? AND actor_id=? AND action='createDraftProposal'
        ORDER BY "createdAt" DESC LIMIT 20`)
        .bind(id,context.actorId,id,context.actorId).all<{command:string;createdAt:string}>(),
      db.prepare(`SELECT opportunity_id AS "opportunityId"
        FROM crm_opportunity_proposals WHERE proposal_id=? AND owner_id=?`)
        .bind(id,context.actorId).first<{opportunityId:string}>(),
    ]);
    if(!proposal)throw new ApiError(404,'NOT_FOUND','Proposta não encontrada.');
    const result=projectProposal(proposal);
    return respond({projection:{
      ...result,
      // The revision-cloning workflow remains unavailable until its
      // own unique-origin and lineage invariants have been implemented.
      availableCommands:result.availableCommands.filter(c=>c.id!=='revision'),
      lines:lines.results,
      related:{purchaseOrders:{total:related?.total??0},revisionId:revision?.id??null},
      history:history.results,
      origin:origin?{kind:'crmOpportunity',opportunityId:origin.opportunityId}:null,
      warnings:['Criação de revisão e registro de PO permanecem indisponíveis até implementação e homologação específicas.'],
    }},context);
  }catch(err){return failure(err,context);}
}
