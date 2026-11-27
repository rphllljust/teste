'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {CheckCircle2,ClipboardList,RotateCcw,Plus,ShieldCheck} from 'lucide-react';

type Item={code:string;label:string;module:string;active:boolean;canRecord:boolean;
 source:{id:string;reference:string;note:string;created_at:string}|null};
type History={id:string;command:'record'|'revoke';checkpoint:string;reference:string;
 note:string;createdAt:string;sequence:number};
type Data={orderId:string;revision:number;items:Item[];history:History[];
 pageInfo:{total:number;hasMore:boolean};warnings:string[]};
type Pending={mode:'record'|'revoke';checkpoint:string;label:string;
 targetId:string|null;revision:number;key:string};
/** Independent quality evidence ledger. Lifecycle and financial commands remain elsewhere. */
export default function ServiceOrderMilestonesPanel({orderId}:{orderId:string}){
 const [reload,setReload]=useState(0);
 const [snapshot,setSnapshot]=useState<{orderId:string;reload:number;data:Data|null;error:string}|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);
 const [reference,setReference]=useState(''),[note,setNote]=useState('');
 const [sending,setSending]=useState(false),[commandError,setCommandError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void(async()=>{
   try{
    const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/milestones',{
     credentials:'same-origin',cache:'no-store',signal:controller.signal});
    const data=await response.json() as Data&{error?:string};
    if(!response.ok)throw Error(data.error??'Marcos operacionais indisponíveis.');
    if(!controller.signal.aborted)setSnapshot({orderId,reload,data,error:''});
   }catch(e){if(!controller.signal.aborted)setSnapshot({
    orderId,reload,data:null,error:e instanceof Error?e.message:'Marcos indisponíveis.'
   });}
  })();
  return()=>controller.abort();
 },[orderId,reload]);
 const current=snapshot?.orderId===orderId&&snapshot.reload===reload?snapshot:null;
 const data=current?.data??null,loading=!current,error=current?.error??'';
 const begin=(item:Item,mode:'record'|'revoke')=>{
  setPending({mode,checkpoint:item.code,label:item.label,targetId:mode==='revoke'?item.source?.id??null:null,
   revision:data!.revision,key:crypto.randomUUID()});
  setNote('');setReference('');setCommandError('');
 };
 const cancel=()=>{if(!sending){setPending(null);setCommandError('');}};
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  if(sending||!pending)return;
  setSending(true);setCommandError('');
  try{
   const command=pending.mode==='record'
    ?{command:'record',key:pending.key,expectedRevision:pending.revision,
      checkpoint:pending.checkpoint,reference:reference.trim(),note:note.trim()}
    :{command:'revoke',key:pending.key,expectedRevision:pending.revision,
      targetId:pending.targetId,reason:note.trim()};
   const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/milestones',{
    method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
    body:JSON.stringify(command)});
   const value=await response.json() as {error?:string};
   if(!response.ok)throw Error(value.error??'Comando de marco recusado.');
   setPending(null);setReload(n=>n+1);
  }catch(e){setCommandError(e instanceof Error?e.message:'Comando indisponível.');}
  finally{setSending(false);}
 };
 const recorded=data?.items.filter(x=>x.active).length??0;
 return <section className="service-milestones" aria-label="Marcos operacionais auditáveis">
  <header className="service-milestones-header">
   <div><span className="eyebrow">EXECUÇÃO COM RASTREABILIDADE</span>
    <h4>Marcos documentais da OS</h4>
    <p>Registro interno versionado, com referência, justificativa e estorno imutável.</p></div>
   <span className="service-milestones-count"><ShieldCheck size={13}/>{data?recorded+'/'+data.items.length:'—'} vigentes</span>
  </header>
  {loading?<p className="service-milestones-message" role="status">Conferindo histórico da OS…</p>:
   error?<div role="alert" className="service-milestones-message">{error}
    <button type="button" onClick={()=>setReload(n=>n+1)}>Repetir</button></div>:
   data&&<>
    <div className="service-milestones-grid">
     {data.items.map(item=><article className={'service-milestone '+(item.active?'is-recorded':'')} key={item.code}>
      <div className="service-milestone-title">
       {item.active?<CheckCircle2 size={14}/>:<ClipboardList size={14}/>}
       <strong>{item.label}</strong></div>
      <small>{item.active?'Evidência registrada':'Sem marco vigente'}</small>
      {item.source&&<small title={item.source.note}>Referência: {item.source.reference}</small>}
      <div className="service-milestone-actions">
       {item.canRecord&&<button type="button" disabled={sending||!!pending}
        onClick={()=>begin(item,'record')}><Plus size={12}/> Registrar</button>}
       {item.active&&<button type="button" disabled={sending||!!pending}
        onClick={()=>begin(item,'revoke')}><RotateCcw size={12}/> Revogar</button>}
      </div>
     </article>)}
    </div>
    {pending&&<form className="service-milestones-form" onSubmit={event=>void submit(event)}>
     <h5>{pending.mode==='record'?'Registrar evidência':'Revogar evidência'} · {pending.label}</h5>
     <p>A justificativa ficará no histórico. Isto não altera o status da OS.</p>
     {pending.mode==='record'&&<label>Referência da evidência
      <input required minLength={3} maxLength={160} value={reference}
       placeholder="Relatório, checklist ou documento" disabled={sending}
       onChange={event=>setReference(event.target.value)}/></label>}
     <label>{pending.mode==='record'?'Descrição do registro':'Motivo da revogação'}
      <textarea required minLength={10} maxLength={1000} rows={3}
       value={note} disabled={sending} onChange={event=>setNote(event.target.value)}
       placeholder="Descreva o fato verificável e a referência documental"/></label>
     {commandError&&<p role="alert" className="form-error">{commandError}</p>}
     <div><button type="button" className="secondary" onClick={cancel} disabled={sending}>Cancelar</button>
      <button type="submit" className="primary" disabled={sending}>{sending?'Salvando…':'Confirmar registro'}</button></div>
    </form>}
    <details className="service-milestones-history">
     <summary>Histórico auditável · {data.pageInfo.total} evento(s)</summary>
     <ol>{data.history.map(ev=><li key={ev.id}>
      <span><strong>{ev.command==='record'?'Registro':'Revogação'}</strong> · {data.items.find(x=>x.code===ev.checkpoint)?.label??ev.checkpoint}
       <small>{ev.reference} · {ev.note}</small></span>
      <time>{new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(ev.createdAt))}</time>
     </li>)}</ol>
     {data.pageInfo.hasMore&&<p>Exibidos os 30 eventos mais recentes.</p>}
    </details>
    <p className="service-milestones-note">Marcos não substituem a comprovação externa de aceite nem autorizam conclusão, faturamento ou pagamento.</p>
   </>}
 </section>;
}
