import {z} from 'zod';
import {databasePool} from '../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';

export const dynamic='force-dynamic';
type RouteContext={params:Promise<{id:string}>};
const uuid=z.string().uuid();
const filters=z.object({
 pageSize:z.coerce.number().int().min(1).max(50).default(20),
 cursorAt:z.string().datetime({offset:true}).optional(),
 cursorId:uuid.optional(),
 cursorSource:z.enum(['order','measurement']).optional(),
}).strict();
type EventRow={id:string;source:'order'|'measurement';command:string;version:number;created_at:string;
 actor_id:string|null;target_id:string|null;correlation_id:string|null};

/** Read-only append-only trace, strictly anchored to an owned service order. */
export async function GET(request:Request,{params}:RouteContext){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const {id}=await params;
  if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Ordem inválida.');
  const parsed=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Paginação inválida.');
  const {pageSize,cursorAt,cursorId,cursorSource}=parsed.data;
  const count=[cursorAt,cursorId,cursorSource].filter(Boolean).length;
  if(count!==0&&count!==3)throw new ApiError(400,'VALIDATION_FAILED','Cursor incompleto.');
  const hasCursor=count===3;
  const client=await databasePool().connect();
  try{
   await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const owned=await client.query('SELECT id FROM service_orders WHERE id=$1 AND owner_id=$2 LIMIT 1',[id,context.actorId]);
   if(!owned.rows.length)throw new ApiError(404,'NOT_FOUND','Ordem não encontrada.');
   const sql="WITH events AS ("+
    "SELECT id,'order'::text AS source,command,version,created_at,actor_id,target_id,correlation_id "+
    "FROM order_events WHERE order_id=$1 UNION ALL "+
    "SELECT id,'measurement'::text AS source,command,version,created_at,actor_id,"+
    "measurement_id AS target_id,correlation_id FROM field_measurement_events WHERE order_id=$1) "+
    "SELECT id,source,command,version,created_at,actor_id,target_id,correlation_id FROM events "+
    (hasCursor?"WHERE (created_at,source,id)<($2::text,$3::text,$4::text) ":"")+
    "ORDER BY created_at DESC,source DESC,id DESC LIMIT "+(hasCursor?"$5":"$2");
   const values=hasCursor?[id,cursorAt,cursorSource,cursorId,pageSize+1]:[id,pageSize+1];
   const found=await client.query<EventRow>(sql,values);
   const items=found.rows.slice(0,pageSize).map(row=>({
    id:row.id,source:row.source,command:row.command,version:Number(row.version),
    createdAt:row.created_at,actorId:row.actor_id,targetId:row.target_id,correlationId:row.correlation_id,
   }));
   const hasMore=found.rows.length>pageSize;
   const last=items.at(-1);
   await client.query('COMMIT');
   return respond({orderId:id,source:'postgres_owned_event_trace',items,
    pageInfo:{pageSize,hasMore,nextCursor:hasMore&&last?
     {cursorAt:last.createdAt,cursorSource:last.source,cursorId:last.id}:null},
    note:'Eventos registrados não demonstram conclusão de lançamentos contábeis.',
   },context);
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
 }catch(error){return failure(error,context);}
}
