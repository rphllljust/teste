import { z } from 'zod';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { database } from '../../../../db/raw';

export const dynamic='force-dynamic';

const pageSize = 25;

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const rawPage = new URL(request.url).searchParams.get('page') ?? '1';
    const page = Number(rawPage);
    if (!/^\d+$/.test(rawPage) || page < 1 || !Number.isSafeInteger(page * pageSize)) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Página de lançamentos inválida.');
    }

    const db = database();
    const [rows, count] = await Promise.all([
      db.prepare(`SELECT j.id, j.effective_date AS "effectiveDate",
        j.source_reference AS "sourceReference", j.description, j.status,
        CAST(COALESCE((SELECT SUM(l.debit) FROM journal_lines l WHERE l.entry_id = j.id), 0) AS TEXT) AS "debitScaled",
        CAST(COALESCE((SELECT SUM(l.credit) FROM journal_lines l WHERE l.entry_id = j.id), 0) AS TEXT) AS "creditScaled",
        j.reversal_of AS "reversalOf"
        FROM journal_entries j WHERE j.actor_id = ?
        ORDER BY j.effective_date DESC, j.id DESC LIMIT ? OFFSET ?`)
        .bind(context.actorId, pageSize, (page - 1) * pageSize).all(),
      db.prepare('SELECT COUNT(*)::int AS total FROM journal_entries WHERE actor_id = ?')
        .bind(context.actorId).first<{ total: number }>(),
    ]);
    const total = count?.total ?? 0;
    return respond({ items: rows.results, pageInfo: { page, total, hasMore: page * pageSize < total } }, context);
  } catch (error) {
    return failure(error, context);
  }
}

const amount=z.string().regex(/^\d+$/).refine(value=>BigInt(value)>0,'O valor deve ser positivo.');
const command=z.object({id:z.string().uuid(),effectiveDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),sourceReference:z.string().trim().min(1).max(160),description:z.string().trim().min(1).max(500),lines:z.array(z.object({id:z.string().uuid(),accountId:z.string().uuid(),debit:amount,credit:amount}).strict()).min(2)}).strict();

export async function POST(request:Request){let context:RequestContext|undefined;try{context=requestContext(request,true);const parsed=command.safeParse(await jsonBody(request));if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Lançamento contábil inválido.');const data=parsed.data;const debit=data.lines.reduce((sum,line)=>sum+BigInt(line.debit),0n),credit=data.lines.reduce((sum,line)=>sum+BigInt(line.credit),0n);if(debit!==credit)throw new ApiError(409,'JOURNAL_UNBALANCED','O lançamento deve possuir débitos e créditos equilibrados.');const hash=await fingerprint({actor:context.actorId,scope:'accounting.journal.post',data});const result=await database().transaction(async q=>{const prior=await q('SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',[data.id]);if(prior.rows.length){const row=prior.rows[0] as {actor_id:string;entity_type:string;entity_id:string;request_hash:string;result:string};if(row.actor_id!==context!.actorId||row.entity_type!=='accountingJournal'||row.entity_id!==data.id||row.request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de comando já utilizada.');return {...JSON.parse(row.result),replayed:true};}const accounts=await q('SELECT id FROM chart_accounts WHERE actor_id=$1 AND active=1 AND id=ANY($2::text[]) FOR SHARE',[context!.actorId,data.lines.map(line=>line.accountId)]);if(accounts.rowCount!==new Set(data.lines.map(line=>line.accountId)).size)throw new ApiError(409,'ACCOUNTING_OWNER_INVARIANT','Uma ou mais contas não pertencem ao contexto ativo.');await q('INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,\'posted\',$5,$6,$7,$8,$9)',[data.id,data.effectiveDate,data.sourceReference,data.description,data.lines.length,new Date().toISOString(),context!.actorId,hash,context!.correlationId]);for(const line of data.lines)await q('INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,$5)',[line.id,data.id,line.accountId,line.debit,line.credit]);const receipt={ok:true,resource:{type:'accounting-journal',id:data.id,status:'posted'},refreshPolicy:['accounting.journals','accounting.ledger']};await q('INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[data.id,context!.actorId,'accountingJournal',data.id,'post',hash,JSON.stringify(receipt),context!.correlationId,new Date().toISOString()]);return receipt;});return respond(result,context,result.replayed?200:201);}catch(error){return failure(error,context);}}
