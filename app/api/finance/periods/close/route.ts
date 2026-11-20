import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, validDate, type RequestContext } from '../../../../../lib/api/http';

const command = z.object({ id: z.string().uuid(), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().min(1).max(160) }).strict();
const periodListQuery=z.object({
 q:z.string().trim().max(160).default(''),
 from:z.union([z.literal(''),z.string().refine(validDate)]).default(''),
 to:z.union([z.literal(''),z.string().refine(validDate)]).default(''),
 sort:z.enum(['periodEnd.desc','periodEnd.asc','closedAt.desc']).default('periodEnd.desc'),
 page:z.coerce.number().int().min(1).max(100000).default(1),
}).strict();

export async function GET(request: Request) {
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const p=new URL(request.url).searchParams;
  const raw=Object.fromEntries(p);
  const parsed=periodListQuery.safeParse(raw);
  if(!parsed.success||parsed.data.from&&parsed.data.to&&parsed.data.from>parsed.data.to)
    throw new ApiError(400,'VALIDATION_FAILED','Filtros do fechamento financeiro inválidos.');
  const filter=parsed.data;
  const clauses=['p.actor_id=?'];
  const params:unknown[]=[context.actorId];
  if(filter.from){clauses.push('p.period_end>=?');params.push(filter.from);}
  if(filter.to){clauses.push('p.period_end<=?');params.push(filter.to);}
  if(filter.q){clauses.push(`EXISTS(SELECT 1 FROM finance_audit_events a WHERE a.entity_type='finance_period'
    AND a.entity_id=p.id AND a.action='period_closed'
    AND coalesce(a.metadata::jsonb->>'reference','') ILIKE ?)`);
    params.push('%'+filter.q.replace(/[\\%_]/g,'\\$&')+'%');
  }
  const order=filter.sort==='periodEnd.asc'?'p.period_end ASC,p.id ASC':
   filter.sort==='closedAt.desc'?'p.closed_at DESC,p.id DESC':
   'p.period_end DESC,p.id DESC';
  const where=clauses.join(' AND ');
  const db=database();
  const results=await db.snapshot([
    db.prepare(`SELECT p.id,p.period_start AS "periodStart",
      p.period_end AS "periodEnd",p.status,p.closed_at AS "closedAt",
      coalesce((SELECT a.metadata::jsonb->>'reference'
       FROM finance_audit_events a WHERE a.entity_type='finance_period'
       AND a.entity_id=p.id AND a.action='period_closed'
       ORDER BY a.occurred_at DESC LIMIT 1),'') AS reference
      FROM finance_period_closes p WHERE ${where}
      ORDER BY ${order} LIMIT 25 OFFSET ?`).bind(...params,(filter.page-1)*25),
    db.prepare(`SELECT count(*)::int AS total FROM finance_period_closes p
      WHERE ${where}`).bind(...params),
  ]);
  const total=Number((results[1].results[0] as {total:number|string}|undefined)?.total??0);
  return respond({items:results[0].results,pageInfo:{
    page:filter.page,total,hasMore:filter.page*25<total,
  }},context);
 }catch(error){return failure(error,context);}
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success || parsed.data.periodStart > parsed.data.periodEnd) throw new ApiError(400, 'VALIDATION_FAILED', 'Período de fechamento inválido.');
    const data = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, data });
    const db = database();
    const prior = await db.prepare('SELECT id,request_hash FROM finance_period_closes WHERE id=? AND actor_id=?').bind(data.id, context.actorId).first<{ id: string; request_hash: string }>();
    if (prior) { if (prior.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de fechamento já utilizado.'); return respond({ id: data.id, replayed: true }, context); }
    const overlap = await db.prepare("SELECT id FROM finance_period_closes WHERE actor_id=? AND status='closed' AND period_start<=? AND period_end>=? LIMIT 1").bind(context.actorId, data.periodEnd, data.periodStart).first();
    if (overlap) throw new ApiError(409, 'FINANCE_PERIOD_OVERLAP', 'O período informado se sobrepõe a um período já fechado.');
    await db.transaction(async query => {
      await query('INSERT INTO finance_period_closes (id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) VALUES ($1,$2,$3,\'closed\',$4,$5,$6,$7)', [data.id, data.periodStart, data.periodEnd, context!.actorId, requestHash, context!.correlationId, new Date().toISOString()]);
      await query(`INSERT INTO finance_audit_events (id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) VALUES ($1,'finance_period',$2,'period_closed',$3,$4,$5,$6,$7)`, [crypto.randomUUID(), data.id, context!.actorId, requestHash, context!.correlationId, JSON.stringify({ periodStart: data.periodStart, periodEnd: data.periodEnd, reference: data.reference }), new Date().toISOString()]);
    });
    return respond({ id: data.id, periodStart: data.periodStart, periodEnd: data.periodEnd, status: 'closed' }, context, 201);
  } catch (error) { return failure(error, context); }
}
