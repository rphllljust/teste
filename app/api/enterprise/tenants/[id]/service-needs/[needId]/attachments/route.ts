import {z} from 'zod';
import {database} from '../../../../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../../../../lib/api/http';
import {MAX_SERVICE_EVIDENCE_BYTES,MAX_HTTP_UPLOAD_BYTES,
 listServiceEvidence,saveServiceEvidence,type ServiceEvidenceCategory} from '../../../../../../../../lib/application/service-evidence';

export const dynamic='force-dynamic';
type Route={params:Promise<{id:string;needId:string}>};
const uuid=z.string().uuid();
function category(value:string|null):ServiceEvidenceCategory{
 if(value!=='commercial'&&value!=='field')
  throw new ApiError(400,'VALIDATION_FAILED','Categoria documental inválida.');
 return value;
}
async function limitedBytes(request:Request){
 const hint=request.headers.get('content-length');
 if(hint&&(!/^\d+$/.test(hint)||Number(hint)>MAX_HTTP_UPLOAD_BYTES))
  throw new ApiError(413,'FILE_TOO_LARGE','Arquivo excede 4 MiB.');
 if(!request.body)throw new ApiError(400,'VALIDATION_FAILED','Arquivo obrigatório.');
 const reader=request.body.getReader();const chunks:Buffer[]=[];let n=0;
 try{
  while(true){
   const next=await reader.read();if(next.done)break;
   n+=next.value.byteLength;
   if(n>MAX_SERVICE_EVIDENCE_BYTES)throw new ApiError(413,'FILE_TOO_LARGE','Arquivo excede 4 MiB.');
   chunks.push(Buffer.from(next.value));
  }
 }finally{reader.releaseLock();}
 return Buffer.concat(chunks,n);
}
export async function GET(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const {id,needId}=await route.params;
  if(!uuid.safeParse(id).success||!uuid.safeParse(needId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Identificador inválido.');
  const kind=category(new URL(request.url).searchParams.get('category'));
  const items=await database().transaction(q=>listServiceEvidence(q,{tenantId:id,needId,actorId:ctx!.actorId},kind));
  return respond({items,category:kind},ctx);
 }catch(error){return failure(error,ctx);}
}
export async function POST(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const {id,needId}=await route.params;
  if(!uuid.safeParse(id).success||!uuid.safeParse(needId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Identificador inválido.');
  const kind=category(request.headers.get('x-cisne-evidence-category'));
  const raw=request.headers.get('x-cisne-filename')??'';
  let filename:string;
  try{filename=decodeURIComponent(raw);}catch{throw new ApiError(400,'VALIDATION_FAILED','Nome de arquivo inválido.');}
  const mime=(request.headers.get('content-type')??'').split(';')[0].toLowerCase();
  const bytes=await limitedBytes(request);
  const result=await database().transaction(q=>saveServiceEvidence(q,{tenantId:id,needId,actorId:ctx!.actorId},kind,filename,mime,bytes));
  return respond({ok:true,file:result},ctx,201);
 }catch(error){return failure(error,ctx);}
}
