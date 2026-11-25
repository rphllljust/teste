import { ApiError, type RequestContext } from '../api/http';

// Accounting for AP uses real, immutable source IDs, not free-text references.
// Callers hold the actor's finance advisory lock and the relevant business row
// lock. All mutations below participate in the caller's PostgreSQL transaction.
type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number|null}>;
export type PayablePosting={status:'not_enabled'|'auto_posted'|'auto_reversed';journalId?:string;ruleVersion?:number};
type Rule={id:string;debitId:string;creditId:string;version:number};

async function activeRule(query:Query,actorId:string,sourceType:'payable_accrual'|'payable_payment'):Promise<Rule|null>{
 const found=await query(
  'SELECT p.id,p.debit_account_id,p.credit_account_id,p.row_version, '+
  'd.type AS debit_type,d.active AS debit_active,d.actor_id AS debit_owner, '+
  'c.type AS credit_type,c.active AS credit_active,c.actor_id AS credit_owner '+
  'FROM accounting_posting_rules p '+
  'LEFT JOIN chart_accounts d ON d.id=p.debit_account_id '+
  'LEFT JOIN chart_accounts c ON c.id=p.credit_account_id '+
  'WHERE p.actor_id=$1 AND p.source_type=$2 AND p.active=1 FOR SHARE OF p',
  [actorId,sourceType],
 );
 const r=found.rows[0];if(!r)return null;
 const valid=sourceType==='payable_accrual'
  ? (r.debit_type==='expense'||r.debit_type==='asset')&&r.credit_type==='liability'
  : r.debit_type==='liability'&&r.credit_type==='asset';
 if(!valid||Number(r.debit_active)!==1||Number(r.credit_active)!==1||
  r.debit_owner!==actorId||r.credit_owner!==actorId||r.debit_account_id===r.credit_account_id)
  throw new ApiError(409,'ACCOUNTING_RULE_INVALID','A regra do passivo exige contas válidas, próprias e ativas.');
 return {id:String(r.id),debitId:String(r.debit_account_id),
  creditId:String(r.credit_account_id),version:Number(r.row_version)};
}

function amountCheck(amount:number){
 if(!Number.isSafeInteger(amount)||amount<=0||amount>2147483647)
  throw new ApiError(409,'ACCOUNTING_AMOUNT_INVALID','Valor incompatível com as partidas contábeis.');
}

async function postJournal(query:Query,context:RequestContext,info:{
 sourceReference:string;description:string;effectiveDate:string;amount:number;
 debitId:string;creditId:string;requestHash:string;
}):Promise<string>{
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await query('INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) '+
  "VALUES($1,$2,$3,$4,'posted',2,$5,$6,$7,$8)",
  [id,info.effectiveDate,info.sourceReference,info.description,now,context.actorId,info.requestHash,context.correlationId]);
 await query('INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) '+
  'VALUES($1,$2,$3,$4,0),($5,$2,$6,0,$4)',
  [crypto.randomUUID(),id,info.debitId,info.amount,crypto.randomUUID(),info.creditId]);
 return id;
}

async function event(query:Query,context:RequestContext,entityId:string,action:string,
 requestHash:string,metadata:Record<string,unknown>){
 await query('INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) '+
  "VALUES($1,'payable',$2,$3,$4,$5,$6,$7,$8)",
  [crypto.randomUUID(),entityId,action,context.actorId,requestHash,context.correlationId,
   JSON.stringify(metadata),new Date().toISOString()]);
}

export async function savedPayableAccrual(query:Query,payableId:string,actorId:string):Promise<PayablePosting>{
 const r=await query('SELECT l.journal_id,l.rule_version FROM accounting_payable_links l '+
  'JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=l.actor_id '+
  'WHERE l.payable_id=$1 AND l.actor_id=$2',[payableId,actorId]);
 if(!r.rows.length)return {status:'not_enabled'};
 return {status:'auto_posted',journalId:String(r.rows[0].journal_id),ruleVersion:Number(r.rows[0].rule_version)};
}

export async function postPayableAccrualIfConfigured(query:Query,context:RequestContext,input:{
 payableId:string;amount:number;effectiveDate:string;requestHash:string;
}):Promise<PayablePosting>{
 const rule=await activeRule(query,context.actorId,'payable_accrual');
 if(!rule)return {status:'not_enabled'};
 amountCheck(input.amount);
 const journalId=await postJournal(query,context,{
  sourceReference:'payable:'+input.payableId,
  description:'Reconhecimento de obrigação com fornecedor',
  effectiveDate:input.effectiveDate,amount:input.amount,debitId:rule.debitId,
  creditId:rule.creditId,requestHash:input.requestHash,
 });
 await query('INSERT INTO accounting_payable_links(id,actor_id,payable_id,journal_id,amount,effective_date,rule_version,request_hash,correlation_id,created_at) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [crypto.randomUUID(),context.actorId,input.payableId,journalId,input.amount,
   input.effectiveDate,rule.version,input.requestHash,context.correlationId,new Date().toISOString()]);
 await event(query,context,input.payableId,'payable_accrual_auto_posted',input.requestHash,
  {journalId,amountScaled:input.amount,ruleId:rule.id,ruleVersion:rule.version});
 return {status:'auto_posted',journalId,ruleVersion:rule.version};
}

export async function savedPayablePaymentPosting(query:Query,paymentId:string,actorId:string):Promise<PayablePosting>{
 const result=await query('SELECT l.kind,l.journal_id,l.rule_version FROM accounting_payable_payment_links l '+
  'JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=l.actor_id '+
  'WHERE l.payment_id=$1 AND l.actor_id=$2',[paymentId,actorId]);
 const row=result.rows[0];if(!row)return {status:'not_enabled'};
 return {status:row.kind==='payment'?'auto_posted':'auto_reversed',
  journalId:String(row.journal_id),ruleVersion:Number(row.rule_version)};
}

export async function postPayablePaymentIfConfigured(query:Query,context:RequestContext,input:{
 payableId:string;paymentId:string;amount:number;effectiveDate:string;requestHash:string;
}):Promise<PayablePosting>{
 const rule=await activeRule(query,context.actorId,'payable_payment');
 if(!rule)return {status:'not_enabled'};
 amountCheck(input.amount);
 // A payment must debit the EXACT liability account credited by the
 // recognized AP source. Merely having a balanced journal is insufficient.
 const source=await query('SELECT l.journal_id FROM accounting_payable_links l '+
  'JOIN payables p ON p.id=l.payable_id AND p.actor_id=l.actor_id '+
  'JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=l.actor_id '+
  'WHERE l.payable_id=$1 AND l.actor_id=$2 AND l.amount=p.amount '+
  "AND j.status='posted' AND j.reversal_of IS NULL "+
  'AND NOT EXISTS(SELECT 1 FROM journal_entries rev WHERE rev.reversal_of=j.id) '+
  'AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id AND account_id=$3)=p.amount',
  [input.payableId,context.actorId,rule.debitId]);
 if(!source.rows.length)throw new ApiError(409,'PAYABLE_ORIGIN_UNRECOGNIZED',
  'O pagamento contábil exige obrigação reconhecida no mesmo passivo e sem estorno.');
 const journalId=await postJournal(query,context,{
  sourceReference:'payable-payment:'+input.paymentId,
  description:'Pagamento: débito em fornecedores e crédito em caixa/banco',
  effectiveDate:input.effectiveDate,amount:input.amount,debitId:rule.debitId,
  creditId:rule.creditId,requestHash:input.requestHash,
 });
 await query('INSERT INTO accounting_payable_payment_links(id,actor_id,payment_id,journal_id,kind,amount,effective_date,rule_version,request_hash,correlation_id,created_at) '+
  "VALUES($1,$2,$3,$4,'payment',$5,$6,$7,$8,$9,$10)",
  [crypto.randomUUID(),context.actorId,input.paymentId,journalId,input.amount,input.effectiveDate,
   rule.version,input.requestHash,context.correlationId,new Date().toISOString()]);
 await event(query,context,input.payableId,'payable_payment_auto_posted',input.requestHash,
  {journalId,paymentId:input.paymentId,amountScaled:input.amount,ruleId:rule.id,ruleVersion:rule.version});
 return {status:'auto_posted',journalId,ruleVersion:rule.version};
}

export async function reversePayablePaymentPostingIfAny(query:Query,context:RequestContext,input:{
 payableId:string;originalPaymentId:string;reversalPaymentId:string;
 amount:number;effectiveDate:string;requestHash:string;
}):Promise<PayablePosting>{
 const result=await query('SELECT l.journal_id,l.amount,l.rule_version,l.effective_date '+
  'FROM accounting_payable_payment_links l JOIN journal_entries j ON j.id=l.journal_id '+
  "WHERE l.payment_id=$1 AND l.actor_id=$2 AND l.kind='payment' AND j.actor_id=$2 FOR SHARE OF l",
  [input.originalPaymentId,context.actorId]);
 const row=result.rows[0];if(!row)return {status:'not_enabled'}; // Legacy fact; no invented ledger.
 amountCheck(input.amount);
 if(Number(row.amount)!==input.amount)
  throw new ApiError(409,'ACCOUNTING_AMOUNT_MISMATCH','O pagamento diverge do diário contábil de origem.');
 const originClosed=await query("SELECT 1 FROM finance_period_closes WHERE actor_id=$1 AND status='closed' AND period_start<=$2 AND period_end>=$2 LIMIT 1",
  [context.actorId,String(row.effective_date)]);
 if(originClosed.rows.length)throw new ApiError(409,'ACCOUNTING_CLOSED_ORIGIN',
  'Pagamento de competência encerrada não admite estorno operacional.');
 const journalId=String(row.journal_id);
 const existing=await query('SELECT 1 FROM journal_entries WHERE reversal_of=$1',[journalId]);
 if(existing.rows.length)throw new ApiError(409,'ACCOUNTING_ORIGIN_ALREADY_REVERSED','O diário já possui estorno.');
 const lines=await query('SELECT account_id,debit,credit FROM journal_lines WHERE entry_id=$1 ORDER BY id',[journalId]);
 if(lines.rows.length!==2||
   lines.rows.reduce((n,l)=>n+Number(l.debit),0)!==input.amount||
   lines.rows.reduce((n,l)=>n+Number(l.credit),0)!==input.amount)
  throw new ApiError(409,'ACCOUNTING_ORIGIN_UNBALANCED','Diário de pagamento inválido.');
 const reversalJournalId=crypto.randomUUID(),now=new Date().toISOString();
 await query('INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id,reversal_of) '+
  "VALUES($1,$2,$3,$4,'posted',2,$5,$6,$7,$8,$9)",
  [reversalJournalId,input.effectiveDate,'payable-payment-reversal:'+input.reversalPaymentId,
   'Estorno contábil de pagamento',now,context.actorId,input.requestHash,context.correlationId,journalId]);
 for(const l of lines.rows)await query('INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,$5)',
  [crypto.randomUUID(),reversalJournalId,l.account_id,l.credit,l.debit]);
 await query('INSERT INTO accounting_payable_payment_links(id,actor_id,payment_id,journal_id,kind,amount,effective_date,rule_version,request_hash,correlation_id,created_at) '+
  "VALUES($1,$2,$3,$4,'reversal',$5,$6,$7,$8,$9,$10)",
  [crypto.randomUUID(),context.actorId,input.reversalPaymentId,reversalJournalId,input.amount,
   input.effectiveDate,Number(row.rule_version),input.requestHash,context.correlationId,now]);
 await event(query,context,input.payableId,'payable_payment_gl_reversed',input.requestHash,
  {originalPaymentId:input.originalPaymentId,reversalPaymentId:input.reversalPaymentId,
   originalJournalId:journalId,journalId:reversalJournalId});
 return {status:'auto_reversed',journalId:reversalJournalId,ruleVersion:Number(row.rule_version)};
}
