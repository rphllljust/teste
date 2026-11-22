import {database} from '../../../../db/raw';
import {ApiError,failure,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){let context:RequestContext|undefined;try{context=requestContext(request);const page=Math.max(1,Number(new URL(request.url).searchParams.get('page')??1));const size=25;const rows=await database().prepare('SELECT j.id,j.effective_date,j.source_reference,j.description,j.status,j.expected_count,j.created_at,j.reversal_of,COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit FROM journal_entries j LEFT JOIN journal_lines l ON l.entry_id=j.id WHERE j.actor_id=? GROUP BY j.id ORDER BY j.effective_date DESC,j.id DESC LIMIT ? OFFSET ?').bind(context.actorId,size,(page-1)*size).all<Record<string,unknown>>();return respond({items:rows.results.map(r=>({id:String(r.id),facts:{effectiveDate:String(r.effective_date),sourceReference:String(r.source_reference),description:String(r.description),status:String(r.status),expectedCount:Number(r.expected_count),createdAt:String(r.created_at),reversalOf:r.reversal_of?String(r.reversal_of):null},totalDebitScaled:String(r.debit),totalCreditScaled:String(r.credit)})),pageInfo:{page,hasMore:rows.results.length===size}},context);}catch(e){return failure(e,context);}}

export async function POST(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const body=await jsonBody(request) as {id?:unknown;effectiveDate?:unknown;sourceReference?:unknown;description?:unknown;lines?:unknown};
    const id=typeof body.id==='string'&&body.id.trim()?body.id.trim():'';
    const effectiveDate=typeof body.effectiveDate==='string'?body.effectiveDate.trim():'';
    const sourceReference=typeof body.sourceReference==='string'?body.sourceReference.trim():'';
    const description=typeof body.description==='string'?body.description.trim():'';
    if(!id||id.length>80||!/^\\d{4}-\\d{2}-\\d{2}$/.test(effectiveDate)||sourceReference.length<3||sourceReference.length>160||description.length<3||description.length>4000||!Array.isArray(body.lines)||body.lines.length<2||body.lines.length>100)
      throw new ApiError(400,'VALIDATION_FAILED','Confira os dados do lançamento.');
    const lines=body.lines.map((raw,index)=>{
      const line=raw as {id?:unknown;accountId?:unknown;side?:unknown;amount?:unknown};
      const lineId=typeof line.id==='string'&&line.id.trim()?line.id.trim():id+'-'+(index+1);
      const accountId=typeof line.accountId==='string'?line.accountId.trim():'';
      const side=line.side==='debit'||line.side==='credit'?line.side:'';
      const amountText=typeof line.amount==='string'?line.amount.trim():'';
      if(!accountId||!side||!/^[0-9]+(?:,[0-9]{1,4})?$/.test(amountText))
        throw new ApiError(400,'VALIDATION_FAILED','Cada partida deve informar conta, natureza e valor.');
      const amount=Number(amountText.replace(',','.'));
      if(!Number.isSafeInteger(Math.round(amount*100))||amount<=0)
        throw new ApiError(400,'VALIDATION_FAILED','O valor de cada partida deve ser positivo.');
      return {lineId,accountId,side,scaled:Math.round(amount*100)};
    });
    const debit=lines.filter(l=>l.side==='debit').reduce((sum,l)=>sum+l.scaled,0);
    const credit=lines.filter(l=>l.side==='credit').reduce((sum,l)=>sum+l.scaled,0);
    if(debit<=0||debit!==credit)throw new ApiError(400,'UNBALANCED_ENTRY','Débitos e créditos precisam ser iguais e maiores que zero.');
    const uniqueAccounts=[...new Set(lines.map(l=>l.accountId))];
    const now=new Date().toISOString();
    const result=await database().transaction(async query=>{
      const accounts=await query(
        'SELECT id FROM chart_accounts WHERE id=ANY($1::text[]) AND active=1 AND (actor_id=$2 OR active=1)',
        [uniqueAccounts,context!.actorId],
      );
      if(accounts.rowCount!==uniqueAccounts.length)throw new ApiError(400,'VALIDATION_FAILED','Uma ou mais contas não estão disponíveis.');
      const inserted=await query(
        "INSERT INTO journal_entries (id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,'posted',$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING id",
        [id,effectiveDate,sourceReference,description,lines.length,now,context!.actorId,id,context!.correlationId],
      );
      if(!inserted.rowCount)throw new ApiError(409,'ALREADY_EXISTS','Este lançamento já existe.');
      for(const line of lines){
        await query(
          'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,$5)',
          [line.lineId,id,line.accountId,line.side==='debit'?line.scaled:0,line.side==='credit'?line.scaled:0],
        );
      }
      return {ok:true,id};
    });
    return respond(result,context,201);
  }catch(e){return failure(e,context);}
}