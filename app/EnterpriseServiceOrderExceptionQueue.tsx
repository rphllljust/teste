'use client';
import {useEffect,useState} from 'react';
import {AlertTriangle,ArrowRight,CalendarClock,ClipboardCheck,RefreshCw,ShieldAlert} from 'lucide-react';

type ExceptionRow={id:string;title:string;client:string;status:string;dueDate:string|null;
 overdue:boolean;unmeasured:boolean;planOverdue:boolean;planBlocked:boolean;attentionRank:number;
 evidence:{measurements:number;invoices:number;executions:number}};
type ResponseData={items:ExceptionRow[];summary:{total:number;draft:number;executing:number;overdue:number;unmeasured:number;authorized:number;planOverdue:number;planBlocked:number};
 pageInfo:{total:number;hasMore:boolean};generatedAt:string;
 source:'postgres_owner_scoped_operations';note:string};
const date=(raw:string|null)=>{
 if(!raw)return 'Sem prazo';
 const value=new Date(raw+'T12:00:00Z');
 return isNaN(value.getTime())?'Data indisponível':new Intl.DateTimeFormat('pt-BR',
  {timeZone:'UTC',day:'2-digit',month:'short'}).format(value);
};
const situation=(item:ExceptionRow)=>item.overdue?'Prazo vencido':
 item.unmeasured?'Medição pendente':item.planOverdue?'Atividade vencida':
 item.planBlocked?'Atividade bloqueada':
 ['draft','prepared'].includes(item.status)?'Rascunho para preparação':'Revisar próxima etapa';

/**
 * A real owner-scoped operational exception rail.
 * Summary is global; rows are only first six priority-ranked exceptions.
 * No fabricated percentages, maturity scores, settlement or automated commands.
 */
export default function EnterpriseServiceOrderExceptionQueue({sourceVersion,onOpenOrder,onOpenControlTower}:{
 sourceVersion?:string;onOpenOrder:(id:string)=>void;onOpenControlTower:()=>void;
}){
 const [data,setData]=useState<ResponseData|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  const run=async()=>{
   try{
    const res=await fetch('/api/enterprise/operations?'+new URLSearchParams({
     queue:'attention',sort:'priority',page:'1',pageSize:'3'}),{
      credentials:'same-origin',cache:'no-store',signal:controller.signal});
    const body=await res.json() as ResponseData&{error?:string};
    if(!res.ok||body.source!=='postgres_owner_scoped_operations')
     throw Error(body.error??'Fila de exceções indisponível.');
    if(!controller.signal.aborted){setData(body);setError('');}
   }catch(e){
    if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Fila indisponível.');setData(null);}
   }finally{if(!controller.signal.aborted)setLoading(false);}
  };
  void run();
  return()=>controller.abort();
 },[sourceVersion,refresh]);
 const indicators=data?[
  {name:'Em atraso',value:data.summary.overdue,icon:CalendarClock},
  {name:'Medição pendente',value:data.summary.unmeasured,icon:ClipboardCheck},
  {name:'Plano em atraso',value:data.summary.planOverdue,icon:CalendarClock},
  {name:'Plano bloqueado',value:data.summary.planBlocked,icon:ShieldAlert},
  {name:'Preparação',value:data.summary.draft,icon:ShieldAlert},
 ]:[];
 return <section className="os-tier1-exceptions" aria-label="Exceções operacionais da ordem de serviço">
  <div className="os-tier1-exceptions-heading">
   <div><span className="eyebrow">TORRE DE CONTROLE · OS</span><h2>Prioridades e riscos operacionais</h2>
    <p>Indicadores globais da empresa, não apenas da página atual.</p></div>
   <div className="os-tier1-exceptions-actions">
    <button type="button" className="icon-button" disabled={loading} onClick={()=>{setLoading(true);setRefresh(n=>n+1);}}
     aria-label="Atualizar riscos operacionais"><RefreshCw size={15}/></button>
    <button type="button" className="secondary" onClick={onOpenControlTower}>
     Abrir central <ArrowRight size={13}/></button>
   </div>
  </div>
  {loading&&!data&&!error&&<p className="os-tier1-exceptions-state" role="status">Conferindo pendências persistidas…</p>}
  {error&&<div role="alert" className="os-tier1-exceptions-state"><AlertTriangle size={14}/> {error} <button type="button" onClick={()=>{setLoading(true);setRefresh(n=>n+1);}}>Repetir</button></div>}
  {data&&<>
   <div className="os-tier1-exceptions-stats">
    {indicators.map(k=><div key={k.name}><k.icon size={14} aria-hidden="true"/><span>{k.name}</span>
     <strong tabIndex={0} aria-label={k.name+': '+k.value}>{k.value}</strong></div>)}
   </div>
   {data.pageInfo.total>0?
    <div className="os-tier1-exceptions-worklist" aria-label="Três primeiras exceções priorizadas">
     {data.items.map(item=><button type="button" key={item.id} onClick={()=>onOpenOrder(item.id)}
       title={'Abrir ordem '+item.title}>
       <span><strong>{item.title}</strong><small>{item.client} · {date(item.dueDate)}</small></span>
       <span className={'os-tier1-exception-kind'+(item.overdue?' is-overdue':'')}>
        {situation(item)} <ArrowRight size={12}/></span>
      </button>)}
    </div>:<p className="os-tier1-exceptions-clear">Nenhuma exceção classificada pelas regras atuais. Isso não substitui homologação operacional.</p>}
   {data.pageInfo.hasMore&&<p className="os-tier1-exceptions-more">Exibindo três de {data.pageInfo.total} registros; abra a central para consultar os demais.</p>}
  </>}
 </section>;
}
