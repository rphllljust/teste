'use client';
import {useEffect,useRef,useState} from 'react';
import {FileCheck2,ChevronDown,RefreshCw,ShieldCheck,Download} from 'lucide-react';

type AuthorizedDocument={
  id:string;kind:string;version:number;
  sha256:string|null;linkedAt:string;
};
type Result={
  enabled?:boolean;items?:AuthorizedDocument[];reason?:string;
  error?:string;code?:string;
};
const MAX_UPLOAD_BYTES=8*1024*1024;
const allowedTypes=new Set([
  'application/pdf','text/plain','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png','image/jpeg','image/gif','image/webp',
]);
const kindLabels:Record<string,string>={
  attachment:'Anexo',contract:'Contrato',photo:'Fotografia',
  service_report:'Relatório de serviço',inspection:'Inspeção',invoice:'Fatura',
};

/** Never shows cached/denied NextCRM metadata or untrusted file URLs. */
export default function OrderNextcrmDocuments({orderId}:{orderId:string}){
  const [expanded,setExpanded]=useState(false);
  const [generation,setGeneration]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [downloading,setDownloading]=useState<string|null>(null);
  const [selectedFile,setSelectedFile]=useState<File|null>(null);
  const [uploadKind,setUploadKind]=useState('attachment');
  const [uploading,setUploading]=useState(false);
  const [uploadError,setUploadError]=useState('');
  const [uploadNotice,setUploadNotice]=useState('');
  const fileInput=useRef<HTMLInputElement|null>(null);
  const [result,setResult]=useState<Result|null>(null);
  useEffect(()=>{
    if(!expanded)return;
    const controller=new AbortController();
    const t=setTimeout(async()=>{
      setBusy(true);setError('');setResult(null);
      try{
        const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/documents',{
          cache:'no-store',credentials:'same-origin',signal:controller.signal,
        });
        const data=await response.json() as Result;
        if(!response.ok)throw new Error(data.error||'Autorização documental indisponível.');
        if(!controller.signal.aborted)setResult(data);
      }catch(e){
        if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Documentos indisponíveis.');
      }finally{if(!controller.signal.aborted)setBusy(false);}
    },0);
    return()=>{controller.abort();clearTimeout(t);};
  },[orderId,expanded,generation]);

  async function downloadAttachment(doc:AuthorizedDocument){
    if(downloading)return;
    setDownloading(doc.id);
    setError('');
    try{
      const path='/api/orders/'+encodeURIComponent(orderId)+'/documents/'+encodeURIComponent(doc.id)+'/file';
      // The same-origin Field route fetches bytes only after a FRESH private
      // NextCRM authorization. A presigned MinIO URL never reaches the browser.
      const response=await fetch(path,{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw new Error('Arquivo indisponível ou acesso revogado. Atualize a consulta.');
      const size=Number(response.headers.get('content-length')??'0');
      if(!Number.isFinite(size)||size>8*1024*1024)
        throw new Error('Este anexo excede o limite de homologação.');
      const file=await response.blob();
      if(file.size>8*1024*1024)throw new Error('Arquivo excede o limite de homologação.');
      const url=URL.createObjectURL(file);
      try{
        const anchor=document.createElement('a');
        anchor.href=url;
        anchor.download='nextcrm-'+doc.id.slice(0,8)+'.bin';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }finally{URL.revokeObjectURL(url);}
    }catch(e){
      setError(e instanceof Error?e.message:'Não foi possível baixar o arquivo.');
    }finally{setDownloading(null);}
  }

  function selectFile(file:File|null){
    setUploadError('');setUploadNotice('');
    if(!file){setSelectedFile(null);return;}
    if(file.size===0){setSelectedFile(null);setUploadError('O arquivo está vazio.');return;}
    if(file.size>MAX_UPLOAD_BYTES){setSelectedFile(null);setUploadError('O arquivo excede o limite de 8 MB.');return;}
    if(!allowedTypes.has(file.type)){
      setSelectedFile(null);setUploadError('Tipo de arquivo não permitido. Use PDF, texto, Word ou imagem.');return;
    }
    setSelectedFile(file);
  }

  async function uploadDocument(){
    if(!selectedFile||uploading)return;
    setUploading(true);setUploadError('');setUploadNotice('Preparando o upload seguro…');
    const idempotencyKey=crypto.randomUUID();
    try{
      const bytes=await selectedFile.arrayBuffer();
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      const endpoint='/api/orders/'+encodeURIComponent(orderId)+'/documents/upload';
      const prepareResponse=await fetch(endpoint,{method:'POST',cache:'no-store',credentials:'same-origin',
        headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
        body:JSON.stringify({action:'prepare',key:idempotencyKey,name:selectedFile.name,
          contentType:selectedFile.type,size:selectedFile.size,sha256}),});
      const prepare=await prepareResponse.json() as {error?:string;upload?:{documentId:string;uploadUrl:string}};
      if(!prepareResponse.ok||!prepare.upload?.uploadUrl)throw new Error(prepare.error||'Não foi possível preparar o upload.');
      setUploadNotice('Enviando arquivo ao armazenamento…');
      const storageResponse=await fetch(prepare.upload.uploadUrl,{method:'PUT',headers:{'Content-Type':selectedFile.type},body:selectedFile});
      if(!storageResponse.ok)throw new Error('O armazenamento recusou o arquivo. Tente novamente.');
      setUploadNotice('Confirmando vínculo empresarial…');
      const completeResponse=await fetch(endpoint,{method:'POST',cache:'no-store',credentials:'same-origin',
        headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
        body:JSON.stringify({action:'complete',key:idempotencyKey,documentId:prepare.upload.documentId,
          documentKind:uploadKind,version:1,name:selectedFile.name,contentType:selectedFile.type,
          size:selectedFile.size,sha256}),});
      const complete=await completeResponse.json() as {error?:string};
      if(!completeResponse.ok)throw new Error(complete.error||'O vínculo documental não foi confirmado.');
      setSelectedFile(null);if(fileInput.current)fileInput.current.value='';
      setUploadNotice('Documento anexado e confirmado no armazenamento.');
      setGeneration(value=>value+1);
    }catch(e){setUploadError(e instanceof Error?e.message:'Não foi possível anexar o documento.');setUploadNotice('');}
    finally{setUploading(false);}
  }

  return <section className="order-nextcrm-documents" aria-label="Documentos do NextCRM">
    <button type="button" className="related" aria-expanded={expanded}
      onClick={()=>setExpanded(value=>!value)}>
      <span><strong>Documentos vinculados · NextCRM</strong>
        <small>Consulta com autorização atualizada no CRM de origem</small></span>
      <ChevronDown size={16} aria-hidden="true"/>
    </button>
    {expanded&&<div className="order-relation-context">
      <header><strong>Documentos autorizados</strong>
        <button type="button" className="text-button" disabled={busy}
          onClick={()=>setGeneration(v=>v+1)}>
          <RefreshCw size={13} aria-hidden="true"/> Atualizar
        </button>
      </header>
      <div className="document-upload" aria-label="Anexar documento">
        <input ref={fileInput} type="file" hidden
          accept="application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/gif,image/webp"
          onChange={event=>selectFile(event.target.files?.[0]??null)}/>
        <button type="button" className="text-button" disabled={uploading}
          onClick={()=>fileInput.current?.click()}>Anexar documento</button>
        <label>Tipo documental
          <select value={uploadKind} disabled={uploading} onChange={event=>setUploadKind(event.target.value)}>
            {Object.entries(kindLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {selectedFile&&<span role="status">{selectedFile.name} · {(selectedFile.size/1024).toFixed(1)} KB
          <button type="button" className="text-button" disabled={uploading} onClick={()=>void uploadDocument()}>
            {uploading?'Enviando…':'Enviar arquivo'}
          </button>
        </span>}
        {uploadNotice&&<p role="status" className="muted">{uploadNotice}</p>}
        {uploadError&&<p role="alert" className="form-error">{uploadError}</p>}
      </div>
      {busy&&<p role="status">Verificando permissões no NextCRM…</p>}
      {error&&<p role="alert" className="form-error">{error}</p>}
      {!busy&&!error&&result?.enabled===false&&<p className="muted">
        O vínculo entre o usuário, o cliente do Field e a conta do NextCRM
        ainda não foi aprovado. Nenhum documento externo foi exposto.
      </p>}
      {!busy&&!error&&result?.enabled===true&&result.items?.length===0&&
        <p className="muted">Nenhum documento autorizado para esta ordem.</p>}
      {!busy&&!error&&result?.enabled===true&&result.items?.map(doc=>
        <div className="related" key={doc.id}>
          <FileCheck2 size={16} aria-hidden="true"/>
          <span><strong>{kindLabels[doc.kind]??'Documento'} · versão {doc.version}</strong>
            <small>Registro verificado no NextCRM · vínculo {doc.id.slice(0,8)}</small></span>
          <ShieldCheck size={15} aria-label="Autorização atual verificada"/>
          {doc.kind==='attachment'&&<button type="button" className="text-button"
            disabled={downloading!==null} onClick={()=>void downloadAttachment(doc)}
            aria-label={'Baixar anexo NextCRM '+doc.id.slice(0,8)}>
            <Download size={14} aria-hidden="true"/>
            {downloading===doc.id?'Baixando…':'Baixar arquivo'}
          </button>}
        </div>)}
    </div>}
  </section>;
}
