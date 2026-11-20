'use client';
import {useEffect,useState} from 'react';
import {AlertTriangle,ArrowRight,RefreshCw,ShieldCheck} from 'lucide-react';
import {EnterpriseButton} from './components/enterprise/EnterprisePrimitives';
import {moneyScaled} from '../lib/domain/orders';

type RecordItem={id:string;title:string;reference:string|null;date:string|null;
 amountScaled:string|null;availableScaled:string|null;requiredScaled:string|null};
type Lane={id:string;label:string;target:string;count:number;authority:string;
 totalAmountScaled:string|null;items:RecordItem[]};
type Projection={generatedAt:string;asOf:string;sampleLimitPerLane:number;
 lanes:Lane[];error?:string};

export default function EnterpriseControlTower({onNavigate}:{onNavigate:(name:string)=>void}){
 const [asOf,setAsOf]=useState(()=>new Date().toISOString().slice(0,10));
 const [revision,refresh]=useState(0),[loading,setLoading]=useState(true);
 const [data,setData]=useState<Projection|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setError('');
  void fetch('/api/enterprise/control-tower?'+new URLSearchParams({asOf}),
    {signal:controller.signal,cache:'no-store'})
    .then(async response=>{
      const body=await response.json() as Projection;
      if(!response.ok)throw new Error(body.error||'Controles indisponíveis.');
      if(!Array.isArray(body.lanes))throw new Error('Resposta de controle inválida.');
      if(!controller.signal.aborted)setData(body);
    })
    .catch(err=>{if(!controller.signal.aborted){
      setData(null);setError(err instanceof Error?err.message:'Consulta indisponível.');
    }})
    .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[asOf,revision]);
 const active=data?.lanes.filter(lane=>lane.count>0)??[];
 return <section className="erp-control-tower" aria-label="Torre de controle empresarial">
   <header className="erp-control-head">
    <div><span className="eyebrow">DADOS PERSISTIDOS · CONTROLE EMPRESARIAL</span>
     <h2>Exceções que exigem ação</h2>
     <p>Ordens, medições, financeiro, compras, estoque e aprovações do proprietário autenticado.</p>
    </div>
    <div className="erp-control-actions"><label>Referência
       <input type="date" aria-label="Data de referência da torre de controle"
        value={asOf} onChange={e=>setAsOf(e.target.value)}/>
     </label><EnterpriseButton type="button" className="secondary" disabled={loading}
       onClick={()=>refresh(v=>v+1)}><RefreshCw size={15}/>Atualizar</EnterpriseButton></div>
   </header>
   {error?<div className="erp-control-feedback" role="alert"><AlertTriangle size={18}/>
      {error}<EnterpriseButton type="button" onClick={()=>refresh(v=>v+1)}>Tentar novamente</EnterpriseButton></div>:
    loading?<p className="erp-control-feedback" role="status">Consultando registros autorizados…</p>:
    data?<div>
     <div className="erp-control-cards" aria-label="Indicadores de exceção">
      {data.lanes.map(lane=><EnterpriseButton type="button" key={lane.id}
         className="erp-control-metric" onClick={()=>onNavigate(lane.target)}
         aria-label={lane.label+': '+lane.count}>
         <span>{lane.label}</span><strong>{new Intl.NumberFormat('pt-BR').format(lane.count)}</strong>
         <small>{lane.totalAmountScaled===null?
          (lane.count?'Ver pendências':'Sem pendências'):
           moneyScaled(lane.totalAmountScaled)+' em aberto'}</small>
       </EnterpriseButton>)}
     </div>
     <div className="erp-control-queues">
      <header><h3>Fila de exceções</h3><small>{active.length} frentes com pendências</small></header>
      {active.length===0?<p className="erp-control-feedback"><ShieldCheck size={18}/>
        Nenhuma exceção nos controles monitorados para a data selecionada.</p>:
       active.map(lane=><section key={lane.id} className="erp-control-lane" aria-label={lane.label}>
        <header><div><h4>{lane.label}</h4>
          <small>{lane.count} registros · exibindo até {data.sampleLimitPerLane}</small></div>
          <EnterpriseButton type="button" className="secondary"
            onClick={()=>onNavigate(lane.target)}>Abrir {lane.target}<ArrowRight size={14}/></EnterpriseButton>
        </header>
        <ul>{lane.items.map(item=><li key={item.id}><div><strong>{item.title}</strong>
          <small>{[item.reference,item.date?.slice(0,10)].filter(Boolean).join(' · ')||'Registro persistido'}</small></div>
          {item.amountScaled!==null?<strong className="erp-control-amount">{moneyScaled(item.amountScaled)}</strong>:null}
          {item.availableScaled!==null&&item.requiredScaled!==null?
             <small>Disponível: {Number(item.availableScaled)/1000} · mínimo: {Number(item.requiredScaled)/1000}</small>:null}
         </li>)}</ul>
       </section>)}
     </div>
     <footer className="erp-control-foot">
      <span>Atualizado {new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(data.generatedAt))}</span>
      <span>Recebíveis e obrigações não são saldo disponível de caixa.</span>
     </footer>
    </div>:null}
  </section>;
}
