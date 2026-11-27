import {z} from 'zod';
import {database} from '../../../../db/raw';
import {outstandingExpression} from '../../../../lib/projections/operation';
import {payableBalance} from '../../../../lib/projections/payables';
import {buildDailyFinancialFlow} from '../../../../lib/domain/finance-cashflow.mjs';
import {ApiError,failure,requestContext,respond,validDate,type RequestContext} from '../../../../lib/api/http';

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate);
export const dynamic='force-dynamic';
export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const query=new URL(request.url).searchParams;
  const asOf=query.get('asOf')??new Date().toISOString().slice(0,10);
  if(!date.safeParse(asOf).success)throw new ApiError(400,'VALIDATION_FAILED','Referência inválida.');
  const from=query.get('from')??asOf;
  const to=query.get('to')??new Date(Date.parse(asOf+'T00:00:00Z')+30*86400000).toISOString().slice(0,10);
  if(!date.safeParse(from).success||!date.safeParse(to).success||from>to||
     (Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))>366*86400000)
   throw new ApiError(400,'VALIDATION_FAILED','Janela de fluxo de caixa inválida (máximo 366 dias).');
  const db=database();
  const results=await db.batch([
   db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').bind(),
   db.prepare(
    'SELECT r.due_date AS date,COALESCE(SUM('+outstandingExpression+'),0)::text AS amount '+
    'FROM receivables r JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id '+
    'WHERE o.owner_id=? AND r.due_date BETWEEN ? AND ? AND '+outstandingExpression+'>0 GROUP BY r.due_date'
   ).bind(context.actorId,from,to),
   db.prepare(
    'SELECT p.due_date AS date,COALESCE(SUM('+payableBalance+'),0)::text AS amount '+
    'FROM payables p WHERE p.actor_id=? AND p.due_date BETWEEN ? AND ? AND '+payableBalance+'>0 GROUP BY p.due_date'
   ).bind(context.actorId,from,to),
   db.prepare(
    'SELECT s.effective_date AS date,COALESCE(SUM(CASE WHEN s.kind=\'receipt\' THEN s.amount ELSE -s.amount END),0)::text AS amount '+
    'FROM receivable_settlements s JOIN receivables r ON r.id=s.receivable_id '+
    'JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id '+
    'WHERE o.owner_id=? AND s.effective_date BETWEEN ? AND ? GROUP BY s.effective_date'
   ).bind(context.actorId,from,to),
   db.prepare(
    'SELECT effective_date AS date,COALESCE(SUM(CASE WHEN kind=\'payment\' THEN amount ELSE -amount END),0)::text AS amount '+
    'FROM payable_payments WHERE actor_id=? AND effective_date BETWEEN ? AND ? GROUP BY effective_date'
   ).bind(context.actorId,from,to),
   db.prepare(
    'SELECT account_reference AS "accountReference",period_end AS "periodEnd",closing_balance::text AS amount '+
    'FROM bank_statements WHERE actor_id=? ORDER BY period_end DESC,id DESC LIMIT 1'
   ).bind(context.actorId),
  ]);
  const flows=buildDailyFinancialFlow({
   receivables:results[1].results,payables:results[2].results,
   receipts:results[3].results,payments:results[4].results,
  });
  const latestBank=results[5].results[0] as {accountReference:string;periodEnd:string;amount:string}|undefined;
  return respond({
   asOf,from,to,...flows,
   openingBankBalanceScaled:latestBank?.amount??null,
   latestBankStatement:latestBank?{accountReference:latestBank.accountReference,periodEnd:latestBank.periodEnd}:null,
   authorities:{
    projected:'open_titles.due_date.v2',realized:'signed_settlement_ledgers.effective_date.v2',
    bank:'latest_single_imported_statement.v2',
   },
   warnings:[
    'Valores e saldos em escala monetária de quatro casas; estornos reduzem o realizado na data do evento.',
    'Projeções de títulos representam posição atual por vencimento e não reconstrução histórica.',
    'Saldo informado corresponde a um único extrato importado, nunca a caixa consolidado ou saldo disponível.',
   ],
  },context);
 }catch(error){return failure(error,context);}
}
