'use client';
import {useEffect,useState} from 'react';
import {Clock3,RefreshCw,ShieldCheck,TriangleAlert} from 'lucide-react';
type Event={id:string;source:'order'|'measurement';command:string;version:number;
 createdAt:string;actorId:string|null;targetId:string|null;correlationId:string|null};
type Cursor={cursorAt:string;cursorSource:'order'|'measurement';cursorId:string};
type Payload={orderId:string;source:string;items:Event[];pageInfo:{hasMore:boolean;nextCursor:Cursor|null}};
const labels:Record<string,string>={
 create:'OS criada',authorize:'OS autorizada',start:'Execução iniciada',complete:'OS concluída',
 cancel:'OS cancelada',measure:'Medição registrada',approve_measurement:'Medição aprovada',
 invoice:'Fatura vinculada',submit:'Medição submetida',
};
const fmt=(value:string)=>{
 const d=new Date(value);
 return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d);
};
/** Paginated, read-only audit. Does not execute business actions. */
export default function EnterpriseOrderAuditTimeline({orderId,revision}:{orderId:string;revision:number}){
 const [open,setOpen]=useState(false);
 const [items,setItems]=useState<Event[]>([]);
 const [cursor,setCursor]=useState<Cursor|null>(null);
 const [more,setMore]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [generation,setGeneration]=useState(0);
 useEffect(()=>{setOpen(false);setItems([]);setCursor(null);setMore(false);setError('');setGeneration(v=>v+1);},[orderId,revision]);
 useEffect(()=>{
  if(!open)return;
  const abort=new AbortController();
  const timer=window.setTimeout(async()=>{
   setBusy(true);setError('');
   try{
    const params=new URLSearchParams({pageSize:'10'});
    if(cursor){params.set('cursorAt',cursor.cursorAt);params.set('cursorId',cursor.cursorId);params.set('cursorSource',cursor.cursorSource);}
    const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/audit?'+params,{
     cache:'no-store',credentials:'same-origin',signal:abort.signal,
    });
    if(!response.ok)throw Error('Auditoria indisponível (HTTP '+response.status+').');
    const data=await response.json() as Payload;
    if(data.orderId!==orderId||data.source!=='postgres_owned_event_trace'||!Array.isArray(data.items))
     throw Error('Origem da auditoria não validada.');
    if(abort.signal.aborted)return;
    setItems(previous=>cursor?[...previous,...data.items.filter(row=>!previous.some(old=>old.id===row.id&&old.source===row.source))]:data.items);
    setMore(data.pageInfo.hasMore);setCursor(data.pageInfo.nextCursor);
   }catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'Auditoria indisponível.');}
   finally{if(!abort.signal.aborted)setBusy(false);}
  },0);
  return()=>{window.clearTimeout(timer);abort.abort();};
 },[orderId,open,generation]);
 return <section className="cisne-order-audit" aria-label="Rastreabilidade e correlação">
  <header className="cisne-integrated-heading">
   <strong><Clock3 size={15}/> Trilha de auditoria</strong>
   <button type="button" onClick={()=>{if(open){setItems([]);setCursor(null);setMore(false);}setOpen(v=>!v);}}>
    {open?'Recolher':'Consultar eventos'}
   </button>
  </header>
  {open&&<>
   <p className="cisne-integrated-summary"><ShieldCheck size={13}/> Eventos persistidos e vinculados à OS.</p>
   {busy&&!items.length&&<p role="status">Consultando eventos auditáveis…</p>}
   {error&&<p role="alert" className="cisne-integrated-error"><TriangleAlert size={14}/>{error}</p>}
   <ol>{items.map(event=><li key={event.source+event.id}>
    <strong>{labels[event.command]??event.command}</strong>
    <small>{fmt(event.createdAt)} · Versão {event.version} · {event.source==='measurement'?'Medição':'OS'}</small>
    <small>Responsável: {event.actorId??'Não registrado'}</small>
    <small>Documento: {event.targetId??'Não registrado'}</small>
    <small>Correlação: {event.correlationId??'Não registrada'}</small>
   </li>)}</ol>
   {!busy&&!items.length&&!error&&<p>Não há eventos registrados nesta trilha.</p>}
   {more&&<button type="button" disabled={busy} onClick={()=>{if(cursor)setGeneration(v=>v+1);}}><RefreshCw size={14}/>{busy?'Consultando…':'Carregar eventos anteriores'}</button>}
  </>}
 </section>;
}
