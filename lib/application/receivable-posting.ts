import { ApiError, type RequestContext } from '../api/http';

type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number|null}>;
export type ReceiptPostingInfo={status:'not_enabled'|'auto_posted'|'auto_reversed';journalId?:string;ruleVersion?:number};
type Rule={id:string;debitId:string;creditId:string;version:number};

export async function savedReceiptPosting(query:Query,settlementId:string,actorId:string):Promise<ReceiptPostingInfo>{
 const found=await query(
  'SELECT l.journal_id,l.rule_version,l.kind FROM accounting_settlement_links l '+
  'JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=l.actor_id '+
  'WHERE l.settlement_id=$1 AND l.actor_id=$2',
  [settlementId,actorId],
 );
 const row=found.rows[0];
 if(!row)return {status:'not_enabled'};
 return {status:row.kind==='receipt'?'auto_posted':'auto_reversed',
   journalId:String(row.journal_id),ruleVersion:Number(row.rule_version)};
}

async function activeReceiptRule(query:Query,actorId:string):Promise<Rule|null>{
 const result=await query(
  'SELECT p.id,p.debit_account_id,p.credit_account_id,p.row_version, '+
  'd.type AS debit_type,d.active AS debit_active,d.actor_id AS debit_owner, '+
  'c.type AS credit_type,c.active AS credit_active,c.actor_id AS credit_owner '+
  'FROM accounting_posting_rules p '+
  'LEFT JOIN chart_accounts d ON d.id=p.debit_account_id '+
  'LEFT JOIN chart_accounts c ON c.id=p.credit_account_id '+
  "WHERE p.actor_id=$1 AND p.source_type='receivable_receipt' AND p.active=1 FOR SHARE OF p",
  [actorId],
 );
 const row=result.rows[0];
 if(!row)return null;
 if(row.debit_type!=='asset'||row.credit_type!=='asset'||
    Number(row.debit_active)!==1||Number(row.credit_active)!==1||
    row.debit_owner!==actorId||row.credit_owner!==actorId||
    row.debit_account_id===row.credit_account_id)
  throw new ApiError(409,'ACCOUNTING_RULE_INVALID',
   'A baixa exige contas próprias e ativas de caixa/banco e clientes a receber.');
 return {id:String(row.id),debitId:String(row.debit_account_id),
   creditId:String(row.credit_account_id),version:Number(row.row_version)};
}

export async function postReceiptIfConfigured(query:Query,context:RequestContext,input:{
 settlementId:string;receivableId:string;amount:number;effectiveDate:string;requestHash:string;
}):Promise<ReceiptPostingInfo>{
 const rule=await activeReceiptRule(query,context.actorId);
 if(!rule)return {status:'not_enabled'};
 if(!Number.isSafeInteger(input.amount)||input.amount<=0||input.amount>2147483647)
  throw new ApiError(409,'ACCOUNTING_AMOUNT_INVALID','Valor incompatível com partidas contábeis inteiras.');
 // The credited A/R account MUST be the account previously debited when
 // recognizing the source invoice. A balanced but unrelated journal is not enough.
 const source=await query(
  'SELECT l.journal_id FROM receivables r '+
  'JOIN invoices i ON i.id=r.invoice_id '+
  'JOIN service_orders o ON o.id=i.order_id '+
  'JOIN accounting_invoice_links l ON l.invoice_id=i.id AND l.actor_id=o.owner_id AND l.amount=i.amount '+
  'JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=o.owner_id '+
  'WHERE r.id=$1 AND o.owner_id=$2 '+
  "AND j.status='posted' AND j.reversal_of IS NULL "+
  'AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reversal_of=j.id) '+
  'AND EXISTS (SELECT 1 FROM journal_lines debit WHERE debit.entry_id=j.id '+
  'AND debit.account_id=$3 AND debit.debit>0)',
  [input.receivableId,context.actorId,rule.creditId],
 );
 if(!source.rows.length)
  throw new ApiError(409,'CASH_RECEIPT_ORIGIN_UNRECOGNIZED',
   'Contabilização da baixa exige faturamento reconhecido em contas a receber, com origem válida e não estornada.');
 const journalId=crypto.randomUUID(),now=new Date().toISOString();
 await query(
  'INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) '+
  "VALUES($1,$2,$3,$4,'posted',2,$5,$6,$7,$8)",
  [journalId,input.effectiveDate,'settlement:'+input.settlementId,
   'Recebimento: débito de caixa/banco e crédito de clientes a receber',
   now,context.actorId,input.requestHash,context.correlationId],
 );
 await query(
  'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) '+
  'VALUES($1,$2,$3,$4,0),($5,$2,$6,0,$4)',
  [crypto.randomUUID(),journalId,rule.debitId,input.amount,crypto.randomUUID(),rule.creditId],
 );
 await query(
  'INSERT INTO accounting_settlement_links(id,actor_id,settlement_id,journal_id,kind,amount,effective_date,rule_version,request_hash,correlation_id,created_at) '+
  "VALUES($1,$2,$3,$4,'receipt',$5,$6,$7,$8,$9,$10)",
  [crypto.randomUUID(),context.actorId,input.settlementId,journalId,input.amount,
   input.effectiveDate,rule.version,input.requestHash,context.correlationId,now],
 );
 await query(
  'INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) '+
  "VALUES($1,'receivable',$2,'receipt_auto_posted',$3,$4,$5,$6,$7)",
  [crypto.randomUUID(),input.receivableId,context.actorId,input.requestHash,
   context.correlationId,JSON.stringify({journalId,settlementId:input.settlementId,
    amountScaled:input.amount,ruleId:rule.id,ruleVersion:rule.version}),now],
 );
 return {status:'auto_posted',journalId,ruleVersion:rule.version};
}

export async function reverseReceiptPostingIfAny(query:Query,context:RequestContext,input:{
 originalSettlementId:string;reversalSettlementId:string;receivableId:string;
 amount:number;effectiveDate:string;requestHash:string;
}):Promise<ReceiptPostingInfo>{
 const result=await query(
  'SELECT l.journal_id,l.rule_version,l.amount,l.effective_date '+
  'FROM accounting_settlement_links l JOIN journal_entries j ON j.id=l.journal_id '+
  "WHERE l.settlement_id=$1 AND l.actor_id=$2 AND l.kind='receipt' AND j.actor_id=$2 FOR SHARE OF l",
  [input.originalSettlementId,context.actorId],
 );
 if(!result.rows.length)return {status:'not_enabled'}; // Legacy settlement: no fabricated GL.
 const row=result.rows[0];
 if(Number(row.amount)!==input.amount)
  throw new ApiError(409,'ACCOUNTING_AMOUNT_MISMATCH','Valor de recebimento divergente do diário de origem.');
 const alreadyClosed=await query(
  "SELECT id FROM finance_period_closes WHERE actor_id=$1 AND status='closed' AND period_start<=$2 AND period_end>=$2 LIMIT 1",
  [context.actorId,String(row.effective_date)],
 );
 if(alreadyClosed.rows.length)
  throw new ApiError(409,'ACCOUNTING_CLOSED_ORIGIN',
   'Não é permitido invalidar recebimento pertencente a competência já encerrada.');
 const oldId=String(row.journal_id);
 const existing=await query('SELECT id FROM journal_entries WHERE reversal_of=$1 LIMIT 1',[oldId]);
 if(existing.rows.length)
  throw new ApiError(409,'ACCOUNTING_ORIGIN_ALREADY_REVERSED','O diário original já foi estornado.');
 const oldLines=await query(
  'SELECT account_id,debit,credit FROM journal_lines WHERE entry_id=$1 ORDER BY id',
  [oldId],
 );
 if(oldLines.rows.length!==2||
    oldLines.rows.reduce((sum,l)=>sum+Number(l.debit),0)!==input.amount||
    oldLines.rows.reduce((sum,l)=>sum+Number(l.credit),0)!==input.amount)
  throw new ApiError(409,'ACCOUNTING_ORIGIN_UNBALANCED','Partidas da baixa de origem inválidas.');
 const journalId=crypto.randomUUID(),now=new Date().toISOString();
 await query(
  'INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id,reversal_of) '+
  "VALUES($1,$2,$3,$4,'posted',2,$5,$6,$7,$8,$9)",
  [journalId,input.effectiveDate,'settlement-reversal:'+input.reversalSettlementId,
   'Estorno automático do recebimento',now,context.actorId,input.requestHash,context.correlationId,oldId],
 );
 for(const line of oldLines.rows){
  await query(
   'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,$5)',
   [crypto.randomUUID(),journalId,line.account_id,line.credit,line.debit],
  );
 }
 await query(
  'INSERT INTO accounting_settlement_links(id,actor_id,settlement_id,journal_id,kind,amount,effective_date,rule_version,request_hash,correlation_id,created_at) '+
  "VALUES($1,$2,$3,$4,'reversal',$5,$6,$7,$8,$9,$10)",
  [crypto.randomUUID(),context.actorId,input.reversalSettlementId,journalId,input.amount,
   input.effectiveDate,Number(row.rule_version),input.requestHash,context.correlationId,now],
 );
 await query(
  'INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) '+
  "VALUES($1,'receivable',$2,'receipt_gl_reversed',$3,$4,$5,$6,$7)",
  [crypto.randomUUID(),input.receivableId,context.actorId,input.requestHash,
   context.correlationId,JSON.stringify({journalId,originalJournalId:oldId,
    originalSettlementId:input.originalSettlementId,reversalSettlementId:input.reversalSettlementId}),now],
 );
 return {status:'auto_reversed',journalId,ruleVersion:Number(row.rule_version)};
}
