/** Monthly statement of posted revenue and expense movements, no bank or cash assumptions.
 * Monetary values are decimal strings scaled by 10_000; never coerce to JS Number.
 */
export function incomeStatementBoundaries(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('INVALID_FINANCE_MONTH');
 const [year,m]=month.split('-').map(Number);
 if(year<1900||year>9998)throw Error('INVALID_FINANCE_MONTH');
 const stamp=(y,mm)=>String(y).padStart(4,'0')+'-'+String(mm).padStart(2,'0');
 const advance=(dy,dm)=>{const n=year*12+(m-1)+dy*12+dm;return stamp(Math.floor(n/12),n%12+1);};
 const prior=advance(0,-1),next=advance(0,1);
 return {periodMonth:month,priorMonth:prior,from:month+'-01',toExclusive:next+'-01',
  priorFrom:prior+'-01'};
}
const scaled=v=>{
 const s=String(v);
 if(!/^-?\d+$/.test(s))throw Error('INVALID_ACCOUNTING_AMOUNT');
 return BigInt(s);
};
export function assembleIncomeStatement(rows,periodMonth,priorMonth){
 const accounts=rows.map(row=>{
  if(!['revenue','expense'].includes(row.type)||typeof row.id!=='string')throw Error('INVALID_INCOME_ACCOUNT');
  return {id:row.id,code:String(row.code),name:String(row.name),type:row.type,
   currentScaled:scaled(row.currentScaled??'0').toString(),
   priorScaled:scaled(row.priorScaled??'0').toString(),
   currentLineCount:Number(row.currentLineCount??0),priorLineCount:Number(row.priorLineCount??0)};
 });
 if(accounts.some(a=>!Number.isSafeInteger(a.currentLineCount)||a.currentLineCount<0||
  !Number.isSafeInteger(a.priorLineCount)||a.priorLineCount<0))throw Error('INVALID_POSTING_COUNT');
 const sum=(kind,period)=>accounts.filter(a=>a.type===kind).reduce((n,a)=>n+BigInt(a[period]),0n);
 const rev=sum('revenue','currentScaled'),cost=sum('expense','currentScaled');
 const prevRev=sum('revenue','priorScaled'),prevCost=sum('expense','priorScaled');
 const currentLineCount=accounts.reduce((n,a)=>n+a.currentLineCount,0);
 const priorLineCount=accounts.reduce((n,a)=>n+a.priorLineCount,0);
 return {
  periodMonth,priorMonth,accounts,
  totals:{revenueScaled:String(rev),expenseScaled:String(cost),netScaled:String(rev-cost),
   priorRevenueScaled:String(prevRev),priorExpenseScaled:String(prevCost),
   priorNetScaled:String(prevRev-prevCost),netChangeScaled:String(rev-cost-prevRev+prevCost),
   currentLineCount,priorLineCount,accountCount:accounts.length},
  emptyState:accounts.length===0?'no_classified_accounts':currentLineCount===0&&priorLineCount===0?'no_postings':null,
  currency:'BRL',moneyScale:4,
  source:'posted_journal_lines_by_account_type_and_effective_month',
  warnings:[
   'DRE gerencial parcial: receitas e despesas do plano de contas, sem mapeamento fiscal, centros de custo ou consolidação societária.',
   'Partidas de estorno publicadas participam pelo sinal contábil normal da conta; lançamentos não publicados ficam excluídos.',
   'Não representa caixa, faturamento bruto documental, lucro fiscal nem demonstração contábil certificada.'
  ]
 };
}
