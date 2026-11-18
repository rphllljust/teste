import {ApiError, validDate} from '../api/http';

export type JournalInputLine = {id:string;accountId:string;side:'debit'|'credit';amount:string};
export type PostedLine = {id:string;accountId:string;debit:number;credit:number};

export function scaledAccountingAmount(text:string):number {
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:,[0-9]{1,4})?$/.test(text)) {
    throw new ApiError(400,'VALIDATION_FAILED','Valor contábil inválido; use até quatro casas decimais.');
  }
  const [units, decimals=''] = text.split(',');
  const n=BigInt(units)*10000n+BigInt((decimals+'0000').slice(0,4));
  if (n<1n || n>2147483647n) {
    throw new ApiError(400,'VALIDATION_FAILED','Valor contábil deve ser positivo e caber no campo monetário.');
  }
  return Number(n);
}

export function balancedJournalLines(lines:JournalInputLine[]):PostedLine[] {
  if (!Array.isArray(lines) || lines.length<2 || lines.length>100) {
    throw new ApiError(400,'VALIDATION_FAILED','Informe de 2 a 100 partidas.');
  }
  const seen=new Set<string>();
  let debit=0n,credit=0n;
  const posted=lines.map(row=>{
    if (seen.has(row.id)) throw new ApiError(400,'VALIDATION_FAILED','Identificador de partida duplicado.');
    seen.add(row.id);
    const amount=scaledAccountingAmount(row.amount);
    if (row.side==='debit') debit+=BigInt(amount);
    else credit+=BigInt(amount);
    return {id:row.id,accountId:row.accountId,debit:row.side==='debit'?amount:0,
      credit:row.side==='credit'?amount:0};
  });
  if (debit===0n || credit===0n || debit!==credit) {
    throw new ApiError(400,'UNBALANCED_JOURNAL','A soma dos débitos deve ser igual à dos créditos.');
  }
  return posted;
}

export function assertAccountingDate(date:string):void {
  if(!validDate(date))throw new ApiError(400,'VALIDATION_FAILED','Data contábil inválida.');
}

export async function assertAccountingPeriodOpen(
  query:(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>}>,
  actorId:string,effectiveDate:string,
):Promise<void>{
  const existing=await query(
    "SELECT id FROM finance_period_closes WHERE actor_id=$1 AND status='closed' AND period_start<=$2 AND period_end>=$2 LIMIT 1",
    [actorId,effectiveDate],
  );
  if(existing.rows.length)throw new ApiError(409,'PERIOD_CLOSED','O período financeiro está fechado.');
}

export function pgConflict(error:unknown):never{
  if(error && typeof error==='object' && 'code' in error &&
     (error.code==='23505' || error.code==='23503' || error.code==='23514')) {
    throw new ApiError(409,'CONSTRAINT_VIOLATION','Há um conflito de integridade ou duplicidade contábil.');
  }
  throw error;
}
