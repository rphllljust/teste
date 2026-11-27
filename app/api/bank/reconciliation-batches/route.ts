import {z} from 'zod';
import {database} from '../../../../db/raw';
import {lockFinancePeriodScope,assertFinancePeriodOpen} from '../../../../lib/application/finance';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
export const dynamic='force-dynamic';
const match=z.object({lineId:z.string().uuid(),targetType:z.enum(['receipt','payment']),targetId:z.string().uuid()}).strict();
const command=z.object({key:z.string().uuid(),statementId:z.string().uuid(),mode:z.enum(['preview','commit']),
 items:z.array(match).min(1).max(25)}).strict();
type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number|null}>;
async function validatePair(q:Query,ctx:RequestContext,statementId:string,item:z.infer<typeof match>) {
 const line=await q("SELECT l.id,l.amount,l.booked_date FROM bank_statement_lines l "+
  "WHERE l.id=$1 AND l.statement_id=$2 FOR UPDATE",[item.lineId,statementId]);
 if(!line.rows.length)throw new ApiError(404,'NOT_FOUND','Linha bancária não encontrada neste extrato.');
 const row=line.rows[0],amount=BigInt(String(row.amount));
 const kind=amount>0n?'receipt':'payment';
 if(kind!==item.targetType)throw new ApiError(409,'RECONCILIATION_SIGN_CONFLICT','Tipo do lançamento incompatível com sinal do extrato.');
 await assertFinancePeriodOpen(q,ctx.actorId,String(row.booked_date));
 const lineMatch=await q("SELECT 1 FROM bank_reconciliation_events m WHERE m.line_id=$1 AND m.kind='match' "+
  "AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id) LIMIT 1",[item.lineId]);
 if(lineMatch.rows.length)throw new ApiError(409,'RECONCILIATION_ALREADY_MATCHED','Linha bancária já conciliada.');
 const table=kind==='receipt'?'receivable_settlements':'payable_payments';
 const field=kind==='receipt'?'receipt_id':'payment_id';
 const target=await q("SELECT id,amount,effective_date FROM "+table+" WHERE id=$1 AND actor_id=$2 AND kind=$3 "+
  "AND NOT EXISTS(SELECT 1 FROM "+table+" rev WHERE rev.reverses_id="+table+".id) FOR UPDATE",
  [item.targetId,ctx.actorId,kind]);
 if(!target.rows.length)throw new ApiError(404,'NOT_FOUND','Lançamento financeiro indisponível ou estornado.');
 if((amount<0n?-amount:amount)!==BigInt(String(target.rows[0].amount)))
  throw new ApiError(409,'RECONCILIATION_AMOUNT_CONFLICT','Valor do título difere da linha do extrato.');
 const targetMatch=await q("SELECT 1 FROM bank_reconciliation_events m WHERE m."+field+"=$1 AND m.kind='match' "+
  "AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id) LIMIT 1",[item.targetId]);
 if(targetMatch.rows.length)throw new ApiError(409,'RECONCILIATION_TARGET_MATCHED','Lançamento já vinculado a outra linha bancária.');
 return {lineId:item.lineId,targetId:item.targetId,targetType:kind,amountScaled:(amount<0n?-amount:amount).toString(),
  bookedDate:String(row.booked_date),effectiveDate:String(target.rows[0].effective_date)};
}
export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const p=new URL(request.url).searchParams;
  const statementId=p.get('statementId');
  if(!statementId||!z.string().uuid().safeParse(statementId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Extrato inválido.');
  const owned=await database().prepare('SELECT id FROM bank_statements WHERE id=? AND actor_id=?').bind(statementId,ctx.actorId).first();
  if(!owned)throw new ApiError(404,'NOT_FOUND','Extrato indisponível.');
  const events=await database().prepare("SELECT id,created_at AS \"createdAt\",result FROM business_commands "+
   "WHERE actor_id=? AND entity_type='bankReconciliationBatch' AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT 20")
   .bind(ctx.actorId,statementId).all<{id:string;createdAt:string;result:string}>();
  return respond({items:events.results.map(row=>({id:row.id,createdAt:row.createdAt,
   receipt:JSON.parse(row.result)}))},ctx);
 }catch(e){return failure(e,ctx);}
}
export async function POST(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const parsed=command.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Lote bancário inválido ou superior a 25 vínculos.');
  const data=parsed.data;
  const lineKeys=data.items.map(i=>i.lineId),targetKeys=data.items.map(i=>i.targetType+':'+i.targetId);
  if(new Set(lineKeys).size!==data.items.length||new Set(targetKeys).size!==data.items.length)
   throw new ApiError(409,'BATCH_DUPLICATE','O lote possui linhas ou lançamentos duplicados.');
  const hash=await fingerprint({actor:ctx.actorId,statementId:data.statementId,items:data.items});
  const result=await database().transaction(async q=>{
   await lockFinancePeriodScope(q,ctx!.actorId);
   if(data.mode==='commit'){
    const prior=await q('SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',[data.key]);
    if(prior.rows.length){
     const b=prior.rows[0];
     if(b.actor_id!==ctx!.actorId||b.entity_type!=='bankReconciliationBatch'||b.entity_id!==data.statementId||b.request_hash!==hash)
      throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador de lote reutilizado.');
     return {...JSON.parse(String(b.result)),replayed:true};
    }
   }
   const statement=await q('SELECT id FROM bank_statements WHERE id=$1 AND actor_id=$2 FOR SHARE',[data.statementId,ctx!.actorId]);
   if(!statement.rows.length)throw new ApiError(404,'NOT_FOUND','Extrato indisponível.');
   const sorted=[...data.items].sort((a,b)=>a.lineId.localeCompare(b.lineId));
   const reviewed=[];
   for(const item of sorted)reviewed.push(await validatePair(q,ctx!,data.statementId,item));
   if(data.mode==='preview')return {ready:true,mode:'preview',count:reviewed.length,items:reviewed,replayed:false};
   const now=new Date().toISOString();
   for(const item of reviewed){
    const field=item.targetType==='receipt'?'receipt_id':'payment_id';
    await q('INSERT INTO bank_reconciliation_events(id,line_id,kind,'+field+
     ',created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,\'match\',$3,$4,$5,$6,$7)',
     [crypto.randomUUID(),item.lineId,item.targetId,now,ctx!.actorId,hash,ctx!.correlationId]);
   }
   await q('INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) '+
    "VALUES($1,'bank_reconciliation_batch',$2,'committed',$3,$4,$5,$6,$7)",
    [crypto.randomUUID(),data.key,ctx!.actorId,hash,ctx!.correlationId,
     JSON.stringify({statementId:data.statementId,items:reviewed}),now]);
   const receipt={ok:true,mode:'commit',batchId:data.key,statementId:data.statementId,
    count:reviewed.length,items:reviewed,refreshPolicy:['bank.statements','treasury','finance.workspace']};
   await q('INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [data.key,ctx!.actorId,'bankReconciliationBatch',data.statementId,'commit',hash,JSON.stringify(receipt),ctx!.correlationId,now]);
   return receipt;
  });
  return respond(result,ctx,data.mode==='preview'||result.replayed?200:201);
 }catch(e){return failure(e,ctx);}
}
