'use client';
import {useEffect,useState} from 'react';
import {FileCheck2,ChevronDown,RefreshCw,ShieldCheck} from 'lucide-react';

type AuthorizedDocument={
  id:string;documentId:string;kind:string;version:number;
  sha256:string|null;linkedAt:string;
};
type Result={
  enabled?:boolean;items?:AuthorizedDocument[];reason?:string;
  error?:string;code?:string;
};
const kindLabels:Record<string,string>={
  attachment:'Anexo',contract:'Contrato',photo:'Fotografia',
  service_report:'Relatório de serviço',inspection:'Inspeção',invoice:'Fatura',
};

/** Never shows cached/denied NextCRM metadata or untrusted file URLs. */
export default function OrderNextcrmDocuments({orderId}:{orderId:string}){
  const [expanded,setExpanded]=useState(false);
  const [generation,setGeneration]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
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
        </div>)}
    </div>}
  </section>;
}
