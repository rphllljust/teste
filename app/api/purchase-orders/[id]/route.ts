import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError,failure,requestContext,respond,type RequestContext } from '../../../../lib/api/http';
import { projectCustomerPO } from '../route';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
type PORow=Parameters<typeof projectCustomerPO>[0];

export async function GET(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const {id}=await params;
    if(!z.string().uuid().safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador de pedido inválido.');
    const [row,contracts,history]=await Promise.all([
      database().prepare(`SELECT po.*,p.title AS proposal_title,p.total AS proposal_total,
        c.legal_name AS client_name
        FROM purchase_orders po
        JOIN proposals p ON p.id=po.proposal_id AND p.owner_id=po.owner_id
        JOIN clients c ON c.id=po.client_id AND c.owner_id=po.owner_id
        WHERE po.id=? AND po.owner_id=?`)
        .bind(id,context.actorId).first<PORow>(),
      database().prepare(`SELECT count(*)::int AS n
        FROM contracts WHERE purchase_order_id=? AND owner_id=?`)
        .bind(id,context.actorId).first<{n:number}>(),
      database().prepare(`SELECT command,created_at AS "createdAt"
        FROM business_commands WHERE entity_type='purchaseOrder'
        AND entity_id=? AND actor_id=? ORDER BY created_at DESC LIMIT 20`)
        .bind(id,context.actorId).all<{command:string;createdAt:string}>(),
    ]);
    if(!row)throw new ApiError(404,'NOT_FOUND','Pedido do cliente não encontrado.');
    const linked=contracts?.n??0;
    return respond({projection:{
      ...projectCustomerPO(row,linked===0),
      history:history.results,
      warnings:linked>0?['A PO possui contrato vinculado e não pode ser cancelada.']:[],
    }},context);
  }catch(err){return failure(err,context);}
}
