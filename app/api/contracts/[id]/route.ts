import {z} from 'zod';
import {database} from '../../../../db/raw';
import {
  ApiError,failure,requestContext,respond,type RequestContext,
} from '../../../../lib/api/http';
import {projectClient,type ClientRow} from '../../../../lib/domain/clients';
import {projectContract,type ContractRow} from '../../../../lib/domain/contracts';
import {commercialToday} from '../../../../lib/domain/proposals';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const {id}=await params;
    if(!z.string().uuid().safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador de contrato inválido.');
    const [contract,related,history]=await Promise.all([
      database().prepare(`SELECT ct.*,c.legal_name AS client_name,
        p.title AS proposal_title,po.reference AS po_reference,
        (SELECT count(*)::int FROM service_orders s WHERE s.contract_id=ct.id
         AND s.owner_id=ct.owner_id AND s.status NOT IN ('completed','cancelled')) AS open_orders
        FROM contracts ct
        JOIN clients c ON c.id=ct.client_id AND c.owner_id=ct.owner_id
        JOIN proposals p ON p.id=ct.proposal_id AND p.owner_id=ct.owner_id
        LEFT JOIN purchase_orders po ON po.id=ct.purchase_order_id AND po.owner_id=ct.owner_id
        WHERE ct.id=? AND ct.owner_id=?`)
        .bind(id,context.actorId).first<ContractRow>(),
      database().prepare(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status NOT IN ('completed','cancelled'))::int AS "openTotal"
        FROM service_orders WHERE contract_id=? AND owner_id=?`)
        .bind(id,context.actorId).first<{total:number;openTotal:number}>(),
      database().prepare(`SELECT command,created_at AS "createdAt" FROM business_commands
        WHERE entity_type='contract' AND entity_id=? AND actor_id=?
        ORDER BY created_at DESC LIMIT 20`)
        .bind(id,context.actorId).all<{command:string;createdAt:string}>(),
    ]);
    if(!contract)throw new ApiError(404,'NOT_FOUND','Contrato não encontrado.');
    const client=await database().prepare('SELECT * FROM clients WHERE id=? AND owner_id=?')
      .bind(contract.client_id,context.actorId).first<ClientRow>();
    if(!client)throw new ApiError(409,'CONSTRAINT_VIOLATION','Contrato com cliente ausente.');
    const projection=projectContract(contract);
    return respond({projection:{
      ...projection,
      // A contract only makes an order available when its client and
      // contract are both active; the OS endpoint rechecks these in SQL.
      client:projectClient(client),
      canCreateOrder:contract.status==='active'&&client.status==='active'&&
        contract.starts_on<=commercialToday()&&
        (contract.ends_on===null||contract.ends_on>=commercialToday()),
      related:{orders:related??{total:0,openTotal:0}},
      history:history.results,
      warnings:[],
    }},context);
  }catch(err){return failure(err,context);}
}
