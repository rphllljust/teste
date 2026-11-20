import { z } from 'zod';
import { database, databasePool } from '../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { parseAmount } from '../../../../../lib/domain/orders';

const uuid = z.string().uuid();
const input = z.object({ key: uuid, executionId: uuid, description: z.string().trim().min(3).max(1000), amount: z.string().trim().regex(/^\d{1,10}(?:,\d{1,4})?$/) }).strict();
function storedResult(value: unknown) { return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>; }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const orderId = (await params).id;
    if (!uuid.safeParse(orderId).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Ordem inválida.');
    const result = await databasePool().query(`SELECT m.id,m.order_id,m.execution_entry_id,m.description,m.amount,m.status,m.version,m.submitted_at,m.submitted_by,m.created_at,e.resource_kind,e.quantity,e.unit,e.effective_date,e.reference FROM measurements m JOIN service_orders o ON o.id=m.order_id AND o.owner_id=$2 JOIN execution_entries e ON e.id=m.execution_entry_id WHERE m.order_id=$1 ORDER BY m.created_at DESC,m.id DESC`, [orderId, context.actorId]);
    return respond({ items: result.rows.map(row => ({ id:String(row.id), orderId:String(row.order_id), executionId:String(row.execution_entry_id), description:String(row.description), amount:String(row.amount), status:String(row.status), version:Number(row.version), submittedAt:row.submitted_at?String(row.submitted_at):null, submittedBy:row.submitted_by?String(row.submitted_by):null, createdAt:String(row.created_at), execution:{resourceKind:String(row.resource_kind),quantity:String(row.quantity),unit:String(row.unit),effectiveDate:String(row.effective_date),reference:String(row.reference)}, availableCommands:String(row.status)==='draft'?[{id:'submit',label:'Submeter medição',expectedVersion:Number(row.version)}]:[] })) }, context);
  } catch (error) { return failure(error, context); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const orderId = (await params).id;
    if (!uuid.safeParse(orderId).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Ordem inválida.');
    const parsed = input.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Dados da medição inválidos.');
    const p = parsed.data, amount = parseAmount(p.amount);
    if (amount === null) throw new ApiError(400, 'VALIDATION_FAILED', 'Valor da medição inválido.');
    const hash = await fingerprint({ actor:context.actorId, orderId, payload:p });
    const result = await database().transaction(async query => {
      const prior = await query('SELECT request_hash,result FROM field_measurement_events WHERE id=$1', [p.key]);
      if (prior.rows.length) { if (prior.rows[0].request_hash !== hash) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de medição já utilizada.'); return { replayed:true, ...storedResult(prior.rows[0].result) }; }
      const order = await query('SELECT id,status FROM service_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE', [orderId, context!.actorId]);
      if (!order.rows.length) throw new ApiError(404,'NOT_FOUND','Ordem de serviço não encontrada.');
      if (order.rows[0].status !== 'completed') throw new ApiError(409,'INVALID_STATE','A medição exige uma OS concluída.');
      const execution = await query(`SELECT e.id FROM execution_entries e WHERE e.id=$1 AND e.order_id=$2 AND e.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.execution_entry_id=e.id) FOR UPDATE`, [p.executionId,orderId]);
      if (!execution.rows.length) throw new ApiError(409,'EXECUTION_INVARIANT','A execução não existe, foi corrigida ou já possui medição.');
      const id=crypto.randomUUID(), now=new Date().toISOString(), receipt={ok:true,resource:{type:'measurement',id,orderId,executionId:p.executionId,rowVersion:1}};
      await query("INSERT INTO measurements(id,order_id,execution_entry_id,description,amount,status,version,created_at) VALUES($1,$2,$3,$4,$5,'draft',1,$6)",[id,orderId,p.executionId,p.description,amount,now]);
      await query("INSERT INTO field_measurement_events(id,measurement_id,order_id,command,version,actor_id,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,'create',1,$4,$5,$6,$7,$8)",[p.key,id,orderId,context!.actorId,hash,JSON.stringify(receipt),context!.correlationId,now]);
      return receipt;
    });
    return respond(result, context, 'replayed' in result && result.replayed ? 200 : 201);
  } catch (error) { return failure(error, context); }
}
