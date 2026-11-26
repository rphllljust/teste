"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, HardHat, RefreshCw, Search, Truck, Plus, X, AlertTriangle } from "lucide-react";
import { EnterprisePageHeader, ErrorState, LoadingState, EmptyState } from "./components/enterprise/EnterprisePrimitives";

type Professional={id:string;name:string;registration:string;specialty:string;department:string;status:string};
type Asset={id:string;code:string;name:string;kind:string;location:string|null;status:string};
type Order={id:string;title:string;client:string;category:string;status:string;due_date:string|null};
type Allocation={id:string;orderId:string;resourceType:"professional"|"asset";resourceId:string;startsAt:string;endsAt:string;status:"active"|"released";rowVersion:number;orderTitle:string;orderClient:string;orderStatus:string;resourceName:string;resourceReference:string|null};
type Resources={id:string;type:"professional"|"asset";name:string;reference:string;detail:string;status:string};
type Props={onOpenOrder:(id:string)=>void;onNavigate:(module:string)=>void};
type Loadable={items?:Professional[]|Asset[];orders?:Order[];error?:string};
type AllocationResult={items:Allocation[];limited:boolean;source:string};
const DAY=86400000;
const allowedOrder=new Set(["planned","authorized","executing"]);
const labelByStatus:Record<string,string>={draft:"Rascunho",prepared:"Preparada",planned:"Planejada",authorized:"Autorizada",executing:"Em execução",completed:"Concluída",cancelled:"Cancelada"};
const monday=(date:Date)=>{
 const value=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
 value.setUTCDate(value.getUTCDate()-(value.getUTCDay()+6)%7);
 return value;
};
const isoDay=(date:Date)=>date.toISOString().slice(0,10);
const dayLabel=(date:Date)=>new Intl.DateTimeFormat("pt-BR",{weekday:"short",day:"2-digit",month:"short",timeZone:"UTC"}).format(date);
const scheduleLabel=(date:string)=>new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(date));
const localizedDateTime=(date:Date)=>{
 const pad=(n:number)=>String(n).padStart(2,"0");
 return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+"T"+pad(date.getHours())+":"+pad(date.getMinutes());
};

export default function ResourcePlanningBoard({onOpenOrder,onNavigate}:Props){
 const [people,setPeople]=useState<Professional[]>([]);
 const [assets,setAssets]=useState<Asset[]>([]);
 const [orders,setOrders]=useState<Order[]>([]);
 const [allocations,setAllocations]=useState<Allocation[]>([]);
 const [resourceQuery,setResourceQuery]=useState("");
 const [typeFilter,setTypeFilter]=useState<"all"|"professional"|"asset">("all");
 const [week,setWeek]=useState(()=>monday(new Date()));
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [limited,setLimited]=useState(false);
 const [creating,setCreating]=useState(false);
 const [resourceId,setResourceId]=useState("");
 const [orderId,setOrderId]=useState("");
 const [startTime,setStartTime]=useState(()=>localizedDateTime(new Date()));
 const [endTime,setEndTime]=useState(()=>localizedDateTime(new Date(Date.now()+60*60*1000)));
 const days=useMemo(()=>Array.from({length:7},(_,n)=>new Date(week.valueOf()+DAY*n)),[week]);
 const from=isoDay(week);
 const to=isoDay(new Date(week.valueOf()+DAY*7));
 const load=useCallback(async(signal?:AbortSignal)=>{
  setLoading(true);setError("");
  try{
   const range=new URLSearchParams({from,to,resourceType:"all",status:"active"});
   const responses=await Promise.all([
    fetch("/api/professionals?page=1&pageSize=50",{signal,credentials:"same-origin"}),
    fetch("/api/assets?page=1&pageSize=50",{signal,credentials:"same-origin"}),
    fetch("/api/orders?page=1&pageSize=50&sort=dueDate.asc&view=Todas%20as%20ordens",{signal,credentials:"same-origin"}),
    fetch("/api/resources/allocations?"+range,{signal,credentials:"same-origin"}),
   ]);
   const values=await Promise.all(responses.map(r=>r.json() as Promise<Loadable & AllocationResult>));
   const failed=responses.findIndex(response=>!response.ok);
   if(failed>=0)throw new Error(values[failed]?.error || "Não foi possível consultar o planejamento autorizado.");
   if(!signal?.aborted){
    setPeople(values[0].items as Professional[]??[]);
    setAssets(values[1].items as Asset[]??[]);
    setOrders(values[2].orders??[]);
    setAllocations(values[3].items as Allocation[]??[]);
    setLimited(Boolean(values[3].limited));
   }
  }catch(cause){if(!signal?.aborted)setError(cause instanceof Error?cause.message:"Planejamento indisponível.");}
  finally{if(!signal?.aborted)setLoading(false);}
 },[from,to]);
 useEffect(()=>{const abort=new AbortController();const timer=setTimeout(()=>void load(abort.signal),0);return()=>{clearTimeout(timer);abort.abort();};},[load]);
 const resources=useMemo<Resources[]>(()=>[
  ...people.map(p=>({id:p.id,type:"professional" as const,name:p.name,reference:p.registration,detail:p.specialty+" · "+p.department,status:p.status})),
  ...assets.map(a=>({id:a.id,type:"asset" as const,name:a.name,reference:a.code,detail:a.kind+(a.location?" · "+a.location:""),status:a.status})),
 ],[people,assets]);
 const visible=useMemo(()=>resources.filter(r=>(typeFilter==="all"||r.type===typeFilter)&&
   (r.name+" "+r.reference+" "+r.detail).toLocaleLowerCase("pt-BR").includes(resourceQuery.trim().toLocaleLowerCase("pt-BR"))),[resources,typeFilter,resourceQuery]);
 const openOrders=useMemo(()=>orders.filter(o=>allowedOrder.has(o.status.toLowerCase())),[orders]);
 const allocatedResources=new Set(allocations.map(a=>a.resourceType+":"+a.resourceId));
 const mapped=useMemo(()=>new Map<string,Allocation[]>(resources.map(r=>[
  r.type+":"+r.id,allocations.filter(a=>a.resourceType===r.type&&a.resourceId===r.id),
 ])),[resources,allocations]);
 const activeResources=resources.filter(r=>r.status==="active");
 const eligibleResources=activeResources.filter(r=>r.type+":"+r.id===resourceId);
 const selectedResource=eligibleResources[0];
 async function commit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(saving)return;
  setError("");setNotice("");
  if(!selectedResource||!openOrders.some(order=>order.id===orderId)){
   setError("Selecione um recurso ativo e uma OS em estado que permite alocação.");return;
  }
  const start=new Date(startTime),end=new Date(endTime);
  if(!Number.isFinite(start.valueOf())||!Number.isFinite(end.valueOf())||end<=start){
   setError("Informe uma janela de início e fim válida.");return;
  }
  setSaving(true);
  try{
   const r=await fetch("/api/resources/allocations",{method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({id:crypto.randomUUID(),orderId,resourceType:selectedResource.type,
     resourceId:selectedResource.id,startsAt:start.toISOString(),endsAt:end.toISOString()}),
   });
   const payload=await r.json() as {error?:string};
   if(!r.ok)throw new Error(payload.error || ("A alocação foi recusada (HTTP "+r.status+")."));
   setNotice("Recurso alocado e registrado no PostgreSQL. A agenda foi atualizada.");
   setCreating(false);
   await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível alocar o recurso.");}
  finally{setSaving(false);}
 }
 async function release(a:Allocation){
  if(saving||!window.confirm("Liberar esta alocação? A alteração ficará registrada no histórico empresarial."))return;
  setSaving(true);setError("");setNotice("");
  try{
   const r=await fetch("/api/resources/allocations/"+encodeURIComponent(a.id)+"/commands",{
    method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
    body:JSON.stringify({key:crypto.randomUUID(),version:a.rowVersion,command:"release"}),
   });
   const data=await r.json() as {error?:string};
   if(!r.ok)throw new Error(data.error || "Não foi possível liberar a alocação.");
   setNotice("Alocação liberada por comando autorizado. Agenda atualizada.");
   await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Comando indisponível.");}
  finally{setSaving(false);}
 }
 return <main className="erp-experience-page planning-board enterprise-scheduling-workspace" aria-label="Planejamento empresarial de recursos">
  <EnterprisePageHeader eyebrow="OPERAÇÕES · RECURSOS E CAPACIDADE" breadcrumb="Recursos e logística / Planejamento"
   title="Planejamento de recursos" description="Agenda semanal de alocações persistidas, recursos cadastrados e OS autorizadas. Alterações validadas no servidor."
   actions={<>
    <button type="button" className="secondary" onClick={()=>void load()} disabled={loading||saving}><RefreshCw size={16}/> Atualizar</button>
    <button type="button" className="primary" onClick={()=>{setCreating(true);setError("");}} disabled={loading||saving||activeResources.length===0||openOrders.length===0}>
      <Plus size={16}/> Nova alocação
    </button>
   </>}/>
  <div className="planning-ledger-note" role="note">
   <CalendarDays size={17}/><span>Alocações exibidas são registros reais do PostgreSQL. Um recurso sem agendamento não representa disponibilidade contratual confirmada.</span>
  </div>
  {!loading && (activeResources.length===0 || openOrders.length===0) && <section className="planning-preflight" role="note">
    <div><strong>{activeResources.length===0?"Cadastre capacidade antes de programar":"Cadastre ou autorize uma OS para alocar"}</strong>
      <p>{activeResources.length===0?"Não existem profissionais ou ativos ativos nesta consulta. As alocações só podem ser registradas para recursos autorizados.":"As alocações exigem uma OS planejada, autorizada ou em execução. Consulte a fila de ordens antes de programar."}</p>
    </div>
    <div className="planning-preflight-actions">
      {activeResources.length===0&&<>
        <button type="button" className="secondary" onClick={()=>onNavigate("Profissionais")}>Abrir profissionais</button>
        <button type="button" className="secondary" onClick={()=>onNavigate("Frota e ativos")}>Abrir frota e ativos</button>
      </>}
      {openOrders.length===0&&<button type="button" className="secondary" onClick={()=>onNavigate("Ordens de serviço")}>Abrir ordens de serviço</button>}
    </div>
  </section>}
  {error&&<ErrorState message={error} onRetry={()=>void load()}/>}
  {notice&&<p className="planning-notice" role="status">{notice}</p>}
  <section className="planning-summary" aria-label="Indicadores de capacidade cadastrada">
   <div><small>Recursos cadastrados consultados</small><strong>{resources.length}</strong><span>Profissionais e ativos</span></div>
   <div><small>Recursos ativos consultados</small><strong>{activeResources.length}</strong><span>Sem inferir turnos disponíveis</span></div>
   <div><small>Recursos com alocação nesta semana</small><strong>{allocatedResources.size}</strong><span>Vínculos persistidos</span></div>
   <div><small>Ordens elegíveis consultadas</small><strong>{openOrders.length}</strong><span>Estados permitidos pelo backend</span></div>
  </section>
  <section className="planning-calendar-panel" aria-label="Agenda semanal de alocações">
   <header className="planning-calendar-head">
    <div><span className="eyebrow">AGENDA / ALOCAÇÃO PERSISTIDA</span><h2>Programação semanal</h2>
     <p>{dayLabel(days[0])} a {dayLabel(days[6])} · visão da organização autenticada</p></div>
    <div className="planning-week-actions">
     <button type="button" className="secondary" onClick={()=>setWeek(w=>new Date(w.valueOf()-DAY*7))} aria-label="Semana anterior"><ChevronLeft size={17}/></button>
     <button type="button" className="secondary" onClick={()=>setWeek(monday(new Date()))}>Semana atual</button>
     <button type="button" className="secondary" onClick={()=>setWeek(w=>new Date(w.valueOf()+DAY*7))} aria-label="Próxima semana"><ChevronRight size={17}/></button>
    </div>
   </header>
   <div className="planning-filters">
    <label><Search size={16}/><input value={resourceQuery} onChange={event=>setResourceQuery(event.target.value)}
      aria-label="Buscar recurso na agenda" placeholder="Profissional, ativo, registro ou especialidade"/></label>
    <select value={typeFilter} onChange={event=>setTypeFilter(event.target.value as typeof typeFilter)} aria-label="Tipo de recurso na agenda">
     <option value="all">Todos os recursos</option><option value="professional">Profissionais</option><option value="asset">Frota e ativos</option>
    </select>
    <span role="status">{visible.length} recurso(s)</span>
   </div>
   {limited&&<p className="planning-limited" role="alert"><AlertTriangle size={16}/> Mais de 500 alocações nesta janela. Refine a semana; não é seguro tratar esta visão como completa.</p>}
   {loading?<LoadingState label="Lendo alocações e recursos reais…"/>:visible.length===0?<EmptyState
     title="Nenhum recurso encontrado" description="Cadastre profissionais ou ativos no contexto autenticado para habilitar alocações. A agenda não cria capacidade fictícia."/>:
    <div className="planning-timeline-scroll" role="region" tabIndex={0} aria-label="Grade semanal por recurso">
     <div className="planning-timeline" role="table" aria-label="Agenda de alocações confirmadas">
      <div role="row" className="planning-timeline-row planning-timeline-header">
       <div role="columnheader" className="planning-resource-head">Recurso / Situação</div>
       {days.map(d=><div role="columnheader" key={isoDay(d)}>{dayLabel(d)}</div>)}
      </div>
      {visible.map(resource=><div role="row" key={resource.type+":"+resource.id} className="planning-timeline-row">
       <div role="rowheader" className="planning-resource-title">
        {resource.type==="professional"?<HardHat size={16}/>:<Truck size={16}/>}
        <div><strong>{resource.name}</strong><small>{resource.reference} · {resource.status==="active"?"Ativo":resource.status==="maintenance"?"Em manutenção":"Inativo"}</small>
        <small>{resource.detail}</small></div>
       </div>
       {days.map(d=>{
        const start=d.valueOf(),end=start+DAY;
        const matched=(mapped.get(resource.type+":"+resource.id)??[]).filter(a=>Date.parse(a.startsAt)<end&&Date.parse(a.endsAt)>start);
        return <div role="cell" className="planning-day-cell" key={isoDay(d)}>
         {matched.map(a=><button type="button" key={a.id} className="planning-booking"
           title={a.orderTitle+" · "+scheduleLabel(a.startsAt)+" a "+scheduleLabel(a.endsAt)}
           aria-label={"Abrir OS "+a.orderTitle+" alocada ao recurso "+resource.name}
           onClick={()=>onOpenOrder(a.orderId)}>
           <span>{a.orderTitle}</span><small>{new Date(a.startsAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</small>
          </button>)}
        </div>;
       })}
      </div>)}
     </div>
    </div>}
  </section>
  <section className="planning-transactions-grid" aria-label="Comandos e alocações da agenda">
   <div className="planning-transactions-panel">
    <header><h2>Alocações confirmadas na semana</h2><small>{allocations.length} registro(s) · fonte PostgreSQL</small></header>
    {allocations.length===0?<EmptyState title="Sem alocações registradas nesta semana" description="Selecione Nova alocação para vincular um recurso ativo a uma OS elegível."/>:
    <div className="planning-allocations-list">{allocations.map(a=><div className="planning-allocation-item" key={a.id}>
      <div><strong>{a.resourceName}</strong><small>{a.orderTitle} · {scheduleLabel(a.startsAt)} — {scheduleLabel(a.endsAt)}</small></div>
      <div className="planning-allocation-actions">
       <button type="button" className="secondary" onClick={()=>onOpenOrder(a.orderId)}>Abrir OS</button>
       <button type="button" className="secondary" disabled={saving} onClick={()=>void release(a)}>Liberar</button>
      </div>
     </div>)}</div>}
   </div>
   <aside className="planning-transactions-panel" aria-label="Ordens que podem receber alocação">
    <header><h2>Ordens elegíveis à alocação</h2><small>{openOrders.length} OS consultadas</small></header>
    {openOrders.length?openOrders.slice(0,10).map(order=><button type="button" className="planning-order-card" key={order.id} onClick={()=>onOpenOrder(order.id)}>
      <span><strong>{order.title}</strong><small>{order.client}</small></span>
      <span><small>{labelByStatus[order.status.toLowerCase()]??order.status}</small></span>
     </button>):<EmptyState title="Nenhuma OS elegível" description="Apenas OS planejadas, autorizadas ou em execução admitem alocação."/>}
   </aside>
  </section>
  {creating&&<div className="overlay planning-modal-overlay" onClick={()=>setCreating(false)}>
   <section role="dialog" aria-modal="true" aria-label="Nova alocação de recurso" className="planning-allocation-dialog" onClick={event=>event.stopPropagation()}>
    <header><h2>Registrar alocação de recurso</h2><button className="icon-button" type="button" onClick={()=>setCreating(false)} aria-label="Fechar formulário"><X size={20}/></button></header>
    <p>O PostgreSQL valida identidade, estado da OS, disponibilidade cadastral e sobreposição. Conflitos retornam HTTP 409, sem criar reserva.</p>
    <form onSubmit={event=>void commit(event)}>
     <label>Recurso ativo<select required value={resourceId} onChange={event=>setResourceId(event.target.value)}>
       <option value="">Selecione</option>{activeResources.map(r=><option key={r.type+":"+r.id} value={r.type+":"+r.id}>{r.name} · {r.type==="professional"?"Profissional":"Ativo"} · {r.reference}</option>)}
      </select></label>
     <label>OS com transição autorizada<select required value={orderId} onChange={event=>setOrderId(event.target.value)}>
       <option value="">Selecione a OS</option>{openOrders.map(o=><option key={o.id} value={o.id}>{o.title} · {o.client}</option>)}
      </select></label>
     <div className="planning-time-fields">
      <label>Início<input required type="datetime-local" value={startTime} onChange={event=>setStartTime(event.target.value)}/></label>
      <label>Fim<input required type="datetime-local" min={startTime} value={endTime} onChange={event=>setEndTime(event.target.value)}/></label>
     </div>
     <div className="planning-dialog-actions"><button type="button" className="secondary" onClick={()=>setCreating(false)}>Cancelar</button>
      <button type="submit" className="primary" disabled={saving}>{saving?"Registrando…":"Confirmar alocação"}</button></div>
    </form>
   </section>
  </div>}
 </main>;
}
