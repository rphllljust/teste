'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';

type Evidence={id:string;filename:string;mimeType:string;sizeBytes:number;sha256:string;createdAt:string;evidenceRef:string;uploadedByActorId:string};
type Props={tenantId:string;needId:string;category:'commercial'|'field';onUploaded?:(reference:string)=>void};
const allowed=['application/pdf','image/jpeg','image/png','image/webp'];
export default function ServiceEvidenceAttachmentsPanel({tenantId,needId,category,onUploaded}:Props){
 const [items,setItems]=useState<Evidence[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const picker=useRef<HTMLInputElement>(null);
 const root='/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/'+encodeURIComponent(needId)+'/attachments';
 const load=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch(root+'?category='+category,{credentials:'same-origin',cache:'no-store',signal});
  const result=await response.json() as {items?:Evidence[];error?:string};
  if(!response.ok)throw Error(result.error??'Consulta de evidências indisponível.');
  setItems(result.items??[]);
 },[root,category]);
 useEffect(()=>{
  const ac=new AbortController();
  // Schedule network work after commit to avoid synchronous state cascades.
  const timer=window.setTimeout(()=>{
   void load(ac.signal).catch(e=>{if(!ac.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.');});
  },0);
  return()=>{ac.abort();window.clearTimeout(timer);};
 },[load]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  const file=picker.current?.files?.[0];
  if(!file)return;
  if(!allowed.includes(file.type)||file.size<=0||file.size>4*1024*1024){
   setError('Use PDF, JPEG, PNG ou WebP com até 4 MiB.');return;
  }
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch(root,{method:'POST',credentials:'same-origin',headers:{
     'Content-Type':file.type,'x-cisne-evidence-category':category,
     'x-cisne-filename':encodeURIComponent(file.name),
   },body:file});
   const result=await response.json() as {file?:Evidence;error?:string};
   if(!response.ok||!result.file)throw Error(result.error??'Falha ao registrar evidência.');
   setNotice('Arquivo armazenado e verificado: '+result.file.evidenceRef);
   onUploaded?.(result.file.evidenceRef);
   if(picker.current)picker.current.value='';
   await load();
  }catch(ex){setError(ex instanceof Error?ex.message:'Não foi possível registrar o arquivo.');}
  finally{setBusy(false);}
 }
 async function download(file:Evidence){
  if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch(root+'/'+encodeURIComponent(file.id),{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Arquivo não autorizado ou indisponível.');
   const body=await response.blob();
   if(body.size!==file.sizeBytes)throw Error('O arquivo foi recebido com tamanho inesperado.');
   const url=URL.createObjectURL(body);
   try{
    const a=document.createElement('a');a.href=url;a.download=file.filename;
    document.body.appendChild(a);a.click();a.remove();
   }finally{URL.revokeObjectURL(url);}
  }catch(ex){setError(ex instanceof Error?ex.message:'Falha ao baixar.');}
  finally{setBusy(false);}
 }
 return <section className="enterprise-governance-panel" aria-label={'Arquivos protegidos: '+category}>
  <h4>{category==='commercial'?'Documentos comerciais reais':'Fotografias e evidências de campo'}</h4>
  <p>Arquivos são guardados com SHA-256, autoria e escopo empresarial. Download exige autorização atual. Limite de 4 MiB por arquivo; tipos aceitos: PDF, JPEG, PNG e WebP.</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  <form onSubmit={e=>void submit(e)}>
   <label>Selecionar arquivo <input ref={picker} type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" disabled={busy}/></label>
   <button type="submit" disabled={busy}>Armazenar evidência</button>
   <button type="button" disabled={busy} onClick={()=>void load().catch(e=>setError(String(e)))}>Atualizar</button>
  </form>
  {items.length===0&&<p>Nenhum arquivo registrado nesta categoria.</p>}
  {items.map(f=><div className="form-row" key={f.id}>
   <span><strong>{f.filename}</strong> · {(f.sizeBytes/1024).toFixed(1)} KiB · {f.createdAt}</span>
   <button type="button" disabled={busy} onClick={()=>void download(f)}>Baixar protegido</button>
   <button type="button" disabled={busy} onClick={()=>navigator.clipboard?.writeText(f.evidenceRef)}>Copiar referência</button>
  </div>)}
 </section>;
}
