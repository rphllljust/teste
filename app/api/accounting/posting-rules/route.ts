import { z } from 'zod';
import { database } from '../../../../db/raw';
import { lockFinancePeriodScope } from '../../../../lib/application/finance';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic = 'force-dynamic';
const sourceType = 'invoice_billing';
const command = z.object({
  commandKey: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  debitAccountId: z.string().uuid(),
  creditAccountId: z.string().uuid(),
  active: z.boolean(),
}).strict().refine(data => data.debitAccountId !== data.creditAccountId, {
  message: 'As contas devem ser diferentes.',
});

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const rule = await database().prepare(
      'SELECT id,source_type AS "sourceType",debit_account_id AS "debitAccountId",'+
      'credit_account_id AS "creditAccountId",active,row_version AS "rowVersion" '+
      'FROM accounting_posting_rules WHERE actor_id=? AND source_type=?'
    ).bind(context.actorId, sourceType).first();
    return respond({ rule: rule ?? null, policy: 'explicit_opt_in' }, context);
  } catch(error) { return failure(error, context); }
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Configuração contábil inválida.');
    const data = parsed.data;
    const hash = await fingerprint({ actor:context.actorId, scope:'accounting.posting.rule', sourceType, data });
    const result = await database().transaction(async query => {
      await lockFinancePeriodScope(query, context!.actorId);
      const prior = await query(
        'SELECT actor_id,entity_type,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',
        [data.commandKey],
      );
      if (prior.rows.length) {
        const row = prior.rows[0];
        if (row.actor_id !== context!.actorId || row.entity_type !== 'accountingPostingRule' || row.request_hash !== hash)
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave usada em outra operação.');
        return { ...JSON.parse(String(row.result)), replayed:true };
      }
      const old = await query(
        'SELECT id,row_version FROM accounting_posting_rules WHERE actor_id=$1 AND source_type=$2 FOR UPDATE',
        [context!.actorId, sourceType],
      );
      const actual = old.rows.length ? Number(old.rows[0].row_version) : 0;
      if (actual !== data.expectedVersion)
        throw new ApiError(409, 'STALE_VERSION', 'A regra foi modificada em outra sessão.');
      const accounts = await query(
        'SELECT id,type FROM chart_accounts WHERE actor_id=$1 AND active=1 AND id=ANY($2::text[]) FOR SHARE',
        [context!.actorId, [data.debitAccountId,data.creditAccountId]],
      );
      const types = new Map(accounts.rows.map(row => [String(row.id), String(row.type)]));
      if (types.get(data.debitAccountId) !== 'asset' || types.get(data.creditAccountId) !== 'revenue')
        throw new ApiError(409, 'ACCOUNTING_CLASSIFICATION_MISMATCH',
          'A regra exige ativo a receber e receita, com contas próprias e ativas.');
      const now = new Date().toISOString();
      const id = old.rows.length ? String(old.rows[0].id) : crypto.randomUUID();
      if (old.rows.length) {
        await query(
          'UPDATE accounting_posting_rules SET debit_account_id=$2,credit_account_id=$3,'+
          'active=$4,row_version=row_version+1,updated_at=$5 WHERE id=$1',
          [id,data.debitAccountId,data.creditAccountId,data.active?1:0,now],
        );
      } else {
        await query(
          'INSERT INTO accounting_posting_rules(id,actor_id,source_type,debit_account_id,credit_account_id,active,created_at,updated_at) '+
          'VALUES($1,$2,$3,$4,$5,$6,$7,$7)',
          [id,context!.actorId,sourceType,data.debitAccountId,data.creditAccountId,data.active?1:0,now],
        );
      }
      const receipt = { id,sourceType,debitAccountId:data.debitAccountId,creditAccountId:data.creditAccountId,
        active:data.active,rowVersion:actual+1 };
      await query(
        'INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) '+
        "VALUES($1,'accounting_posting_rule',$2,'posting_rule_configured',$3,$4,$5,$6,$7)",
        [crypto.randomUUID(),id,context!.actorId,hash,context!.correlationId,JSON.stringify(receipt),now],
      );
      await query(
        'INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) '+
        "VALUES($1,$2,'accountingPostingRule',$3,'configure',$4,$5,$6,$7)",
        [data.commandKey,context!.actorId,id,hash,JSON.stringify(receipt),context!.correlationId,now],
      );
      return { ...receipt, replayed:false };
    });
    return respond(result,context,result.replayed?200:data.expectedVersion===0?201:200);
  } catch(error) { return failure(error,context); }
}
