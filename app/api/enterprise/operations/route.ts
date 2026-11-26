import { z } from 'zod';
import type { PoolClient } from 'pg';
import { databasePool } from '../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic = 'force-dynamic';

const filters = z.object({
  q: z.string().trim().max(120).default(''),
  queue: z.enum(['all','attention','overdue','unmeasured','draft','authorized','executing','completed']).default('attention'),
  category: z.enum(['all','Locação','Serviços','Transporte','Obra']).default('all'),
  sort: z.enum(['priority','deadline','recent','client']).default('priority'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

const orderings: Record<string,string> = {
  priority: 'attention_rank ASC, o.due_date ASC NULLS LAST, o.created_at DESC, o.id DESC',
  deadline: 'o.due_date ASC NULLS LAST, o.created_at DESC, o.id DESC',
  recent: 'o.created_at DESC, o.id DESC',
  client: 'o.client ASC, o.created_at DESC, o.id DESC',
};

/**
 * Commercial and Field Service use the same read-only operational projection.
 * Every count and row is scoped by the authenticated owner. Historical records
 * with owner_id NULL are excluded, never reattached to arbitrary actors.
 * Operators open the authoritative order detail to execute server-authorized
 * transitions; this projection never invents or executes business commands.
 */
export async function GET(request:Request){
  let context:RequestContext|undefined;
  let client:PoolClient|undefined;
  try {
    context=requestContext(request);
    const parsed=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros do centro operacional inválidos.');
    const p=parsed.data;
    const search=p.q ? '%'+p.q+'%' : '';
    const base=`o.owner_id=$1
      AND ($2='' OR o.title ILIKE $2 OR o.client ILIKE $2 OR o.id::text ILIKE $2)
      AND ($3='all' OR o.category=$3)`;
    const overdue=`o.due_date IS NOT NULL AND o.due_date < CURRENT_DATE
        AND o.status NOT IN ('completed','cancelled')`;
    const unmeasured=`o.status='completed'
        AND NOT EXISTS (SELECT 1 FROM measurements done WHERE done.order_id=o.id)`;
    const attention=`((${overdue}) OR (${unmeasured}) OR o.status IN ('draft','prepared'))`;
    const queue=`($4='all'
      OR ($4='attention' AND ${attention})
      OR ($4='overdue' AND ${overdue})
      OR ($4='unmeasured' AND ${unmeasured})
      OR ($4='draft' AND o.status IN ('draft','prepared'))
      OR ($4='authorized' AND o.status IN ('authorized','planned'))
      OR ($4='executing' AND o.status IN ('executing','in_progress'))
      OR ($4='completed' AND o.status='completed'))`;
    const params=[context.actorId,search,p.category,p.queue];
    const attentionRank=`CASE WHEN ${overdue} THEN 0 WHEN ${unmeasured} THEN 1
      WHEN o.status IN ('executing','in_progress') THEN 2
      WHEN o.status IN ('draft','prepared') THEN 3 ELSE 4 END`;
    client=await databasePool().connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const [summary,matched,rows]=await (async()=>{
      // Serial execution on one pg client preserves compatibility across driver versions.
      const summary=await client!.query(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER(WHERE o.status IN ('draft','prepared'))::int AS draft,
        COUNT(*) FILTER(WHERE o.status IN ('executing','in_progress'))::int AS executing,
        COUNT(*) FILTER(WHERE ${overdue})::int AS overdue,
        COUNT(*) FILTER(WHERE ${unmeasured})::int AS unmeasured,
        COUNT(*) FILTER(WHERE o.status IN ('authorized','planned'))::int AS authorized
        FROM service_orders o WHERE o.owner_id=$1`,[context!.actorId]);
      const matched=await client!.query(`SELECT COUNT(*)::int AS total
        FROM service_orders o WHERE ${base} AND ${queue}`,params);
      const rows=await client!.query(`SELECT o.id,o.title,o.client,o.category,o.status,
        o.description,o.created_at,o.due_date,
        (${attentionRank}) AS attention_rank,
        (SELECT COUNT(*)::int FROM measurements m WHERE m.order_id=o.id) AS measurements,
        (SELECT COUNT(*)::int FROM invoices i WHERE i.order_id=o.id) AS invoices,
        (SELECT COUNT(*)::int FROM execution_entries ee WHERE ee.order_id=o.id
          AND ee.kind='report'
          AND NOT EXISTS (SELECT 1 FROM execution_entries rev WHERE rev.reverses_id=ee.id)) AS executions
        FROM service_orders o WHERE ${base} AND ${queue}
        ORDER BY ${orderings[p.sort]} LIMIT $5 OFFSET $6`,
        [...params,p.pageSize,(p.page-1)*p.pageSize]);
      return [summary,matched,rows];
    })();
    await client.query('COMMIT');
    const s=summary.rows[0] as Record<string,unknown>;
    const total=Number((matched.rows[0] as {total:number}).total);
    const items=(rows.rows as Array<Record<string,unknown>>).map(row=>{
      const status=String(row.status);
      const hasDue=row.due_date!=null&&String(row.due_date).length>0;
      const isOverdue=hasDue && String(row.due_date).slice(0,10)<
        new Date().toISOString().slice(0,10) && !['completed','cancelled'].includes(status);
      const isUnmeasured=status==='completed'&&Number(row.measurements)===0;
      return {
        id:String(row.id),title:String(row.title),client:String(row.client),
        category:String(row.category),status,
        description:String(row.description??''),
        createdAt:String(row.created_at),
        dueDate:row.due_date==null?null:String(row.due_date).slice(0,10),
        attentionRank:Number(row.attention_rank),
        overdue:isOverdue,unmeasured:isUnmeasured,
        evidence:{measurements:Number(row.measurements),invoices:Number(row.invoices),
          executions:Number(row.executions)},
      };
    });
    return respond({
      items,
      summary:{
        total:Number(s.total),draft:Number(s.draft),executing:Number(s.executing),
        overdue:Number(s.overdue),unmeasured:Number(s.unmeasured),authorized:Number(s.authorized),
      },
      pageInfo:{page:p.page,pageSize:p.pageSize,total,hasMore:p.page*p.pageSize<total},
      source:'postgres_owner_scoped_operations',
      generatedAt:new Date().toISOString(),
      note:'Indicadores globais e registros calculados somente sobre OS atribuídas ao operador autenticado; ações dependem do estado e das permissões no detalhe.',
    },context);
  }catch(error){
    if(client){try{await client.query('ROLLBACK');}catch{/* preserve original error */}}
    return failure(error,context);
  }finally{client?.release();}
}
