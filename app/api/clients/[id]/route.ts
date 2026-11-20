import {z} from 'zod';
import {database} from '../../../../db/raw';
import {projectClient,type ClientRow} from '../../../../lib/domain/clients';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../lib/api/http';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:RouteContext){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const {id}=await params;
    if(!z.string().uuid().safeParse(id).success)
      throw new ApiError(400,'VALIDATION_FAILED','Identificador de cliente inválido.');
    const [row,orders,proposals,contracts,history]=await Promise.all([
      database().prepare('SELECT * FROM clients WHERE id=? AND owner_id=?')
        .bind(id,context.actorId).first<ClientRow>(),
      database().prepare('SELECT count(*)::int AS total FROM service_orders WHERE client_id=? AND owner_id=?')
        .bind(id,context.actorId).first<{total:number}>(),
      database().prepare(`SELECT id,title,status,valid_until AS "validUntil",total
        FROM proposals WHERE client_id=? AND owner_id=?
        ORDER BY created_at DESC,id DESC LIMIT 20`)
        .bind(id,context.actorId).all<{id:string;title:string;status:string;validUntil:string;total:number}>(),
      database().prepare(`SELECT id,reference,status,starts_on AS "startsOn",ends_on AS "endsOn"
        FROM contracts WHERE client_id=? AND owner_id=?
        ORDER BY created_at DESC,id DESC LIMIT 20`)
        .bind(id,context.actorId).all<{id:string;reference:string;status:string;startsOn:string;endsOn:string|null}>(),
      database().prepare(`SELECT command,created_at AS "createdAt" FROM business_commands
        WHERE entity_type='client' AND entity_id=? AND actor_id=?
        ORDER BY created_at DESC LIMIT 20`)
        .bind(id,context.actorId).all<{command:string;createdAt:string}>(),
    ]);
    if(!row)throw new ApiError(404,'NOT_FOUND','Cliente não encontrado.');
    return respond({projection:{...projectClient(row),
      related:{orders:{total:orders?.total??0},proposals:proposals.results,contracts:contracts.results},
      history:history.results,warnings:[],
    }},context);
  }catch(err){return failure(err,context);}
}
