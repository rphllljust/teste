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
    return respond({
      periodStart:dates.data.periodStart,periodEnd:dates.data.periodEnd,
      ...result,canClose:result.blockingInvoices===0,
      advisoryOnly:true,
      policy:'A decisão final revalida os bloqueios dentro do lock transacional antes de fechar.',
    },context);
  }catch(error){return failure(error,context);}
}
