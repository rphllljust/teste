import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';
import {pgConflict} from '../../../../lib/domain/accounting';
import {escapedLike} from '../../../../lib/api/query';

export const dynamic='force-dynamic';
const body=z.object({
  id:z.string().uuid(),
  fullName:z.string().trim().min(2).max(160),
  specialty:z.string().trim().min(2).max(120),
  employeeCode:z.string().trim().max(40).optional().or(z.literal('')),
  department:z.string().trim().max(120).optional().or(z.literal('')),
  phone:z.string().trim().max(40).optional().or(z.literal('')),
  costHourScaled:z.coerce.number().int().min(0).max(999999999999).optional().nullable(),
}).strict();

export async function GET(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const filters=z.object({
      q:z.string().trim().max(160).optional(),
      page:z.coerce.number().int().min(1).max(10000).default(1),
    }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if(!filters.success)throw new ApiError(400,'VALIDATION_FAILED','Busca ou página de profissionais inválida.');
    const {page}=filters.data,q=filters.data.q??'';
    const where=q?' AND (full_name ILIKE ? OR specialty ILIKE ?)':'';
    const args=q?[context.actorId,escapedLike(q),escapedLike(q),101,(page-1)*100]:
      [context.actorId,101,(page-1)*100];
    const result=await database().prepare(
      'SELECT id,full_name AS "fullName",specialty,employee_code AS "employeeCode",department,phone,cost_hour_scaled AS "costHourScaled",active,created_at AS "createdAt" FROM field_people WHERE owner_id=?'+where+
      ' ORDER BY full_name,id LIMIT ? OFFSET ?',
    ).bind(...args).all();
    return respond({items:result.results.slice(0,100),pageInfo:{page,hasMore:result.results.length>100}},context);
  }catch(error){return failure(error,context);}
}

export async function POST(request:Request){
  let context:RequestContext|undefined;
  try{
    context=requestContext(request,true);
    const parsed=body.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Nome e especialidade são obrigatórios.');
    const p=parsed.data;
    const hash=await fingerprint({actorId:context.actorId,payload:p});
    const result=await database().transaction(async query=>{
      const current=await query('SELECT owner_id,request_hash FROM field_people WHERE id=$1 FOR UPDATE',[p.id]);
      if(current.rows.length){
        if(current.rows[0].owner_id!==context!.actorId||current.rows[0].request_hash!==hash)
          throw new ApiError(409,'PERSON_CONFLICT','Identificador já utilizado para outro cadastro.');
        return {ok:true,replayed:true,personId:p.id};
      }
      await query(
        'INSERT INTO field_people(id,owner_id,full_name,specialty,employee_code,department,phone,cost_hour_scaled,request_hash) VALUES($1,$2,$3,$4,NULLIF($5,\'\'),NULLIF($6,\'\'),NULLIF($7,\'\'),$8,$9)',
        [p.id,context!.actorId,p.fullName,p.specialty,p.employeeCode??'',p.department??'',p.phone??'',p.costHourScaled??null,hash],
      );
      return {ok:true,replayed:false,personId:p.id};
    }).catch(pgConflict);
    return respond(result,context,result.replayed?200:201);
  }catch(error){return failure(error,context);}
}
