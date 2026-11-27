'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,FileText,Link2,RefreshCcw,ShieldAlert} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';
type Evidence={id:string;reference:string;state:string;createdAt:string|null;amountScaled?:string};
type Stage={key:string;title:string;state:'linked'|'pending'|'exception';module:string;items:Evidence[];truncated:boolean};
type Warning={code:string;severity:'info'|'warning';message:string};
type Dossier={order:{id:string;reference:string;supplier:string;status:string};
 financials:{orderScaled:string;invoiceScaled:string;payableScaled:string;paidScaled:string;
 outstandingScaled:string;attributedCostScaled:string;unattributedCostScaled:string};
 stages:Stage[];alerts:Warning[];payableId:string|null;documentNumber:string|null;
 checks:{lineCount:number;unreceivedCount:number;inventoryMismatchCount:number;
 paymentCount:number;accrualVerified:boolean;bankMatches:number;attributionRows:number};
 provenance:{readOnly:true;actorScoped:true;constraints:string[]};generatedAt:string;error?:string};
const money=(v:string)=>v.startsWith('-')?'−'+moneyScaled(v.slice(1)):moneyScaled(v);
const stateText={linked:'Vinculado',pending:'Pendente',exception:'Conferir'} as const;
export default function ProcureToPayDossierBoard({orderId,revision,onOpenPayable,onNavigate}:{
 orderId:string;revision:number;onOpenPayable:(id:string)=>void;onNavigate:(module:string)=>void;
}){
 const [data,setData]=useState<Dossier|null>(null),[loading,setLoading]=useState(true),
 [error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  const task=Promise.resolve().then(async()=>{
   setLoading(true);setError('');setData(null);
   try{
    const r=await fetch('/api/enterprise/procure-to-pay/'+encodeURIComponent(orderId),
     {signal:controller.signal,cache:'no-store',credentials:'same-origin'});
    const d=await r.json() as Dossier;
    if(!r.ok||!d.stages)throw Error(d.error??'Rastreabilidade indisponível.');
    if(!controller.signal.aborted)setData(d);
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Rastreabilidade indisponível.');}
   finally{if(!controller.signal.aborted)setLoading(false);}
  });
  return()=>{controller.abort();void task;};
 },[orderId,revision,refresh]);
 return <section className="procure-dossier" aria-busy={loading} aria-label="Cadeia de suprimentos à contabilidade">
   <header className="procure-dossier-heading">
    <div><span className="eyebrow">RASTREABILIDADE ENTRE MÓDULOS</span>
     <h3><Link2 size={17}/> Compras → Estoque → Contas a pagar → Contabilidade</h3>
     <p>Somente vínculos documentais persistidos; ausência de escrituração ou conciliação é apresentada explicitamente.</p></div>
    <button type="button" className="secondary" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>
     <RefreshCcw size={14}/> Atualizar</button>
   </header>
   {loading?<p className="procure-dossier-loading" role="status">Conferindo documentos e lançamentos...</p>:
   error?<p role="alert" className="form-error">{error}</p>:data&&<>
    <div className="procure-dossier-facts" aria-label="Valores documentados">
     <div><span>Pedido aprovado</span><strong>{money(data.financials.orderScaled)}</strong></div>
     <div><span>Obrigação vinculada</span><strong>{data.payableId?money(data.financials.payableScaled):'Sem título'}</strong></div>
     <div><span>Pagamentos líquidos</span><strong>{data.payableId?money(data.financials.paidScaled):'Sem título'}</strong></div>
     <div><span>Saldo a pagar</span><strong>{data.payableId?money(data.financials.outstandingScaled):'Não apurado'}</strong></div>
    </div>
    {data.alerts.length>0&&<div className="procure-dossier-alerts" role="status">
     <strong><ShieldAlert size={15}/> {data.alerts.length} ocorrência(s) para conferir</strong>
     <ul>{data.alerts.map(x=><li key={x.code}><code>{x.code}</code> {x.message}</li>)}</ul>
    </div>}
    <div className="procure-dossier-stages">
     {data.stages.map(stage=><section key={stage.key} className="procure-dossier-stage">
      <header><span className={'procure-dossier-status '+stage.state}>{stateText[stage.state]}</span>
       <strong>{stage.title}</strong><small>{stage.items.length}{stage.truncated?'+':''} documento(s)</small></header>
      {stage.items.length?stage.items.slice(0,4).map(item=><div className="procure-dossier-evidence" key={item.id}>
       <FileText size={13}/><span title={item.reference}>{item.reference}
        <small>{item.state}{item.amountScaled!=null?' · '+money(item.amountScaled):''}</small></span></div>):
       <p className="procure-dossier-missing">Nenhuma evidência verificada</p>}
      {stage.truncated&&<small>Há mais documentos; abra o módulo de origem.</small>}
      {stage.key==='payable'&&data.payableId?
       <button className="procure-dossier-link" type="button"
        onClick={()=>onOpenPayable(data.payableId!)}>Abrir obrigação <ArrowRight size={12}/></button>:
       stage.state!=='pending'&&stage.module!=='Compras'&&
       <button className="procure-dossier-link" type="button" onClick={()=>
        onNavigate(stage.module==='Controladoria'?'Visão financeira':stage.module)}>
        Abrir {stage.module} <ArrowRight size={12}/></button>}
     </section>)}
    </div>
    <details className="finance-source-disclosure procure-dossier-provenance">
     <summary>Escopo de dados, limites e origem documental</summary>
     {data.provenance.constraints.map(x=><p key={x}>{x}</p>)}
     <p>Dados isolados por proprietário · leitura somente · atualização {new Date(data.generatedAt).toLocaleString('pt-BR')}.</p>
    </details>
   </>}
 </section>;
}
