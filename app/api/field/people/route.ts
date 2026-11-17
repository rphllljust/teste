import { z } from 'zod';
import { databasePool } from '../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../lib/api/http';

export const dynamic = 'force-dynamic';
const input = z.object({
  id:z.string().uuid().optional(),
  kind:z.enum(['person','team']),
  name:z.string().trim().min(2).max(160),
  externalRef:z.string().trim().max(160).optional().nullable(),
});
const uuid=z.string().uuid();

export async function GET(request:Request):Promise<Response>{
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const url=new URL(request.url);
    const active=url.searchParams.get('active');
    const kind=url.searchParams.get('kind');
    const params=[context.actorId] as string[];
    const filters=['owner_id=$1'];
    if(active==='true'||active==='false'){params.push(active);filters.push(`active=$${params.length}`);}
    if(kind==='person'||kind==='team'){params.push(kind);filters.push(`kind=$${params.length}`);}
    const rows=await databasePool().query(
      `SELECT id,kind,name,external_ref,active,created_at,updated_at
       FROM service_people WHERE ${filters.join(' AND ')}
       ORDER BY active DESC,kind ASC,name ASC LIMIT 200`,params);
    return respond({people:rows.rows},context);
  }catch(error){return failure(error,context);}
}

export async function POST(request:Request):Promise<Response>{
  let context:RequestContext|undefined;
  try{
    context=requestContext(request);
    const parsed=input.safeParse(await request.json());
    if(!parsed.success) throw new ApiError(400,'VALIDATION_FAILED','Pessoa/equipe inválida.');
    const db=databasePool();
    const id=parsed.data.id??crypto.randomUUID();
    if(!uuid.safeParse(id).success) throw new ApiError(400,'VALIDATION_FAILED','Identificador inválido.');
    const row=await db.query(
      `INSERT INTO service_people(id,owner_id,kind,name,external_ref)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(owner_id,kind,name) DO UPDATE SET external_ref=EXCLUDED.external_ref,active=true,updated_at=now()
       RETURNING id,kind,name,external_ref,active,created_at,updated_at`,
      [id,context.actorId,parsed.data.kind,parsed.data.name,parsed.data.externalRef??null]);
    return respond({person:row.rows[0]},context,201);
  }catch(error){return failure(error,context);}
}
