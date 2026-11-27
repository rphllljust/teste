import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

const command = z.object({ key: z.string().uuid(), statementId: z.string().uuid(), lineId: z.string().uuid(), command: z.enum(['match', 'unmatch']), version: z.number().int().positive(), targetType: z.enum(['receipt', 'payment']).optional(), targetId: z.string().uuid().optional(), matchId: z.string().uuid().optional() }).strict();

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success || (parsed.data.command === 'match' && (!parsed.data.targetType || !parsed.data.targetId)) || (parsed.data.command === 'unmatch' && !parsed.data.matchId)) throw new ApiError(400, 'VALIDATION_FAILED', 'Comando de conciliação inválido.');
    const data = parsed.data;
    const hash = await fingerprint({ actor: context.actorId, data });
    const db = database();
    const prior = await db.prepare('SELECT actor_id,request_hash FROM bank_reconciliation_events WHERE id=?').bind(data.key).first<{ actor_id: string; request_hash: string }>();
    if (prior) { if (prior.actor_id !== context.actorId || prior.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave de conciliação já utilizada.'); return respond({ id: data.key, replayed: true }, context); }
    await db.transaction(async query => {
      const line = await query('SELECT amount FROM bank_statement_lines l JOIN bank_statements s ON s.id=l.statement_id WHERE l.id=$1 AND l.statement_id=$2 AND s.actor_id=$3 FOR UPDATE', [data.lineId, data.statementId, context!.actorId]);
      if (!line.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Linha de extrato indisponível.');
      if (data.command === 'match') {
        const expectedKind = Number(line.rows[0].amount) >= 0 ? 'receipt' : 'payment';
        if (data.targetType !== expectedKind) throw new ApiError(409, 'RECONCILIATION_SIGN_CONFLICT', 'O sinal da linha não corresponde ao tipo de lançamento.');
        const table = expectedKind === 'receipt' ? 'receivable_settlements' : 'payable_payments';
        const target = await query(`SELECT id,amount FROM ${table} WHERE id=$1 AND actor_id=$2 AND kind=$3 FOR UPDATE`, [data.targetId, context!.actorId, expectedKind]);
        if (!target.rowCount || Math.abs(Number(line.rows[0].amount)) !== Number(target.rows[0].amount)) throw new ApiError(409, 'RECONCILIATION_AMOUNT_CONFLICT', 'O valor do lançamento não corresponde ao extrato.');
        const targetColumn=expectedKind==='receipt'?'receipt_id':'payment_id';
        const alreadyAssigned=await query(
          'SELECT 1 FROM bank_reconciliation_events m WHERE m.'+targetColumn+'=$1 '+
          "AND m.kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=m.id) LIMIT 1",
          [data.targetId]);
        if(alreadyAssigned.rowCount)throw new ApiError(409,'RECONCILIATION_TARGET_USED','Lançamento já conciliado em outro extrato.');
        const reversed=await query('SELECT 1 FROM '+table+' WHERE reverses_id=$1 LIMIT 1',[data.targetId]);
        if(reversed.rowCount)throw new ApiError(409,'RECONCILIATION_REVERSED','O lançamento selecionado foi estornado.');
        const active = await query("SELECT 1 FROM bank_reconciliation_events WHERE line_id=$1 AND kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=bank_reconciliation_events.id)", [data.lineId]);
        if (active.rowCount) throw new ApiError(409, 'RECONCILIATION_ALREADY_MATCHED', 'A linha já está conciliada.');
        await query(`INSERT INTO bank_reconciliation_events (id,line_id,kind,${expectedKind === 'receipt' ? 'receipt_id' : 'payment_id'},created_at,actor_id,request_hash,correlation_id) VALUES ($1,$2,'match',$3,$4,$5,$6,$7)`, [data.key, data.lineId, data.targetId, new Date().toISOString(), context!.actorId, hash, context!.correlationId]);
      } else {
        const match = await query("SELECT id FROM bank_reconciliation_events WHERE id=$1 AND line_id=$2 AND kind='match'", [data.matchId, data.lineId]);
        if (!match.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Conciliação ativa não encontrada.');
        const alreadyUndone=await query('SELECT id FROM bank_reconciliation_events WHERE reverses_id=$1',[data.matchId]);
        if(alreadyUndone.rowCount)throw new ApiError(409,'RECONCILIATION_ALREADY_UNMATCHED','Correspondência já desfeita.');
        await query('INSERT INTO bank_reconciliation_events (id,line_id,kind,reverses_id,created_at,actor_id,request_hash,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [data.key, data.lineId, 'unmatch', data.matchId, new Date().toISOString(), context!.actorId, hash, context!.correlationId]);
      }
    });
    return respond({ id: data.key }, context, 201);
  } catch (error) { return failure(error, context); }
}
