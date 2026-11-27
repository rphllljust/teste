import {z} from 'zod';
import {database} from '../../../../../../db/raw';
import {outstandingExpression} from '../../../../../../lib/projections/operation';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,validDate,type RequestContext} from '../../../../../../lib/api/http';
import {lockFinancePeriodScope} from '../../../../../../lib/application/finance';
const command=z.object({
 key:z.string().uuid(),expectedVersion:z.number().int().positive(),
 action:z.enum(['log_contact','record_promise','resolve','reopen','cancel']),
 note:z.string().trim().min(5).max(1200),
 promiseDate:z.string().refine(validDate).optional(),
}).strict();
const events={log_contact:'contact_logged',record_promise:'promise_recorded',
 resolve:'settled',reopen:'reopened',cancel:'cancelled'} as const;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const id=(await params).id;
  if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Acompanhamento inválido.');
  const parsed=command.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando de cobrança inválido.');
  const input=parsed.data;
  if(input.action==='record_promise'&&(!input.promiseDate||input.promiseDate<new Date().toISOString().slice(0,10)))
   throw new ApiError(400,'VALIDATION_FAILED','Informe uma data futura ou atual para a promessa.');
  const hash=await fingerprint({actor:context.actorId,id,input});
  const response=await database().transaction(async query=>{
   await lockFinancePeriodScope(query,context!.actorId);
   const rows=await query('SELECT c.*,('+outstandingExpression+')::bigint AS outstanding '+
    'FROM finance_collection_cases c JOIN receivables r ON r.id=c.receivable_id '+
    'JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id '+
    'WHERE c.id=$1 AND c.actor_id=$2 AND o.owner_id=c.actor_id FOR UPDATE OF c,r',[id,context!.actorId]);
   if(!rows.rowCount)throw new ApiError(404,'NOT_FOUND','Acompanhamento indisponível.');
   const row=rows.rows[0];
   const earlier=await query('SELECT id,request_hash,action FROM finance_collection_events WHERE id=$1',[input.key]);
   if(earlier.rowCount){
    if(earlier.rows[0].request_hash!==hash||earlier.rows[0].action!==events[input.action])
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de evento já utilizada.');
    return {id,status:row.status,replayed:true,rowVersion:row.row_version};
   }
   if(Number(row.row_version)!==input.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','O acompanhamento foi alterado. Atualize a tela.');
   const closed=row.status==='settled'||row.status==='cancelled';
   const positive=BigInt(String(row.outstanding))>0n;
   if(['log_contact','record_promise','resolve','cancel'].includes(input.action)&&closed)
    throw new ApiError(409,'CASE_CLOSED','Acompanhamento concluído.');
   if(input.action==='resolve'&&positive)
    throw new ApiError(409,'RECEIVABLE_NOT_SETTLED','Não é possível encerrar por quitação enquanto houver saldo pendente.');
   if(input.action==='reopen'&&(!closed||!positive))
    throw new ApiError(409,'REOPEN_UNAVAILABLE','A reabertura exige caso encerrado com saldo pendente.');
   const next=input.action==='record_promise'?'promised':
    input.action==='resolve'?'settled':input.action==='cancel'?'cancelled':
    input.action==='reopen'?'open':row.status;
   const nextPromise=input.action==='record_promise'?input.promiseDate:
    ['resolve','cancel','reopen'].includes(input.action)?null:row.promise_date;
   const now=new Date().toISOString();
   await query('UPDATE finance_collection_cases SET status=$2,promise_date=$3,row_version=row_version+1,updated_at=$4 WHERE id=$1',
    [id,next,nextPromise,now]);
   await query('INSERT INTO finance_collection_events '+
    '(id,case_id,actor_id,action,note,promise_date,request_hash,correlation_id,created_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [input.key,id,context!.actorId,events[input.action],input.note,
     input.action==='record_promise'?input.promiseDate:null,hash,context!.correlationId,now]);
   return {id,status:next,replayed:false,rowVersion:Number(row.row_version)+1};
  });
  return respond(response,context,response.replayed?200:201);
 }catch(error){return failure(error,context);}
}
