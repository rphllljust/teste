'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {ArrowRight,CalendarClock,CheckCircle2,ClipboardList,Plus,RefreshCw,ShieldAlert} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';

type Category='labor'|'material'|'equipment'|'subcontract'|'milestone';
type State='draft'|'ready'|'in_progress'|'done'|'cancelled';
type Work={
 id:string;reference:string;title:string;description:string;category:Category;state:State;
 plannedStartOn:string;plannedEndOn:string;plannedHoursScaled:string;plannedCostScaled:string;
 dependsOnId:string|null;dependencyTitle:string|null;dependencyState:string|null;
 responsibleProfessionalId:string|null;responsibleName:string|null;rowVersion:number;
 overdue:boolean;blocked:boolean;
};
type Summary={total:number;active:number;done:number;running:number;drafts:number;cancelled:number;
 overdue:number;completionRatePercent:number|null;plannedCostScaled:string;plannedHoursScaled:string;
 attributedCostScaled:string;varianceScaled:string;varianceAvailable:boolean;unbudgetedActual:boolean};
type WorkPlan={
 orderId:string;orderStatus:string;items:Work[];summary:Summary;
 pageInfo:{page:number;hasMore:boolean;total:number|null};professionals:Array<{id:string;name:string}>;
 history:Array<{command:string;version:number;packageId:string;changedAt:string}>;
 warnings:string[];
};
type EditData={reference:string;title:string;description:string;category:Category;
 plannedStartOn:string;plannedEndOn:string;plannedHours:string;plannedCost:string;
 responsibleProfessionalId:string;dependsOnId:string};
const today=()=>new Date().toISOString().slice(0,10);
const fresh=():EditData=>({reference:'',title:'',description:'',category:'labor',
 plannedStartOn:today(),plannedEndOn:today(),plannedHours:'0',plannedCost:'0',
 responsibleProfessionalId:'',dependsOnId:''});
const states:Record<State,string>={draft:'Rascunho',ready:'Pronta',in_progress:'Em execução',
 done:'Concluída',cancelled:'Cancelada'};
const categories:Record<Category,string>={labor:'Mão de obra',material:'Material',
 equipment:'Equipamento',subcontract:'Subcontratação',milestone:'Marco de entrega'};
const decimal=(scaled:string)=>{
 const v=BigInt(scaled);const raw=(v/10000n).toString();
 const rest=(v%10000n).toString().padStart(4,'0').replace(/0+$/,'');
 return rest?raw+','+rest:raw;
};
const scaled=(raw:string)=>{
 const clean=raw.trim();
 if(!/^(0|[1-9][0-9]{0,12})(?:,[0-9]{1,4})?$/.test(clean))return null;
 const [head,fraction='']=clean.split(',');
 return (BigInt(head)*10000n+BigInt(fraction.padEnd(4,'0')||'0')).toString();
};
const currency=(n:string)=>n.startsWith('-')?'−'+moneyScaled(n.slice(1)):moneyScaled(n);
const message=async(response:Response)=>{
 try{const body=await response.json() as {error?:string};return body.error??'Comando recusado.';}
 catch{return 'Comando recusado. Atualize o planejamento.';}
};
/** Enterprise planning does not mutate execution, measurement, cash or GL. */
export default function EnterpriseServiceOrderWorkPlan({orderId}:{orderId:string}){
 const [page,setPage]=useState(1),[state,setState]=useState('all'),[revision,setRevision]=useState(0);
 const [data,setData]=useState<WorkPlan|null>(null),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [form,setForm]=useState<EditData>(fresh);
 const [editing,setEditing]=useState<Work|null>(null),[editorOpen,setEditorOpen]=useState(false),[saving,setSaving]=useState(false);
 const [pending,setPending]=useState<{task:Work;action:'complete'|'cancel'}|null>(null);
 const [reason,setReason]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  const timer=window.setTimeout(async()=>{
   setLoading(true);setError('');
   try{
    const p=new URLSearchParams({page:String(page),state});
    const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/work-packages?'+p,{
     credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error(await message(response));
    const value=await response.json() as WorkPlan;
    if(value.orderId!==orderId)throw Error('O planejamento não corresponde à OS selecionada.');
    if(!controller.signal.aborted)setData(value);
   }catch(cause){
    if(!controller.signal.aborted){setData(null);setError(cause instanceof Error?cause.message:'Planejamento indisponível.');}
   }finally{if(!controller.signal.aborted)setLoading(false);}
  },0);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[orderId,page,state,revision]);
 const setField=<K extends keyof EditData>(key:K,value:EditData[K])=>setForm(old=>({...old,[key]:value}));
 const write=async(payload:object)=>{
  setSaving(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/work-packages',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(!response.ok)throw Error(await message(response));
   setNotice('Comando confirmado pelo servidor com histórico auditável.');
   setRevision(n=>n+1);
   return true;
  }catch(cause){
   setError(cause instanceof Error?cause.message:'Não foi possível confirmar o comando.');
   if(cause instanceof Error&&cause.message.toLowerCase().includes('atualize'))setRevision(n=>n+1);
   return false;
  }finally{setSaving(false);}
 };
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  const plannedHoursScaled=scaled(form.plannedHours),plannedCostScaled=scaled(form.plannedCost);
  if(plannedHoursScaled===null||plannedCostScaled===null){
   setError('Informe horas e custos não negativos, sem ponto de milhar e com até quatro casas decimais.');return;
  }
  const data={
   reference:form.reference,title:form.title,description:form.description,category:form.category,
   plannedStartOn:form.plannedStartOn,plannedEndOn:form.plannedEndOn,
   plannedHoursScaled,plannedCostScaled,
   dependsOnId:form.dependsOnId||null,
   responsibleProfessionalId:form.responsibleProfessionalId||null,
  };
  const payload=editing?{action:'revise',key:crypto.randomUUID(),packageId:editing.id,
   expectedVersion:editing.rowVersion,data}
   :{action:'create',key:crypto.randomUUID(),packageId:crypto.randomUUID(),data};
  if(await write(payload)){setEditing(null);setForm(fresh());setEditorOpen(false);}
 };
 const beginEdit=(p:Work)=>{
  setEditing(p);setEditorOpen(true);
  setForm({reference:p.reference,title:p.title,description:p.description,category:p.category,
   plannedStartOn:p.plannedStartOn,plannedEndOn:p.plannedEndOn,
   plannedHours:decimal(p.plannedHoursScaled),plannedCost:decimal(p.plannedCostScaled),
   dependsOnId:p.dependsOnId??'',responsibleProfessionalId:p.responsibleProfessionalId??''});
 };
 const command=async(p:Work,action:'ready'|'start'|'complete'|'cancel',explanation='')=>{
  const payload={action,key:crypto.randomUUID(),packageId:p.id,expectedVersion:p.rowVersion,
   ...(action==='complete'?{evidenceReference:explanation}:{}),
   ...(action==='cancel'?{reason:explanation}:{})};
  if(await write(payload)){setPending(null);setReason('');}
 };
 const allowed=!!data&&!['cancelled','completed'].includes(data.orderStatus);
 return <details className="enterprise-os-workplan">
  <summary><span><ClipboardList size={14}/> Plano de trabalho e orçamento da OS</span>
   <small>{data?data.summary.active+' atividades vigentes · '+data.summary.overdue+' atrasadas':'Abrir estrutura de execução'}</small></summary>
  <div className="enterprise-os-workplan-content">
   <header><strong>Estrutura analítica de trabalho</strong>
    <button className="secondary" type="button" onClick={()=>setRevision(n=>n+1)}
     disabled={loading||saving}><RefreshCw size={13}/> Atualizar</button></header>
   {loading&&<p role="status" className="enterprise-os-workplan-message">Consultando pacotes de trabalho autorizados…</p>}
   {error&&<p role="alert" className="enterprise-os-workplan-error">{error}</p>}
   {notice&&<p role="status" className="enterprise-os-workplan-message">{notice}</p>}
   {data&&<>
    <div className="enterprise-os-workplan-summary" aria-label="Orçamento e execução de atividades">
     <div><span>Orçamento planejado</span><strong>{currency(data.summary.plannedCostScaled)}</strong></div>
     <div><span>Custo atribuído à OS</span><strong>{currency(data.summary.attributedCostScaled)}</strong></div>
     <div><span>Saldo do orçamento</span><strong>{data.summary.varianceAvailable?currency(data.summary.varianceScaled):'Não definido'}</strong></div>
     <div><span>Atividades concluídas</span><strong>{data.summary.done}/{data.summary.active}</strong>
      <small>{data.summary.completionRatePercent===null?'Sem planejamento':data.summary.completionRatePercent+'% de marcos administrativos'}</small></div>
    </div>
    {data.summary.unbudgetedActual&&<p className="enterprise-os-workplan-error">
     <ShieldAlert size={13}/> Existem custos atribuídos sem orçamento de pacotes vigente.</p>}
    {data.summary.overdue>0&&<p className="enterprise-os-workplan-warning">
     <CalendarClock size={13}/> {data.summary.overdue} atividades com data prevista vencida.</p>}
    <p className="enterprise-os-workplan-disclosure">Orçamento de atividades não é custo realizado. Concluir um pacote não gera apontamento, medição, fatura ou baixa financeira.</p>
    <div className="enterprise-os-workplan-filter">
     <label>Fila <select value={state} onChange={e=>{setState(e.target.value);setPage(1);}}>
      <option value="all">Todas</option>
      {Object.entries(states).map(([key,label])=><option value={key} key={key}>{label}</option>)}
     </select></label>
     <span>{data.summary.total} atividades no contexto da OS</span>
    </div>
    <div className="enterprise-os-workplan-list">
     {data.items.length===0&&<p>Nenhuma atividade corresponde ao filtro. Cadastre o primeiro pacote abaixo.</p>}
     {data.items.map(p=><article key={p.id} className="enterprise-os-workplan-task">
      <div className="enterprise-os-workplan-task-head">
       <span><strong>{p.reference} · {p.title}</strong><small>{categories[p.category]}</small></span>
       <span className={'enterprise-os-workplan-state state-'+p.state}>{states[p.state]}</span>
      </div>
      <div className="enterprise-os-workplan-task-meta">
       <span>{p.plannedStartOn} → {p.plannedEndOn}</span>
       <span>{decimal(p.plannedHoursScaled)} h previstas</span>
       <span>{currency(p.plannedCostScaled)}</span>
       <span>{p.responsibleName??'Sem responsável'}</span>
      </div>
      {(p.blocked||p.overdue)&&<p className="enterprise-os-workplan-task-alert">
       {p.blocked?'Predecessora ainda não concluída. ':''}{p.overdue?'Prazo planejado vencido.':''}</p>}
      {p.dependsOnId&&<p className="enterprise-os-workplan-dependency">
       Depende de: {p.dependencyTitle??p.dependsOnId.slice(0,8)} · {p.dependencyState??'não confirmado'}</p>}
      <div className="enterprise-os-workplan-actions">
       {allowed&&['draft','ready'].includes(p.state)&&<button type="button" className="secondary"
        disabled={saving} onClick={()=>beginEdit(p)}>Replanejar</button>}
       {allowed&&p.state==='draft'&&<button type="button" disabled={saving} onClick={()=>void command(p,'ready')}>
        Liberar atividade <ArrowRight size={12}/></button>}
       {allowed&&p.state==='ready'&&<button type="button" disabled={saving||p.blocked}
        title={p.blocked?'Conclua a predecessora.':'Iniciar'} onClick={()=>void command(p,'start')}>
        Iniciar <ArrowRight size={12}/></button>}
       {allowed&&p.state==='in_progress'&&<button type="button" disabled={saving}
        onClick={()=>{setPending({task:p,action:'complete'});setReason('');}}>
        Concluir com referência <CheckCircle2 size={12}/></button>}
       {allowed&&['draft','ready','in_progress'].includes(p.state)&&<button type="button" className="secondary"
        disabled={saving} onClick={()=>{setPending({task:p,action:'cancel'});setReason('');}}>Cancelar</button>}
      </div>
     </article>)}
    </div>
    <div className="enterprise-os-workplan-pagination">
     <button className="secondary" disabled={page===1||loading} type="button" onClick={()=>setPage(v=>v-1)}>Anterior</button>
     <span>Página {page}</span>
     <button className="secondary" disabled={!data.pageInfo.hasMore||loading} type="button" onClick={()=>setPage(v=>v+1)}>Próxima</button>
    </div>
    {pending&&<form className="enterprise-os-workplan-confirm" onSubmit={e=>{
     e.preventDefault();void command(pending.task,pending.action,reason);}}>
     <strong>{pending.action==='complete'?'Referência documental de conclusão':'Justificativa de cancelamento'}</strong>
     <p>{pending.task.reference} · {pending.task.title}</p>
     <input aria-label="Evidência ou justificativa da transição" value={reason} maxLength={240}
      onChange={e=>setReason(e.target.value)} placeholder={pending.action==='complete'?'Ex.: RELATORIO-CAMPO-2026-012':'Motivo detalhado (mínimo 8 caracteres)'} />
     <div><button disabled={saving||reason.trim().length<8} type="submit">Confirmar no servidor</button>
      <button type="button" className="secondary" onClick={()=>setPending(null)}>Voltar</button></div>
    </form>}
    {allowed&&<details className="enterprise-os-workplan-editor" open={editorOpen} onToggle={e=>setEditorOpen(e.currentTarget.open)}>
     <summary><Plus size={13}/> {editing?'Replanejar atividade '+editing.reference:'Cadastrar pacote de trabalho'}</summary>
     <form onSubmit={e=>void submit(e)}>
      <label>Referência<input required minLength={3} maxLength={60} value={form.reference}
       onChange={e=>setField('reference',e.target.value)} placeholder="OS-ETAPA-01"/></label>
      <label>Título<input required minLength={3} maxLength={160} value={form.title}
       onChange={e=>setField('title',e.target.value)} placeholder="Mobilização de equipe"/></label>
      <label>Categoria<select value={form.category} onChange={e=>setField('category',e.target.value as Category)}>
       {Object.entries(categories).map(([key,label])=><option value={key} key={key}>{label}</option>)}
      </select></label>
      <label>Responsável<select value={form.responsibleProfessionalId}
       onChange={e=>setField('responsibleProfessionalId',e.target.value)}>
       <option value="">Não definido</option>
       {data.professionals.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>Início previsto<input type="date" required value={form.plannedStartOn}
       onChange={e=>setField('plannedStartOn',e.target.value)}/></label>
      <label>Fim previsto<input type="date" required min={form.plannedStartOn} value={form.plannedEndOn}
       onChange={e=>setField('plannedEndOn',e.target.value)}/></label>
      <label>Horas previstas<input inputMode="decimal" required value={form.plannedHours}
       onChange={e=>setField('plannedHours',e.target.value)} placeholder="8,00"/></label>
      <label>Custo previsto (R$)<input inputMode="decimal" required value={form.plannedCost}
       onChange={e=>setField('plannedCost',e.target.value)} placeholder="1800,00"/></label>
      <label className="enterprise-os-workplan-wide">Predecessora
       <select value={form.dependsOnId} onChange={e=>setField('dependsOnId',e.target.value)}>
        <option value="">Sem dependência</option>
        {data.items.filter(x=>x.state!=='cancelled'&&x.id!==editing?.id).map(x=>
         <option key={x.id} value={x.id}>{x.reference} · {x.title}</option>)}
        {form.dependsOnId&&!data.items.some(x=>x.id===form.dependsOnId)&&
         <option value={form.dependsOnId}>Predecessora registrada fora desta página</option>}
       </select></label>
      <label className="enterprise-os-workplan-wide">Descrição
       <textarea rows={2} maxLength={2000} value={form.description}
        onChange={e=>setField('description',e.target.value)} placeholder="Escopo, entregáveis, critérios de aceite"/></label>
      <div className="enterprise-os-workplan-form-actions">
       <button type="submit" disabled={saving}>{saving?'Salvando…':editing?'Confirmar replanejamento':'Cadastrar atividade'}</button>
       {editing&&<button type="button" className="secondary" onClick={()=>{setEditing(null);setForm(fresh());setEditorOpen(false);}}>
        Sair da edição</button>}
      </div>
     </form>
    </details>}
    <details className="enterprise-os-workplan-history"><summary>Histórico de comandos · últimas 12 alterações</summary>
     {data.history.map((e,i)=><p key={e.packageId+'-'+e.version+'-'+i}>
      {e.command} · versão {e.version} · {e.packageId.slice(0,8)} · {e.changedAt}</p>)}
     {!data.history.length&&<p>Nenhum comando registrado.</p>}
    </details>
    <p className="enterprise-os-workplan-disclosure">{data.warnings[0]}</p>
   </>}
  </div>
 </details>;
}
