'use client';
import {useEffect,useState} from 'react';

type Finding={code:string;ok:boolean;detail:string};
type Result={status:'NO_GO'|'READY_FOR_PERSONAL_UAT';findings:Finding[];caution:string;checkedAt:string;error?:string};
export default function ServiceNeedsReadinessPanel({tenantId}:{tenantId:string}){
 const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!tenantId)return;
  const controller=new AbortController();
  void fetch('/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/readiness',{
   credentials:'same-origin',cache:'no-store',signal:controller.signal,
  }).then(async r=>{
   const data=await r.json() as Result;
   if(!r.ok)throw Error(data.error??'Consulta indisponível.');
   if(!controller.signal.aborted){setResult(data);setError('');}
  }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Consulta indisponível.');setResult(null);}});
  return()=>controller.abort();
 },[tenantId,revision]);
 return <details className="enterprise-governance-panel">
  <summary><strong>Prontidão para GO funcional</strong> · verificação de configurações reais</summary>
  {error&&<p role="alert">{error}</p>}
  {result&&<>
   <p><strong>{result.status==='NO_GO'?'NO-GO: pendências de implantação ou identidades':'Apto à homologação individual de campo'}</strong></p>
   <ul>{result.findings.map(f=><li key={f.code}>{f.ok?'Conforme':'Pendente'} · {f.detail}</li>)}</ul>
   <p>{result.caution}</p>
   <p>Verificado: {result.checkedAt}</p>
  </>}
  <button type="button" onClick={()=>setRevision(v=>v+1)}>Revalidar prontidão</button>
 </details>;
}
