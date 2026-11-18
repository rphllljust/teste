'use client';

import {useEffect,useState} from 'react';
import {ArrowRight,CalendarClock} from 'lucide-react';

type Appointment={
  orderId:string;title:string;client:string;status:string;
  startsAt:string;endsAt:string;location:string;assignedCount:number;
};
const fmt=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));

/** Actual persisted appointment windows, not order due dates. */
export default function FieldScheduleAgenda({onSelect,refreshVersion=0}:{onSelect:(id:string)=>void;refreshVersion?:number}){
  const [items,setItems]=useState<Appointment[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try{
        const r=await fetch('/api/schedules',{signal:controller.signal,cache:'no-store'});
        const data=await r.json() as {items?:Appointment[];error?:string};
        if(!r.ok)throw new Error(data.error||'Agenda indisponível.');
        if(!controller.signal.aborted){setItems(data.items??[]);setError('');}
      }catch(e){
        if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Agenda indisponível.');
      }finally{if(!controller.signal.aborted)setLoading(false);}
    },0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[refreshVersion]);
  const valid=items.filter(a=>!['completed','cancelled'].includes(a.status)).slice(0,5);
  return <section className="service-agenda" aria-label="Agendamentos reais das ordens">
    <div className="agenda-heading"><div><span className="section-label">PLANEJAMENTO PERSISTIDO</span>
      <h3>Agendamentos operacionais</h3>
      <p>Janelas registradas no PostgreSQL, separadas dos prazos previstos das ordens.</p>
    </div></div>
    {loading?<p className="queue-empty" role="status">Consultando agenda…</p>:
      error?<p role="alert" className="queue-empty">{error}</p>:
      valid.length?<div className="agenda-list">{valid.map(a=>
        <button key={a.orderId} className="agenda-item" onClick={()=>onSelect(a.orderId)}>
          <time dateTime={a.startsAt}>{fmt(a.startsAt)}</time>
          <span><strong>{a.title}</strong>
            <small>{a.client} · {a.location} · {a.assignedCount} profissional(is)</small>
            <small>Até {fmt(a.endsAt)}</small></span>
          <ArrowRight size={15}/>
        </button>)}</div>:
      <div className="agenda-empty"><CalendarClock size={17}/>
        <span>Nenhum agendamento ativo neste contexto.</span></div>}
  </section>;
}
