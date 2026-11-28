'use client';
import {useEffect,useState} from 'react';
import {moneyScaled} from '../lib/domain/orders';
type Step={code:string;label:string;done:boolean;detail:string};
type Assurance={status:'PENDING'|'EVIDENCE_COMPLETE';steps:Step[];
 summary:{invoiceAmountScaled:string;receivableAmountScaled:string;settledScaled:string;outstandingScaled:string;
 cashEvents:number;cashEventsWithPostedGL:number;unpostedCashEvents:number;activeReceipts:number;bankMatchedReceipts:number;truncated:boolean};
 checkedAt:string;source:string;readOnly:boolean;caution:string;error?:string};
export default function ServiceNeedsFinanceIntegrityPanel({tenantId,needId,revision=0}:{
 tenantId:string;needId:string;revision?:number;
}){
 const [data,setData]=useState<Assurance|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{
  const ac=new AbortController();
  const url='/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/'+
    encodeURIComponent(needId)+'/finance-assurance';
  void fetch(url,{credentials:'same-origin',cache:'no-store',signal:ac.signal}).then(async r=>{
   const x=await r.json() as Assurance;
   if(!r.ok)throw Error(x.error??'Evidências financeiras indisponíveis.');
   if(!ac.signal.aborted){setData(x);setError('');}
  }).catch(e=>{if(!ac.signal.aborted){setData(null);setError(e instanceof Error?e.message:'Falha na conciliação do dossiê.');}});
  return()=>ac.abort();
 },[tenantId,needId,revision,reload]);
 return <section className="enterprise-governance-panel" aria-label="Integridade financeira ponta a ponta da ordem de serviço">
  <div className="form-row"><h3>Prova ponta a ponta · medição → razão → banco</h3>
   <button type="button" className="secondary" onClick={()=>setReload(v=>v+1)}>Revalidar prova</button></div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {!data&&!error&&<p role="status">Auditando vínculos no PostgreSQL…</p>}
  {data&&<>
   <p role="status"><strong>{data.status==='EVIDENCE_COMPLETE'?'Documentos e lançamentos reconciliados':'Integração documental ainda incompleta'}</strong>.
    Atestado técnico de origem, não um GO operacional.</p>
   <div className="enterprise-governance-layout">
    <div><strong>{moneyScaled(data.summary.invoiceAmountScaled)}</strong><p>Valor faturado no razão</p></div>
    <div><strong>{moneyScaled(data.summary.settledScaled)}</strong><p>Baixas líquidas contabilizáveis</p></div>
    <div><strong>{moneyScaled(data.summary.outstandingScaled)}</strong><p>Saldo remanescente</p></div>
    <div><strong>{data.summary.bankMatchedReceipts}/{data.summary.activeReceipts}</strong><p>Recebimentos com extrato conciliado</p></div>
   </div>
   <ol>{data.steps.map(step=><li key={step.code}><strong>{step.done?'Comprovado':'Pendente'} · {step.label}</strong><p>{step.detail}</p></li>)}</ol>
   {data.summary.truncated&&<p role="alert">Consulta financeira limitada a 500 eventos; não é permitido certificar esta cadeia a partir de amostra parcial.</p>}
   <p>{data.caution}</p>
   <small>Fonte: {data.source} · Verificado em {data.checkedAt}</small>
  </>}
 </section>;
}
