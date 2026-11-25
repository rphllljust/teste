import { z } from 'zod';
import { database } from '../../../../db/raw';
import { assertFinancePeriodOpen } from '../../../../lib/application/finance';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic='force-dynamic';
const command=z.object({
 id:z.string().uuid(),commandKey:z.string().uuid(),invoiceId:z.string().uuid(),journalId:z.string().uuid(),
}).strict();

/**
 * Manual journal-to-invoice source verification only. No invoice or journal
 * is created. Journal balance, amount, ownership, period and reversal must be
 * independently verified under a single PostgreSQL transaction.
 */
export async function POST(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const parsed=command.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Vínculo contábil inválido.');
  const data=parsed.data;
  const hash=await fingerprint({actor:ctx.actorId,scope:'accounting.invoice.link',data});
  const result=await database().transaction(async query=>{
   const prior=await query(
    'SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',[data.commandKey],
   );
   if(prior.rows.length){
    const row=prior.rows[0];
    if(row.actor_id!==ctx!.actorId||row.entity_type!=='accountingInvoiceLink'||
       row.entity_id!==data.invoiceId||row.request_hash!==hash)
      throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de comando já utilizada.');
    return {...JSON.parse(String(row.result)),replayed:true};
   }
   const invoice=await query(
    'SELECT i.id,i.amount,o.owner_id FROM invoices i '+
    'JOIN service_orders o ON o.id=i.order_id WHERE i.id=$1 AND o.owner_id=$2 FOR UPDATE OF i',
    [data.invoiceId,ctx!.actorId],
   );
   if(!invoice.rows.length)throw new ApiError(404,'NOT_FOUND','Fatura não encontrada no contexto autorizado.');
   const journal=await query(
    'SELECT id,status,effective_date,reversal_of FROM journal_entries WHERE id=$1 AND actor_id=$2 FOR UPDATE',
    [data.journalId,ctx!.actorId],
   );
   if(!journal.rows.length)throw new ApiError(404,'NOT_FOUND','Diário contábil não encontrado no contexto autorizado.');
   const entry=journal.rows[0];
   if(entry.status!=='posted'||entry.reversal_of)
    throw new ApiError(409,'INVALID_JOURNAL_STATE','Somente lançamentos originais e publicados podem ser vinculados.');
   await assertFinancePeriodOpen(query,ctx!.actorId,String(entry.effective_date));
   const reversal=await query('SELECT id FROM journal_entries WHERE reversal_of=$1 LIMIT 1',[data.journalId]);
   if(reversal.rows.length)throw new ApiError(409,'ALREADY_REVERSED','O lançamento já foi estornado.');
   const totals=await query(
    'SELECT COALESCE(SUM(debit),0)::text AS debit,COALESCE(SUM(credit),0)::text AS credit '+
    'FROM journal_lines WHERE entry_id=$1',[data.journalId],
   );
   const amount=BigInt(String(invoice.rows[0].amount));
   if(amount<=0n||BigInt(String(totals.rows[0].debit))!==amount||
      BigInt(String(totals.rows[0].credit))!==amount)
    throw new ApiError(409,'ACCOUNTING_AMOUNT_MISMATCH','As partidas contábeis devem equilibrar exatamente o valor da fatura.');
   const now=new Date().toISOString();
   const inserted=await query(
    'INSERT INTO accounting_invoice_links(id,actor_id,invoice_id,journal_id,amount,request_hash,correlation_id,created_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id',
    [data.id,ctx!.actorId,data.invoiceId,data.journalId,String(amount),hash,ctx!.correlationId,now],
   );
   if(!inserted.rows.length)throw new ApiError(409,'ACCOUNTING_LINK_EXISTS','Fatura ou lançamento já possui vínculo contábil.');
   await query(
    "INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) "+
    "VALUES($1,'invoice',$2,'accounting_origin_linked',$3,$4,$5,$6,$7)",
    [crypto.randomUUID(),data.invoiceId,ctx!.actorId,hash,ctx!.correlationId,
     JSON.stringify({linkId:data.id,journalId:data.journalId,amountScaled:String(amount),mode:'manual_verified'}),now],
   );
   const receipt={id:data.id,invoiceId:data.invoiceId,journalId:data.journalId,
    amountScaled:String(amount),status:'manually_verified',accountingPostedAutomatically:false};
   await query(
    "INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) "+
    "VALUES($1,$2,'accountingInvoiceLink',$3,'link',$4,$5,$6,$7)",
    [data.commandKey,ctx!.actorId,data.invoiceId,hash,JSON.stringify(receipt),ctx!.correlationId,now],
   );
   return {...receipt,replayed:false};
  });
  return respond(result,ctx,result.replayed?200:201);
 }catch(error){return failure(error,ctx);}
}
