import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {getPeriodCloseReadiness} from '../../../../../lib/application/finance';
import {ApiError,failure,requestContext,respond,validDate,type RequestContext} from '../../../../../lib/api/http';

export const dynamic='force-dynamic';
export async function GET(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const url=new URL(request.url);
    const dates=z.object({
      periodStart:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      periodEnd:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).safeParse({
      periodStart:url.searchParams.get('periodStart'),
      periodEnd:url.searchParams.get('periodEnd'),
    });
    if(!dates.success||!validDate(dates.data.periodStart)||!validDate(dates.data.periodEnd)||
       dates.data.periodStart>dates.data.periodEnd)
      throw new ApiError(400,'VALIDATION_FAILED','Competência de pré-fechamento inválida.');
    const result=await database().transaction(q=>getPeriodCloseReadiness(q,context!.actorId,
      dates.data.periodStart,dates.data.periodEnd));
    const accountingBlockers=[
      ['invoicesWithoutVerifiedPosting',result.blockingInvoices],
      ['invalidCashLinks',result.invalidCashLinks],
      ['invalidPayableLinks',result.invalidPayableLinks],
      ['invalidPayablePaymentLinks',result.invalidPayablePaymentLinks],
      ['unpostedCashEvents',result.unpostedCashEvents],
      ['unpostedPayables',result.unpostedPayables],
      ['unpostedPayablePayments',result.unpostedPayablePayments],
    ] as const;
    const tier1Blockers=accountingBlockers.filter(([,count])=>count>0)
      .map(([code,count])=>({code,count}));
    return respond({
      periodStart:dates.data.periodStart,periodEnd:dates.data.periodEnd,
      ...result,canClose:result.blockingInvoices===0&&result.invalidCashLinks===0&&result.invalidPayableLinks===0&&result.invalidPayablePaymentLinks===0,
      tier1Readiness:{
        ready:tier1Blockers.length===0,
        status:tier1Blockers.length===0?'ready':'blocked',
        blockers:tier1Blockers,
        policy:'Verificação estrita de faturas, obrigações e eventos de caixa antes de atestar fechamento contábil.',
      },
      advisoryOnly:true,
      policy:'A decisão revalida faturas, baixas, obrigações e pagamentos com diário de origem sob lock. Fatos legados sem diário continuam avisos, nunca são contabilizados retroativamente.',
    },context);
  }catch(error){return failure(error,context);}
}
