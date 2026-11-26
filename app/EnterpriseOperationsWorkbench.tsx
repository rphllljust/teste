'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, ClipboardList, ListFilter, Plus, RefreshCw, Search, ShieldCheck, Users, LayoutList, ChartNoAxesCombined, BookOpenCheck, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { EnterprisePageHeader, EnterpriseObjectSummary, ErrorState, LoadingState } from './components/enterprise/EnterprisePrimitives';
import { EnterpriseSmartGrid, type EnterpriseSmartColumn } from './components/enterprise/EnterpriseSmartGrid';
import EnterpriseOperationsAnalytics, {type OperationsAnalytics} from './EnterpriseOperationsAnalytics';
import EnterpriseFinancialAssurance from './components/enterprise/EnterpriseFinancialAssurance';

type Queue='all'|'attention'|'overdue'|'unmeasured'|'draft'|'authorized'|'executing'|'completed';
type Sort='priority'|'deadline'|'recent'|'client';
type Row={
 id:string;title:string;client:string;category:string;status:string;description:string;
 createdAt:string;dueDate:string|null;overdue:boolean;unmeasured:boolean;attentionRank:number;
 evidence:{measurements:number;invoices:number;executions:number};
};
type ResponseData={
 items:Row[];
 summary:{total:number;draft:number;executing:number;overdue:number;unmeasured:number;authorized:number};
 pageInfo:{page:number;pageSize:number;total:number;hasMore:boolean};
 analytics:OperationsAnalytics;
 source:'postgres_owner_scoped_operations';generatedAt:string;note:string;
};
type Detail={
 order:Row & {
   availableCommands?:Array<{id:string;label:string;primary?:boolean}>;
   relations?:{clientId?:string|null;contractId?:string|null;measurements:number;invoices:number;receivables:number};
   sublists?:{history:{items:Array<{id:string;label:string;command:string;created_at:string}>;pageInfo:{total:number;hasMore:boolean}}};
 };
};
export type EnterpriseOperationsProps={
 mode?:'command'|'field';
 onCreate?:()=>void;
 onOpenOrder:(id:string)=>void;
 navigate:(module:string)=>void;
};
const statuses:Record<string,string>={
 draft:'Rascunho',prepared:'Preparada',planned:'Planejada',
 authorized:'Autorizada',executing:'Em execução',in_progress:'Em execução',
 completed:'Concluída',cancelled:'Cancelada',
};
const states:Record<Queue,string>={
 all:'Todas as ordens',attention:'Exigem atenção',overdue:'Atrasadas',
 unmeasured:'Concluídas sem medição',draft:'Rascunhos',
 authorized:'Autorizadas',executing:'Em execução',completed:'Concluídas',
};
const date=(value:string|null)=>{
 if(!value)return 'Sem prazo';
 const parsed=new Date(value.length===10?value+'T12:00:00Z':value);
 return Number.isNaN(parsed.getTime())?'Data indisponível':
 new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(parsed);
};
const safeError=async(response:Response)=>{
 try{
  const value=await response.json() as {error?:string};
  return value.error??'Consulta empresarial indisponível.';
 }catch{return 'Consulta empresarial indisponível.';}
};

/** List Report and Object Page use only server-authorized, persisted evidence.
 * The worklist itself cannot approve, invoice, close or allocate anything.
 * It navigates to the authoritative transaction where commands are validated.
 */
export default function EnterpriseOperationsWorkbench({
 mode='command',onCreate,onOpenOrder,navigate,
}:EnterpriseOperationsProps){
 const [queue,setQueue]=useState<Queue>(mode==='field'?'executing':'attention');
 const [search,setSearch]=useState('');
 const [q,setQ]=useState('');
 const [category,setCategory]=useState('all');
 const [sort,setSort]=useState<Sort>('priority');
 const [page,setPage]=useState(1);
 const [revision,setRevision]=useState(0);
 const [data,setData]=useState<ResponseData|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [detail,setDetail]=useState<Detail|null>(null);
 const [detailError,setDetailError]=useState('');
 const [detailLoading,setDetailLoading]=useState(false);
 const [surface,setSurface]=useState<'work'|'insights'|'finance'>('work');
 const [inspectorVisible,setInspectorVisible]=useState(true);
 const [mobileInspectorOpen,setMobileInspectorOpen]=useState(false);
 const [narrow,setNarrow]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia('(max-width:1060px)');
  const sync=()=>setNarrow(media.matches);
  const timer=window.setTimeout(sync,0);
  media.addEventListener('change',sync);
  return()=>{window.clearTimeout(timer);media.removeEventListener('change',sync);};
 },[]);
 useEffect(()=>{
  if(!narrow||!mobileInspectorOpen)return;
  const inspector=document.getElementById('cisne-order-inspector');
  const focusable=()=>Array.from(inspector?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')??[]);
  focusable()[0]?.focus();
  const handle=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();setMobileInspectorOpen(false);return;}
   if(event.key!=='Tab')return;
   const buttons=focusable();
   if(!buttons.length)return;
   const first=buttons[0],last=buttons[buttons.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  window.addEventListener('keydown',handle);
  return()=>window.removeEventListener('keydown',handle);
 },[narrow,mobileInspectorOpen]);

 useEffect(()=>{
  const timer=setTimeout(()=>{setPage(1);setQ(search.trim());},260);
  return()=>clearTimeout(timer);
 },[search]);

 useEffect(()=>{
  const abort=new AbortController();
  const timer=setTimeout(async()=>{
   setLoading(true);setError('');
   try{
    const params=new URLSearchParams({q,queue,category,sort,page:String(page),pageSize:'25'});
    const response=await fetch('/api/enterprise/operations?'+params,{
     cache:'no-store',credentials:'same-origin',signal:abort.signal,
    });
    if(!response.ok)throw new Error(await safeError(response));
    const result=await response.json() as ResponseData;
    if(!abort.signal.aborted){
     setData(result);
     setSelectedId(current=>result.items.some(row=>row.id===current)?current:
       result.items[0]?.id??null);
    }
   }catch(cause){
    if(!abort.signal.aborted){
     setData(null);setSelectedId(null);
     setError(cause instanceof Error?cause.message:'Fila operacional indisponível.');
    }
   }finally{if(!abort.signal.aborted)setLoading(false);}
  },0);
  return()=>{clearTimeout(timer);abort.abort();};
 },[q,queue,category,sort,page,revision]);

 useEffect(()=>{
  if(!selectedId){return;}
  const abort=new AbortController();
  const timer=setTimeout(async()=>{
   setDetail(null);setDetailError('');setDetailLoading(true);
   try{
    const response=await fetch('/api/orders/'+encodeURIComponent(selectedId),{
     cache:'no-store',credentials:'same-origin',signal:abort.signal,
    });
    if(!response.ok)throw new Error(await safeError(response));
    const value=await response.json() as Detail;
    if(!abort.signal.aborted)setDetail(value);
   }catch(cause){
    if(!abort.signal.aborted)
     setDetailError(cause instanceof Error?cause.message:'Documento indisponível no seu contexto.');
   }finally{if(!abort.signal.aborted)setDetailLoading(false);}
  },0);
  return()=>{clearTimeout(timer);abort.abort();};
 },[selectedId,revision]);

 const selectQueue=(next:Queue)=>{setQueue(next);setPage(1);};
 const selected=data?.items.find(row=>row.id===selectedId)??null;
 const summary=data?.summary;
 const columns=useMemo<EnterpriseSmartColumn<Row>[]>(()=>[
  {key:'document',title:'OS / Cliente',required:true,
   render:row=><span className="enterprise-smart-primary"><strong>{row.title}</strong><small>{row.client} · {row.id.slice(0,8).toUpperCase()}</small></span>,
   text:row=>row.id+' · '+row.title+' · '+row.client,sortValue:row=>row.title},
  {key:'state',title:'Situação',
   render:row=><span className={'enterprise-dossier-status status-'+row.status}>{statuses[row.status]??row.status}</span>,
   text:row=>statuses[row.status]??row.status,sortValue:row=>row.status},
  {key:'deadline',title:'Prazo',
   render:row=><span className={row.overdue?'operation-overdue':undefined}>{row.overdue&&<CalendarClock size={13}/>} {date(row.dueDate)}</span>,
   text:row=>date(row.dueDate),sortValue:row=>row.dueDate??''},
  {key:'evidence',title:'Evidências',render:row=><span className="cisne-workstation-evidence" aria-label={'Execuções '+row.evidence.executions+', medições '+row.evidence.measurements+', faturas '+row.evidence.invoices}>
    <span title="Execuções">E <strong>{row.evidence.executions}</strong></span>
    <span title="Medições">M <strong>{row.evidence.measurements}</strong></span>
    <span title="Faturas">F <strong>{row.evidence.invoices}</strong></span></span>,
   text:row=>'Execuções '+row.evidence.executions+' · Medições '+row.evidence.measurements+' · Faturas '+row.evidence.invoices},
  {key:'attention',title:'Prioridade',
   render:row=><span className={row.overdue?'operation-overdue':'cisne-workstation-priority'}>
     {row.overdue?'Prazo vencido':row.unmeasured?'Medição pendente':row.status==='draft'?'Em preparação':'Regular'}
    </span>,
   text:row=>row.overdue?'Prazo vencido':row.unmeasured?'Medição pendente':row.status==='draft'?'Em preparação':'Regular',
   sortValue:row=>row.attentionRank},
 ],[]);
 const inspectOrder=(row:Row)=>{
  setSelectedId(row.id);setInspectorVisible(true);
  setMobileInspectorOpen(window.matchMedia('(max-width:1060px)').matches);
 };
 const quick=[
  {key:'all' as Queue,label:'OS no contexto',value:summary?.total,icon:ClipboardList},
  {key:'overdue' as Queue,label:'Atrasadas',value:summary?.overdue,icon:CalendarClock},
  {key:'unmeasured' as Queue,label:'Sem medição',value:summary?.unmeasured,icon:CircleAlert},
  {key:'executing' as Queue,label:'Em execução',value:summary?.executing,icon:CheckCircle2},
  {key:'draft' as Queue,label:'Em preparação',value:summary?.draft,icon:Users},
 ];
 return <section className={'enterprise-operations-workbench enterprise-operations-'+mode+' cisne-workstation-tier1'} data-surface={surface} aria-label="Centro transacional de operações">
  <EnterprisePageHeader eyebrow="CENTRO DE COMANDO · DOCUMENTOS EMPRESARIAIS"
   title={mode==='field'?'Despacho e execução':'Centro de operações'}
   description="Fila de trabalho por prioridade, prazos e pendências, com documentos persistidos e ações autorizadas."
   actions={<div className="enterprise-operations-actions">
    <button type="button" className="secondary" onClick={()=>setRevision(v=>v+1)} disabled={loading}><RefreshCw size={16}/> Atualizar</button>
    {onCreate&&<button type="button" className="primary" onClick={onCreate}><Plus size={16}/> Nova ordem</button>}
   </div>}
  />
  <div className="enterprise-operations-assurance" role="note"><ShieldCheck size={16}/>
   <span>Indicadores calculados exclusivamente sobre OS vinculadas ao contexto autenticado. Abertura de documento não implica autorização de transição.</span>
  </div>
  {error&&<ErrorState message={error} onRetry={()=>setRevision(v=>v+1)}/>}
  <div className="enterprise-operations-indicators" aria-label="Indicadores operacionais globais">
   {quick.map(item=><button type="button" key={item.key}
      aria-pressed={queue===item.key} onClick={()=>selectQueue(item.key)}
      aria-label={item.label+': '+(item.value??'indisponível')+'. Filtrar fila por '+states[item.key]}>
     <item.icon size={17} aria-hidden="true"/>
     <strong>{item.value??'—'}</strong><span>{item.label}</span>
    </button>)}
  </div>
  {mode==='command'&&<div className="cisne-workstation-views">
   <div className="cisne-workstation-view-tabs" role="tablist" aria-label="Espaços da estação de trabalho">
    <button type="button" role="tab" id="cisne-view-work" aria-controls="cisne-panel-work"
     aria-selected={surface==='work'} onClick={()=>setSurface('work')}><LayoutList size={16}/> Trabalho</button>
    <button type="button" role="tab" id="cisne-view-insights" aria-controls="cisne-panel-insights"
     aria-selected={surface==='insights'} onClick={()=>setSurface('insights')}><ChartNoAxesCombined size={16}/> Análise operacional</button>
    <button type="button" role="tab" id="cisne-view-finance" aria-controls="cisne-panel-finance"
     aria-selected={surface==='finance'} onClick={()=>setSurface('finance')}><BookOpenCheck size={16}/> Controladoria</button>
   </div>
   <span className="cisne-workstation-live-source"><ShieldCheck size={13}/> Dados reais · escopo autenticado</span>
  </div>}
  {mode==='command'&&surface==='insights'&&<div className="cisne-workstation-analytical-surface"
     id="cisne-panel-insights" role="tabpanel" aria-labelledby="cisne-view-insights">
     <EnterpriseOperationsAnalytics summary={summary} analytics={data?.analytics}
      generatedAt={data?.generatedAt} navigate={navigate}/>
  </div>}
  {mode==='command'&&surface==='finance'&&<div className="cisne-workstation-finance-surface"
     id="cisne-panel-finance" role="tabpanel" aria-labelledby="cisne-view-finance">
     <EnterpriseFinancialAssurance navigate={navigate}/>
  </div>}
  {(mode==='field'||surface==='work')&&<div className="cisne-workstation-work-surface"
    id="cisne-panel-work" role={mode==='command'?'tabpanel':undefined}
    aria-labelledby={mode==='command'?'cisne-view-work':undefined}>
   <div className="cisne-workstation-priority-strip">
    <strong>Fila de trabalho</strong>
    {summary?.overdue?<button type="button" className="is-critical" onClick={()=>selectQueue('overdue')}>
      <CalendarClock size={14}/>{summary.overdue} prazo(s) vencido(s)</button>:null}
    {summary?.unmeasured?<button type="button" onClick={()=>selectQueue('unmeasured')}>
      <CircleAlert size={14}/>{summary.unmeasured} medição(ões) pendente(s)</button>:null}
    <span>{loading?'Atualizando registros autorizados…':data?.generatedAt?'Atualizado '+new Date(data.generatedAt).toLocaleString('pt-BR'):'Consulta protegida'}</span>
   </div>
  <div className="enterprise-operations-toolbar">
   <label className="enterprise-operations-search"><Search size={16}/>
    <input value={search} type="search" onChange={e=>setSearch(e.target.value)}
     aria-label="Buscar OS por título, cliente ou número" placeholder="Buscar OS, cliente ou número"/>
   </label>
   <label>Fila<select aria-label="Fila operacional" value={queue} onChange={e=>selectQueue(e.target.value as Queue)}>
     {Object.entries(states).map(([key,label])=><option value={key} key={key}>{label}</option>)}
    </select></label>
   <label>Atividade<select aria-label="Atividade operacional" value={category}
       onChange={e=>{setCategory(e.target.value);setPage(1);}}>
      <option value="all">Todas as atividades</option>
      {['Locação','Serviços','Transporte','Obra'].map(value=><option key={value}>{value}</option>)}
    </select></label>
   <label>Classificação<select aria-label="Classificação de OS" value={sort}
       onChange={e=>{setSort(e.target.value as Sort);setPage(1);}}>
      <option value="priority">Criticidade</option><option value="deadline">Próximo prazo</option>
      <option value="recent">Mais recentes</option><option value="client">Cliente</option>
    </select></label>
   {(q||category!=='all'||queue!==(mode==='field'?'executing':'attention'))&&<button type="button" className="text-button"
     onClick={()=>{setSearch('');setQ('');setCategory('all');selectQueue(mode==='field'?'executing':'attention');}}>Limpar filtros</button>}
   <button type="button" className="cisne-workstation-inspector-toggle"
    aria-controls="cisne-order-inspector" aria-expanded={narrow?mobileInspectorOpen:inspectorVisible}
    onClick={()=>{
     if(narrow){setInspectorVisible(true);setMobileInspectorOpen(true);}
     else{setInspectorVisible(value=>!value);setMobileInspectorOpen(false);}
    }}>
    {(narrow||!inspectorVisible)?<PanelRightOpen size={16}/>:<PanelRightClose size={16}/>}
    {narrow?'Inspecionar OS':inspectorVisible?'Ocultar inspeção':'Mostrar inspeção'}
   </button>
  </div>
  <div className="enterprise-operations-body" data-inspector={inspectorVisible?'open':'closed'}
    data-mobile-inspector={mobileInspectorOpen?'open':'closed'}>
   <div className="enterprise-operations-list" aria-label="Lista transacional de ordens">
    {loading?<LoadingState label="Consultando documentos autorizados…"/>:data&&<>
      <div className="cisne-workstation-mobile-list" role="list" aria-label="Ordens da página autorizada">
       {data.items.map(row=><div role="listitem" key={row.id}>
        <button type="button" className="cisne-workstation-mobile-order" onClick={()=>inspectOrder(row)}>
         <span className="cisne-workstation-mobile-head">
          <strong>{row.title}</strong><span className={'enterprise-dossier-status status-'+row.status}>{statuses[row.status]??row.status}</span>
         </span>
         <small>{row.client} · {row.id.slice(0,8).toUpperCase()}</small>
         <span className="cisne-workstation-mobile-meta"><span className={row.overdue?'operation-overdue':undefined}>
          <CalendarClock size={13}/>{date(row.dueDate)}</span><span>E {row.evidence.executions} · M {row.evidence.measurements} · F {row.evidence.invoices}</span></span>
         <span className="cisne-workstation-mobile-open">Examinar documento <ArrowRight size={14}/></span>
        </button>
       </div>)}
      </div>
      <EnterpriseSmartGrid viewId={'operations-'+mode} caption="Fila de trabalho operacional"
       rows={data.items} columns={columns} getRowKey={row=>row.id} activeKey={selectedId}
       currentPageLabel={'Página '+data.pageInfo.page+' · '+data.pageInfo.total+' resultados filtrados'}
       onOpen={row=>inspectOrder(row)} openLabel={row=>'Examinar OS '+row.title}/>
      <div className="enterprise-operations-pagination">
       <span>Registros desta página: {data.items.length} · total filtrado: {data.pageInfo.total}</span>
       <div><button type="button" className="secondary" disabled={page===1} onClick={()=>setPage(n=>n-1)}>Anterior</button>
        <span>Página {page}</span>
        <button type="button" className="secondary" disabled={!data.pageInfo.hasMore} onClick={()=>setPage(n=>n+1)}>Próxima</button></div>
      </div>
     </>}
   </div>
   {mobileInspectorOpen&&<button type="button" className="cisne-workstation-inspector-scrim"
     aria-label="Fechar inspeção de documento" onClick={()=>setMobileInspectorOpen(false)}/>}
   <aside id="cisne-order-inspector" className="enterprise-operations-object" aria-label="Object Page da ordem selecionada"
    role={narrow&&mobileInspectorOpen?'dialog':undefined} aria-modal={narrow&&mobileInspectorOpen?true:undefined}>
    <div className="enterprise-operations-object-kicker"><ListFilter size={15}/> INSPEÇÃO DE DOCUMENTO
     <button id="cisne-operations-inspector-close" type="button" className="cisne-workstation-object-close"
      onClick={()=>{setInspectorVisible(false);setMobileInspectorOpen(false);}} aria-label="Fechar inspeção">
      <X size={16}/><span>Fechar</span>
     </button>
    </div>
    {selected?<div className="enterprise-operations-object-content">
     <EnterpriseObjectSummary type="Ordem de serviço" reference={selected.id.slice(0,8).toUpperCase()}
      title={selected.title} status={statuses[selected.status]??selected.status}
      subtitle={selected.client+' · '+selected.category}
      facts={[
       {label:'Data prevista',value:date(selected.dueDate)},
       {label:'Execuções',value:String(selected.evidence.executions)},
       {label:'Medições',value:String(selected.evidence.measurements)},
       {label:'Faturas',value:String(selected.evidence.invoices)},
      ]}/>
     {detailLoading&&<LoadingState label="Carregando contexto autorizado da OS…"/>}
     {detailError&&<div className="enterprise-operations-object-error" role="alert"><CircleAlert size={15}/>{detailError}</div>}
     {detail?.order.id===selected.id&&<>
      <section className="enterprise-operations-object-section" aria-labelledby="operations-document-context">
       <h3 id="operations-document-context">Situação e vínculos</h3>
       <p>{detail.order.description||'Nenhuma descrição registrada.'}</p>
       <dl>
        <div><dt>Cliente vinculado</dt><dd>{detail.order.relations?.clientId?'Confirmado':'Vínculo não disponível'}</dd></div>
        <div><dt>Contrato</dt><dd>{detail.order.relations?.contractId?'Vinculado':'Sem vínculo informado'}</dd></div>
        <div><dt>Recebíveis</dt><dd>{detail.order.relations?.receivables??0}</dd></div>
       </dl>
      </section>
      <section className="enterprise-operations-object-section" aria-labelledby="operations-document-history">
       <h3 id="operations-document-history">Histórico e auditoria</h3>
       {(detail.order.sublists?.history?.items??[]).length?
        <ol>{detail.order.sublists?.history?.items.slice(0,5).map(event=><li key={event.id}>
          <span>{event.label}</span><small>{date(event.created_at)}</small></li>)}</ol>:
        <p>Nenhum evento disponível.</p>}
      </section>
      <div className="enterprise-operations-commands">
       <h3>Transições autorizadas para esta OS</h3>
       {detail.order.availableCommands?.length?
        <ul className="cisne-workstation-command-tags">{detail.order.availableCommands.map(command=>
         <li key={command.id}>{command.label}</li>)}</ul>:
        <p>Nenhum comando de transição disponível neste contexto.</p>}
       <small>Executar somente na página oficial da ordem, com validação pelo servidor.</small>
      </div>
     </>}
     <div className="enterprise-operations-object-actions">
      <button type="button" className="primary" onClick={()=>onOpenOrder(selected.id)}>
       Abrir OS e comandos autorizados <ArrowRight size={15}/>
      </button>
      <button type="button" className="secondary" onClick={()=>navigate('Dossiês empresariais')}>Consultar dossiês</button>
      <button type="button" className="secondary" onClick={()=>navigate('Resource Planning Board')}>Planejar recursos</button>
     </div>
    </div>:<div className="enterprise-operations-object-placeholder">
      <ClipboardList size={24}/><strong>Selecione um documento</strong>
      <p>Os dados e as ações dependem de uma OS efetivamente autorizada.</p>
    </div>}
   </aside>
  </div>
  <footer className="enterprise-operations-footer">
   <span><ShieldCheck size={14}/> Fonte: PostgreSQL · Leitura por proprietário autenticado</span>
   <span>Filtros no servidor. Colunas e exportação limitadas à página autorizada.</span>
  </footer>
  </div>}
 </section>;
}
