import {z} from 'zod';
import {escapedLike} from '../api/query';
import {caseInsensitiveContains} from '../api/postgres-query.mjs';
import {validDate} from '../api/http';

export const payableList=z.object({q:z.string().trim().max(160).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().refine(v=>[10,25,50,100].includes(v)).default(25),state:z.enum(['open','partial','settled','outstanding']).optional(),dueFrom:z.string().refine(validDate).optional(),dueTo:z.string().refine(validDate).optional(),sort:z.enum(['createdAt.desc','createdAt.asc','dueDate.asc']).default('createdAt.desc')}).strict().refine(p=>!p.dueFrom||!p.dueTo||p.dueFrom<=p.dueTo);
export const paidExpression="COALESCE((SELECT SUM(CASE WHEN x.kind='payment' THEN x.amount ELSE -x.amount END) FROM payable_payments x WHERE x.payable_id=p.id),0)";
export const payableBalance=`p.amount-${paidExpression}`;
export function payableQuery(p:z.infer<typeof payableList>,actorId:string){
 const conditions:string[]=['p.actor_id=?'],values:string[]=[actorId];
 if(p.q){conditions.push(caseInsensitiveContains(['p.supplier','p.source_reference','p.id']));values.push(...Array<string>(3).fill(escapedLike(p.q)));}
 if(p.dueFrom){conditions.push('p.due_date>=?');values.push(p.dueFrom);}
 if(p.dueTo){conditions.push('p.due_date<=?');values.push(p.dueTo);}
 if(p.state)conditions.push(p.state==='outstanding'?`${payableBalance}>0`:p.state==='open'?`${payableBalance}=p.amount`:p.state==='settled'?`${payableBalance}=0`:`${payableBalance}>0 AND ${payableBalance}<p.amount`);
 const sort=p.sort==='dueDate.asc'?'p.due_date ASC,p.id ASC':p.sort==='createdAt.asc'?'p.created_at ASC,p.id ASC':'p.created_at DESC,p.id DESC';
 return {where:conditions.length?' WHERE '+conditions.join(' AND '):'',values,sort};
}
