import {createHash,randomUUID} from 'node:crypto';
import {ApiError} from '../api/http';
import {memberRole,isVerifiedOwner,type Query} from './service-needs';

export const MAX_SERVICE_EVIDENCE_BYTES=4*1024*1024;
export const MAX_HTTP_UPLOAD_BYTES=MAX_SERVICE_EVIDENCE_BYTES+8192;
export const SERVICE_EVIDENCE_MIMES=['application/pdf','image/png','image/jpeg','image/webp'] as const;
export type ServiceEvidenceCategory='commercial'|'field';
type Context={tenantId:string;needId:string;actorId:string};

const denied=()=>new ApiError(404,'NOT_FOUND','Documento não encontrado no contexto autorizado.');

export function validateServiceEvidenceBytes(mime:string,bytes:Buffer){
 if(!SERVICE_EVIDENCE_MIMES.includes(mime as typeof SERVICE_EVIDENCE_MIMES[number]))
  throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','Somente PDF, JPEG, PNG ou WebP são aceitos.');
 if(bytes.length===0||bytes.length>MAX_SERVICE_EVIDENCE_BYTES)
  throw new ApiError(413,'FILE_TOO_LARGE','O arquivo deve ter no máximo 4 MiB.');
 const head=bytes.subarray(0,12);
 const valid=mime==='application/pdf'
  ? head.subarray(0,5).equals(Buffer.from('%PDF-'))
  : mime==='image/png'
  ? head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  : mime==='image/jpeg'
  ? head.subarray(0,3).equals(Buffer.from([255,216,255]))
  : head.subarray(0,4).toString('ascii')==='RIFF' && head.subarray(8,12).toString('ascii')==='WEBP';
 if(!valid)throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','A assinatura do arquivo não corresponde ao formato informado.');
 return createHash('sha256').update(bytes).digest('hex');
}

export function cleanEvidenceFileName(value:string){
 const normalized=value.normalize('NFKC').replace(/[\\/\x00-\x1f\x7f]/g,'_').trim();
 if(!normalized||normalized.length>160||normalized==='.'||normalized==='..')
  throw new ApiError(400,'VALIDATION_FAILED','Nome de arquivo inválido.');
 return normalized;
}

/** Only a declared verified owner or an assigned employee sees evidence. */
export async function requireServiceEvidenceAccess(q:Query,c:Context,category:ServiceEvidenceCategory,write=false){
 const role=await memberRole(q,c.tenantId,c.actorId);
 const found=await q('SELECT status FROM svc_needs WHERE tenant_id=$1 AND id=$2 FOR SHARE',[c.tenantId,c.needId]);
 if(!found.rows.length)throw denied();
 const status=String(found.rows[0].status);
 const owner=role==='owner'&&await isVerifiedOwner(q,c.tenantId,c.actorId);
 if(owner){
  if(write&&category==='commercial'&&!['received','in_analysis','approved','converted'].includes(status))
   throw new ApiError(409,'INVALID_STATE','Documentação comercial congelada após a liberação.');
  if(write&&category==='field'&&!['released','executing'].includes(status))
   throw new ApiError(409,'INVALID_STATE','Evidência de campo exige OS liberada.');
  return {owner:true,assignmentId:null as string|null};
 }
 if(role!=='operator'||category!=='field'||!['released','executing'].includes(status))
  throw denied();
 const assigned=await q(`SELECT a.id FROM svc_assignments a
   JOIN svc_employee_links l ON l.tenant_id=a.tenant_id AND l.employee_actor_id=a.employee_actor_id
   WHERE a.tenant_id=$1 AND a.need_id=$2 AND a.employee_actor_id=$3 LIMIT 1`,
  [c.tenantId,c.needId,c.actorId]);
 if(!assigned.rows.length)throw denied();
 return {owner:false,assignmentId:String(assigned.rows[0].id)};
}

export async function listServiceEvidence(q:Query,c:Context,category:ServiceEvidenceCategory){
 await requireServiceEvidenceAccess(q,c,category);
 const rows=await q(`SELECT id,category,filename,mime_type AS "mimeType",
  byte_size AS "sizeBytes",sha256,created_at AS "createdAt",
  uploaded_by_actor_id AS "uploadedByActorId"
  FROM svc_evidence_files WHERE tenant_id=$1 AND need_id=$2 AND category=$3
  ORDER BY created_at DESC,id DESC LIMIT 100`,[c.tenantId,c.needId,category]);
 return rows.rows.map(r=>({...r,evidenceRef:'cisne-file:'+r.id}));
}

export async function saveServiceEvidence(q:Query,c:Context,category:ServiceEvidenceCategory,filename:string,mime:string,bytes:Buffer){
 const access=await requireServiceEvidenceAccess(q,c,category,true);
 const safeFilename=cleanEvidenceFileName(filename);
 const sha256=validateServiceEvidenceBytes(mime,bytes);
 const id=randomUUID();
 await q(`INSERT INTO svc_evidence_files
   (id,tenant_id,need_id,assignment_id,category,filename,mime_type,byte_size,sha256,contents,uploaded_by_actor_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [id,c.tenantId,c.needId,access.assignmentId,category,safeFilename,mime,bytes.length,sha256,bytes,c.actorId]);
 return {id,category,filename:safeFilename,mimeType:mime,sizeBytes:bytes.length,sha256,evidenceRef:'cisne-file:'+id};
}

export async function readServiceEvidence(q:Query,c:Context,id:string){
 const row=await q(`SELECT id,category,filename,mime_type,byte_size,sha256,contents
 FROM svc_evidence_files WHERE id=$1 AND tenant_id=$2 AND need_id=$3`,[id,c.tenantId,c.needId]);
 const file=row.rows[0];
 if(!file)throw denied();
 await requireServiceEvidenceAccess(q,c,String(file.category) as ServiceEvidenceCategory);
 const contents=Buffer.from(file.contents);
 if(contents.length!==Number(file.byte_size)||
    createHash('sha256').update(contents).digest('hex')!==file.sha256)
  throw new ApiError(503,'EVIDENCE_INTEGRITY_FAILURE','Integridade do arquivo indisponível.');
 return {id:String(file.id),filename:String(file.filename),mimeType:String(file.mime_type),contents};
}
