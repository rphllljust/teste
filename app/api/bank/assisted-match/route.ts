import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const matchInput=z.object({lineId:uuid,targetType:z.enum(['receipt','payment']),targetId:uuid}).strict();
const batchInput=z.object({id:uuid,statementId:uuid,matches:z.array(matchInput).min(1).max(50)}).strict();
type Line={id:string;bookedDate:string;description:string;amount:string};
type Candidate={id:string;kind:'receipt'|'payment';amount:string;effectiveDate:string;reference:string};
const abs=(n:string)=>BigInt(n)<0n?-BigInt(n):BigInt(n);
const days=(a:string,b:string)=>Math.abs(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
const matchActive=(alias:string,targetColumn:string)=>'NOT EXISTS (SELECT 1 FROM bank_reconciliation_events e WHERE e.'+targetColumn+'='+alias+'.id '+
 "AND e.kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=e.id))";
export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const id=new URL(request.url).searchParams.get('statementId');
  if(!id||!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Selecione um extrato.');
  const db=database();
  const results=await db.batch([
   db.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').bind(),
   db.prepare('SELECT id FROM bank_statements WHERE id=? AND actor_id=?').bind(id,context.actorId),
   db.prepare('SELECT l.id,l.booked_date AS "bookedDate",l.description,l.amount::text AS amount FROM bank_statement_lines l '+
    'WHERE l.statement_id=? AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events m '+
    "WHERE m.line_id=l.id AND m.kind='match' AND NOT EXISTS "+
    '(SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=m.id)) '+
    'ORDER BY l.booked_date DESC,l.id DESC LIMIT 101').bind(id),
   db.prepare('SELECT s.id,s.amount::text AS amount,s.effective_date AS "effectiveDate",s.reference '+
    "FROM receivable_settlements s WHERE s.actor_id=? AND s.kind='receipt' AND "+matchActive('s','receipt_id')+
    ' AND NOT EXISTS (SELECT 1 FROM receivable_settlements reversal WHERE reversal.reverses_id=s.id) '+
    'ORDER BY s.effective_date DESC,s.id DESC LIMIT 1001').bind(context.actorId),
   db.prepare('SELECT s.id,s.amount::text AS amount,s.effective_date AS "effectiveDate",s.reference '+
    "FROM payable_payments s WHERE s.actor_id=? AND s.kind='payment' AND "+matchActive('s','payment_id')+
    ' AND NOT EXISTS (SELECT 1 FROM payable_payments reversal WHERE reversal.reverses_id=s.id) '+
    'ORDER BY s.effective_date DESC,s.id DESC LIMIT 1001').bind(context.actorId),
  ]);
  if(!results[1].results.length)throw new ApiError(404,'NOT_FOUND','Extrato indisponível.');
  const raw=results[2].results as unknown as Line[];
  const receipts=(results[3].results as unknown as Candidate[]).map(x=>({...x,kind:'receipt' as const}));
  const payments=(results[4].results as unknown as Candidate[]).map(x=>({...x,kind:'payment' as const}));
  const truncated=raw.length>100||receipts.length>1000||payments.length>1000;
  const lines=raw.slice(0,100);
  const possibilities=lines.map(line=>{
   const kind=BigInt(line.amount)>0n?'receipt':'payment';
   const candidates=(kind==='receipt'?receipts:payments).filter(target=>
    abs(target.amount)===abs(line.amount)&&Number.isFinite(days(line.bookedDate,target.effectiveDate))&&days(line.bookedDate,target.effectiveDate)<=3);
   return {line,candidates,kind};
  });
  const counts=new Map<string,number>();
  for(const item of possibilities)for(const c of item.candidates)
   counts.set(c.id,(counts.get(c.id)??0)+1);
  const unique=truncated?[]:possibilities.filter(item=>
   item.candidates.length===1&&counts.get(item.candidates[0].id)===1).map(item=>{
    const c=item.candidates[0];
    return {lineId:item.line.id,bookedDate:item.line.bookedDate,
     description:item.line.description,targetType:item.kind,targetId:c.id,
     amountScaled:abs(item.line.amount).toString(),effectiveDate:c.effectiveDate,reference:c.reference,
     criteria:'exact_amount_sign_and_date_within_3_days',requiresConfirmation:true};
   });
  return respond({statementId:id,suggestions:unique,considered:lines.length,
   ambiguous:possibilities.filter(p=>p.candidates.length>1).length,
   truncated,
   warnings:[
    'Sugestões são apenas propostas de correspondência entre fatos persistidos; não registram pagamento ou recebimento.',
    'Correspondências com múltiplos candidatos ou resultados truncados não são propostas automaticamente.',
    'O operador deve revisar cada par; a execução confirma novamente valor, sinal, titularidade e status no banco.',
   ]},context);
 }catch(error){return failure(error,context);}
}
export async function POST(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const parsed=batchInput.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Selecione até 50 correspondências válidas.');
  const input=parsed.data;
  if(new Set(input.matches.map(x=>x.lineId)).size!==input.matches.length||
     new Set(input.matches.map(x=>x.targetId)).size!==input.matches.length)
   throw new ApiError(400,'VALIDATION_FAILED','Linha ou lançamento repetido no lote.');
  const hash=await fingerprint({actor:context.actorId,input});
  const result=await database().transaction(async query=>{
   // Single owner-scoped lock: no other assisted batch can assign the same source in parallel.
   await query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',['cisne-bank-match:'+context!.actorId]);
   const previous=await query('SELECT actor_id,request_hash,result FROM bank_assisted_match_batches WHERE id=$1',[input.id]);
   if(previous.rowCount){
    if(previous.rows[0].actor_id!==context!.actorId||previous.rows[0].request_hash!==hash)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Lote de correspondência reutilizado.');
    return {...previous.rows[0].result,replayed:true};
   }
   const stmt=await query('SELECT id FROM bank_statements WHERE id=$1 AND actor_id=$2',[input.statementId,context!.actorId]);
   if(!stmt.rowCount)throw new ApiError(404,'NOT_FOUND','Extrato não encontrado.');
   const ids=input.matches.map(x=>x.lineId);
   const locked=await query('SELECT id,amount,booked_date FROM bank_statement_lines '+
    'WHERE statement_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE',
    [input.statementId,ids]);
   const lines=new Map(locked.rows.map(x=>[String(x.id),x]));
   if(lines.size!==ids.length)throw new ApiError(409,'MATCH_STALE','Linhas indisponíveis.');
   const existing=await query('SELECT m.line_id FROM bank_reconciliation_events m '+
    "WHERE m.line_id=ANY($1::text[]) AND m.kind='match' AND NOT EXISTS "+
    '(SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=m.id)',[ids]);
   if(existing.rowCount)throw new ApiError(409,'MATCH_STALE','Uma linha já está conciliada.');
   const targetIds=input.matches.map(x=>x.targetId);
   const rec=await query("SELECT s.id,s.amount,s.effective_date FROM receivable_settlements s WHERE s.actor_id=$1 AND s.kind='receipt' "+
    'AND s.id=ANY($2::text[]) FOR UPDATE',[context!.actorId,
     input.matches.filter(x=>x.targetType==='receipt').map(x=>x.targetId)]);
   const pay=await query("SELECT s.id,s.amount,s.effective_date FROM payable_payments s WHERE s.actor_id=$1 AND s.kind='payment' "+
    'AND s.id=ANY($2::text[]) FOR UPDATE',[context!.actorId,
     input.matches.filter(x=>x.targetType==='payment').map(x=>x.targetId)]);
   const target=new Map([...rec.rows.map(x=>({...x,kind:'receipt'})),
    ...pay.rows.map(x=>({...x,kind:'payment'}))].map(x=>[String(x.id),x]));
   if(target.size!==targetIds.length)throw new ApiError(409,'MATCH_STALE','Fato financeiro indisponível.');
   const active=await query('SELECT receipt_id,payment_id FROM bank_reconciliation_events m '+
    "WHERE m.kind='match' AND (m.receipt_id=ANY($1::text[]) OR m.payment_id=ANY($1::text[])) "+
    'AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=m.id)',[targetIds]);
   if(active.rowCount)throw new ApiError(409,'MATCH_STALE','Um fato já foi conciliado.');
   const reversals=await query(
    'SELECT id FROM receivable_settlements WHERE reverses_id=ANY($1::text[]) UNION ALL '+
    'SELECT id FROM payable_payments WHERE reverses_id=ANY($1::text[])',[targetIds]);
   if(reversals.rowCount)throw new ApiError(409,'MATCH_STALE','O fato foi estornado.');
   const links=[];
   for(const match of input.matches){
    const line=lines.get(match.lineId)!;
    const t=target.get(match.targetId)!;
    if(t.kind!==match.targetType||
      (BigInt(String(line.amount))>0n?'receipt':'payment')!==match.targetType||
      abs(String(line.amount))!==BigInt(String(t.amount))||
      !Number.isFinite(days(String(line.booked_date),String(t.effective_date)))||
      days(String(line.booked_date),String(t.effective_date))>3)
     throw new ApiError(409,'MATCH_STALE','Valor, sinal ou data não correspondem.');
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await query('INSERT INTO bank_reconciliation_events '+
     '(id,line_id,kind,receipt_id,payment_id,created_at,actor_id,request_hash,correlation_id) '+
     "VALUES($1,$2,'match',$3,$4,$5,$6,$7,$8)",
     [id,match.lineId,match.targetType==='receipt'?match.targetId:null,
      match.targetType==='payment'?match.targetId:null,now,context!.actorId,hash,context!.correlationId]);
    links.push({id,lineId:match.lineId,targetType:match.targetType,targetId:match.targetId});
   }
   const response={id:input.id,statementId:input.statementId,matched:links.length,links};
   await query('INSERT INTO bank_assisted_match_batches(id,actor_id,statement_id,match_count,request_hash,correlation_id,created_at,result) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [input.id,context!.actorId,input.statementId,links.length,hash,context!.correlationId,new Date().toISOString(),JSON.stringify(response)]);
   return {...response,replayed:false};
  });
  return respond(result,context,result.replayed?200:201);
 }catch(error){return failure(error,context);}
}
