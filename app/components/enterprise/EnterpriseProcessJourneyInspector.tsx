'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,ChevronRight,GitBranch,RefreshCw,ShieldCheck,TriangleAlert} from 'lucide-react';

type Evidence={id:string;reference:string;state:string;createdAt:string|null;module:string};
type Stage={key:string;title:string;module:string;state:'linked'|'not_linked';items:Evidence[];truncated:boolean};
type Dossier={
 order:{id:string;title:string;status:string;version:number};
 stages:Stage[];alerts:Array<{code:string;severity:string;message:string}>;
 provenance:{ownerScoped:boolean;consistency:string;source:string;warning:string};
};
const fmt=(raw:string|null)=>{
 if(!raw)return 'Sem data';
 const d=new Date(raw.length===10?raw+'T12:00:00Z':raw);
 return Number.isNaN(d.getTime())?raw:new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:'UTC'}).format(d);
};
/** A linked stage is evidence, never automatic approval. */
export default function EnterpriseProcessJourneyInspector({orderId,revision,navigate,onOpenOrder,onDossier}:{
 orderId:string;revision:number;navigate:(name:string,orderId?:string)=>void;onOpenOrder:(id:string)=>void;onDossier:(id:string)=>void;
}){
 const [dossier,setDossier]=useState<Dossier|null>(null);
 const [selectedStage,setSelectedStage]=useState('order');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const abort=new AbortController();
  const timer=window.setTimeout(async()=>{
   setLoading(true);setError('');setDossier(null);setSelectedStage('order');
   try{
    const response=await fetch('/api/enterprise/journeys/'+encodeURIComponent(orderId),{
     cache:'no-store',credentials:'same-origin',signal:abort.signal,
    });
    if(!response.ok)throw Error('Jornada autorizada indisponível (HTTP '+response.status+').');
    const result=await response.json() as Dossier;
    if(result.order?.id!==orderId||result.provenance?.ownerScoped!==true||
       result.provenance?.consistency!=='repeatable_read'||!Array.isArray(result.stages))
     throw Error('Não foi possível comprovar a autorização e consistência da jornada.');
    if(!abort.signal.aborted)setDossier(result);
   }catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'Consulta indisponível.');}
   finally{if(!abort.signal.aborted)setLoading(false);}
  },0);
  return()=>{window.clearTimeout(timer);abort.abort();};
 },[orderId,revision,refresh]);
 const stage=dossier?.stages.find(item=>item.key===selectedStage);
 const linked=dossier?.stages.filter(item=>item.state==='linked').length??0;
 return <section className="cisne-integrated-journey" aria-label="Jornada empresarial vinculada">
  <header className="cisne-integrated-heading">
   <strong><GitBranch size={15}/> Jornada integrada</strong>
   <button type="button" onClick={()=>setRefresh(v=>v+1)} disabled={loading} aria-label="Atualizar vínculos da jornada"><RefreshCw size={14}/></button>
  </header>
  {loading&&<p role="status">Reconstituindo cadeia documental autorizada…</p>}
  {error&&<p role="alert" className="cisne-integrated-error"><TriangleAlert size={14}/>{error}</p>}
  {dossier&&<>
   <p className="cisne-integrated-summary"><ShieldCheck size={13}/> {linked} de {dossier.stages.length} etapas com vínculos persistidos. Não representam conclusão de etapas.</p>
   <div className="cisne-integrated-rail" role="group" aria-label="Etapas transacionais verificadas">
    {dossier.stages.map((item,i)=><button type="button" key={item.key}
      className={item.state==='linked'?'linked':'unlinked'} aria-pressed={selectedStage===item.key}
      onClick={()=>setSelectedStage(item.key)} title={item.title}>
      <span>{String(i+1).padStart(2,'0')}</span>{item.state==='linked'?<CheckCircle2 size={13}/>:<span aria-hidden="true">·</span>}
      <strong>{item.title}</strong>
    </button>)}
   </div>
   {stage&&<div className="cisne-integrated-stage" aria-live="polite">
    <div><strong>{stage.title}</strong><span>{stage.items.length} vínculo(s) exibido(s)</span></div>
    {stage.items.length?<ul>{stage.items.slice(0,5).map(item=><li key={item.id}>
      <span><strong>{item.reference}</strong><small>{item.state} · {fmt(item.createdAt)}</small></span>
      <ChevronRight size={13}/>
    </li>)}</ul>:<p>Nenhum documento confirmado nesta etapa no escopo autorizado.</p>}
    {stage.truncated&&<p>Existem mais documentos; consulte o dossiê integral.</p>}
    <div className="cisne-integrated-stage-actions">
     {stage.key==='order'?
      <button type="button" onClick={()=>onOpenOrder(orderId)}>Abrir OS <ArrowRight size={13}/></button>:
      <button type="button" onClick={()=>navigate(stage.module,['Execução','Medições','Faturamento','Financeiro'].includes(stage.module)?orderId:undefined)}>Abrir {stage.module} <ArrowRight size={13}/></button>}
     <button type="button" onClick={()=>onDossier(orderId)}>Dossiê desta OS <ArrowRight size={13}/></button>
    </div>
   </div>}
   {dossier.alerts.length>0&&<div className="cisne-integrated-warnings" aria-label="Pendências documentais">
    <strong><TriangleAlert size={13}/> {dossier.alerts.length} alerta(s) na cadeia</strong>
    {dossier.alerts.slice(0,3).map(a=><p key={a.code}>{a.message}</p>)}
    {dossier.alerts.length>3&&<button type="button" onClick={()=>onDossier(orderId)}>Ver todos os alertas</button>}
   </div>}
  </>}
 </section>;
}
