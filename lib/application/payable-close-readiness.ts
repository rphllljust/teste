// Fail-closed validation of *persisted* AP source links. Historical obligations
// and payments without a journal remain explicit adoption warnings: no
// retroactive GL amounts are fabricated, and no pre-existing record is mutated.
type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number|null}>;

export async function getPayableCloseReadiness(query:Query,actorId:string,start:string,end:string){
 const accrualValid=
  'l.actor_id=p.actor_id AND l.amount=p.amount AND l.effective_date=LEFT(p.created_at,10) '+
  "AND j.actor_id=p.actor_id AND j.status='posted' AND j.reversal_of IS NULL "+
  'AND NOT EXISTS(SELECT 1 FROM journal_entries rev WHERE rev.reversal_of=j.id) '+
  'AND j.effective_date=l.effective_date '+
  'AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=p.amount '+
  'AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=p.amount '+
  'AND j.expected_count=2 AND (SELECT COUNT(*) FROM journal_lines WHERE entry_id=j.id)=2 '+
  'AND EXISTS(SELECT 1 FROM journal_lines jl JOIN chart_accounts a ON a.id=jl.account_id '+
  "WHERE jl.entry_id=j.id AND jl.credit=p.amount AND jl.debit=0 AND a.type='liability' AND a.actor_id=p.actor_id) "+
  'AND EXISTS(SELECT 1 FROM journal_lines jl JOIN chart_accounts a ON a.id=jl.account_id '+
  "WHERE jl.entry_id=j.id AND jl.debit=p.amount AND jl.credit=0 AND a.type IN ('expense','asset') AND a.actor_id=p.actor_id)";
 const accrual=await query(
  'SELECT COUNT(*) FILTER (WHERE l.id IS NULL)::int AS "unpostedPayables", '+
  'COALESCE(SUM(p.amount) FILTER (WHERE l.id IS NULL),0)::text AS "unpostedPayablesAmountScaled", '+
  'COUNT(*) FILTER (WHERE l.id IS NOT NULL AND NOT COALESCE(('+accrualValid+'),FALSE))::int AS "invalidPayableLinks" '+
  'FROM payables p LEFT JOIN accounting_payable_links l ON l.payable_id=p.id '+
  'LEFT JOIN journal_entries j ON j.id=l.journal_id '+
  'WHERE p.actor_id=$1 AND LEFT(p.created_at,10)>=$2 AND LEFT(p.created_at,10)<=$3',
  [actorId,start,end],
 );
 const paymentValid=
  'l.actor_id=p.actor_id AND e.actor_id=p.actor_id AND l.kind=e.kind '+
  'AND l.amount=e.amount AND l.effective_date=e.effective_date '+
  "AND j.actor_id=p.actor_id AND j.status='posted' AND j.effective_date=e.effective_date "+
  'AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=e.amount '+
  'AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=e.amount '+
  'AND j.expected_count=2 AND (SELECT COUNT(*) FROM journal_lines WHERE entry_id=j.id)=2 '+
  // Only the liability account recognized by this payable may be cleared.
  'AND EXISTS(SELECT 1 FROM accounting_payable_links src '+
  'JOIN journal_entries source_j ON source_j.id=src.journal_id AND source_j.actor_id=p.actor_id '+
  'JOIN journal_lines source_line ON source_line.entry_id=src.journal_id '+
  'JOIN chart_accounts liability ON liability.id=source_line.account_id AND liability.actor_id=p.actor_id '+
  'JOIN journal_lines paid_line ON paid_line.entry_id=j.id AND paid_line.account_id=source_line.account_id '+
  "WHERE src.payable_id=p.id AND src.actor_id=p.actor_id AND src.amount=p.amount "+
  "AND source_j.status='posted' AND source_j.reversal_of IS NULL "+
  'AND NOT EXISTS(SELECT 1 FROM journal_entries src_rev WHERE src_rev.reversal_of=source_j.id) '+
  "AND liability.type='liability' AND source_line.credit=p.amount "+
  "AND ((e.kind='payment' AND paid_line.debit=e.amount AND paid_line.credit=0) OR "+
  "(e.kind='reversal' AND paid_line.credit=e.amount AND paid_line.debit=0))) "+
  // The opposite line must be in a bank/cash asset account owned by this tenant.
  'AND EXISTS(SELECT 1 FROM journal_lines bank_line '+
  'JOIN chart_accounts bank_account ON bank_account.id=bank_line.account_id '+
  "WHERE bank_line.entry_id=j.id AND bank_account.actor_id=p.actor_id AND bank_account.type='asset' "+
  "AND ((e.kind='payment' AND bank_line.credit=e.amount AND bank_line.debit=0) OR "+
  "(e.kind='reversal' AND bank_line.debit=e.amount AND bank_line.credit=0))) "+
  "AND ((e.kind='payment' AND j.reversal_of IS NULL) OR "+
  "(e.kind='reversal' AND COALESCE(j.reversal_of=(SELECT prior.journal_id "+
  'FROM accounting_payable_payment_links prior WHERE prior.payment_id=e.reverses_id '+
  'AND prior.actor_id=p.actor_id),FALSE)))';
 const payment=await query(
  'SELECT COUNT(*) FILTER (WHERE l.id IS NULL)::int AS "unpostedPayablePayments", '+
  'COALESCE(SUM(e.amount) FILTER (WHERE l.id IS NULL),0)::text AS "unpostedPayablePaymentsAmountScaled", '+
  'COUNT(*) FILTER (WHERE l.id IS NOT NULL AND NOT COALESCE(('+paymentValid+'),FALSE))::int AS "invalidPayablePaymentLinks" '+
  'FROM payable_payments e JOIN payables p ON p.id=e.payable_id '+
  'LEFT JOIN accounting_payable_payment_links l ON l.payment_id=e.id '+
  'LEFT JOIN journal_entries j ON j.id=l.journal_id '+
  'WHERE p.actor_id=$1 AND e.effective_date>=$2 AND e.effective_date<=$3',
  [actorId,start,end],
 );
 const source=accrual.rows[0],settlement=payment.rows[0];
 return {
  unpostedPayables:Number(source?.unpostedPayables??0),
  unpostedPayablesAmountScaled:String(source?.unpostedPayablesAmountScaled??'0'),
  invalidPayableLinks:Number(source?.invalidPayableLinks??0),
  unpostedPayablePayments:Number(settlement?.unpostedPayablePayments??0),
  unpostedPayablePaymentsAmountScaled:String(settlement?.unpostedPayablePaymentsAmountScaled??'0'),
  invalidPayablePaymentLinks:Number(settlement?.invalidPayablePaymentLinks??0),
 };
}
