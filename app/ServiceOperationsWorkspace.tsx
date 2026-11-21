'use client';

import { EnterpriseDropdown } from './components/enterprise/EnterprisePrimitives';
import { EnterpriseButton, EnterpriseSearchField,} from './components/enterprise/EnterprisePrimitives';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Activity, ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Clock3, Plus, RefreshCw, TriangleAlert} from 'lucide-react';
import { EnterprisePageHeader } from './components/enterprise/EnterprisePrimitives';
import { ServiceOrderEvidence } from './components/enterprise/ServiceOrderEvidence';


type Order={id:string;title:string;client:string;category:string;description:string;status:string;due_date:string|null;created_at:string;availableCommands?:{id:string;label:string;primary?:boolean}[];relations?:{measurements:number;invoices:number;receivables:number}};

const PAGE_SIZE=25;
const statusLabel:Record<string,string>={DRAFT:'Rascunho',PREPARED:'Preparada',IN_PROGRESS:'Em execução',COMPLETED:'Concluída',CANCELLED:'Cancelada'};

function ServiceOperationsWorkspaceView({onCreate,onOpen}:{onCreate:()=>void;onOpen:(id:string)=>void}){
 const [orders,setOrders]=useState<Order[]>([]),[selectedId,setSelectedId]=useState(''),[query,setQuery]=useState(''),[view,setView]=useState('Todas as ordens'),[category,setCategory]=useState('Todas as atividades'),[sort,setSort]=useState('createdAt.desc'),[page,setPage]=useState(1),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const requestGeneration=useRef(0);
 const load=useCallback(async()=>{
   const generation=++requestGeneration.current;
   setLoading(true);setError('');
   try{
     const response=await fetch('/api/orders?'+new URLSearchParams({
       q:query,page:String(page),pageSize:String(PAGE_SIZE),sort,view,category,
     }));
     const data=await response.json() as {orders?:Order[];total?:number;pageInfo?:{total:number};error?:string};
     if(!response.ok)throw new Error(data.error||'Ordens indisponíveis.');
     // A successful HTTP response without the required worklist projection is
     // not an empty queue. Require the server's pagination contract.
     const verifiedTotal=data.pageInfo?.total??data.total;
     if(!Array.isArray(data.orders)||typeof verifiedTotal!=='number'||
        !Number.isSafeInteger(verifiedTotal)||verifiedTotal<0||
        verifiedTotal<data.orders.length){
       throw new Error('O servidor não confirmou a lista e a paginação de ordens.');
     }
     if(generation!==requestGeneration.current)return;
     const currentOrders=data.orders;
     setOrders(currentOrders);
     setTotal(verifiedTotal);
     setSelectedId(current=>currentOrders.some(order=>order.id===current)?current:(currentOrders[0]?.id??''));
   }catch(cause){
     if(generation!==requestGeneration.current)return;
     setError(cause instanceof Error?cause.message:'Ordens indisponíveis.');
     setOrders([]);setSelectedId('');setTotal(0);
   }finally{
     if(generation===requestGeneration.current)setLoading(false);
   }
 },[query,view,category,sort,page]);
 useEffect(()=>{const t=setTimeout(()=>void load(),160);return()=>clearTimeout(t);},[load]);
 const selected=useMemo(()=>orders.find(o=>o.id===selectedId)??null,[orders,selectedId]);
 const canGoBack=page>1;
 const canGoForward=page*PAGE_SIZE<total;
 const groups=useMemo(()=>({priority:orders.filter(o=>['IN_PROGRESS','PREPARED'].includes(o.status)),attention:orders.filter(o=>['DRAFT'].includes(o.status)),closed:orders.filter(o=>['COMPLETED','CANCELLED'].includes(o.status))}),[orders]);;
 const upcoming=useMemo(()=>orders.filter(o=>o.due_date&&!['COMPLETED','CANCELLED'].includes(o.status)).sort((a,b)=>new Date(a.due_date!).getTime()-new Date(b.due_date!).getTime()).slice(0,5),[orders]);
 const formatDueDate=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(new Date(value));
 return <section className="service-operations cisne-workspace operations-workspace" data-workspace="operations" aria-label="Centro de operações de serviços">
  <EnterprisePageHeader eyebrow="OPERAÇÃO · ORDENS DE SERVIÇO" title="Centro de operações" description="Priorize execução, exceções e continuidade comercial a partir de uma única fila." actions={<div className="service-operations-actions"><EnterpriseButton type="button" className="secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>Atualizar</EnterpriseButton><EnterpriseButton type="button" className="primary" onClick={onCreate}><Plus size={17}/>Nova ordem</EnterpriseButton></div>} />
  <div className="service-operations-toolbar" role="group" aria-label="Busca e filtros de ordens de serviço">
    <EnterpriseSearchField label="Buscar ordens de serviço" placeholder="Buscar por ordem, cliente ou atividade" value={query} disabled={false} onValueChange={value => {setQuery(value);setPage(1);}} />
    <div className="service-operations-filter">
      <span className="service-operations-filter-label">Visão de trabalho</span>
      <EnterpriseDropdown aria-label="Visão operacional" value={view} onValueChange={value => {setView(value);setPage(1);}}>
        <option>Todas as ordens</option><option>Rascunhos</option><option>Em execução</option><option>Com data prevista</option><option>Concluídas sem medição</option>
      </EnterpriseDropdown>
    </div>
    <div className="service-operations-filter">
      <span className="service-operations-filter-label">Atividade</span>
      <EnterpriseDropdown aria-label="Categoria" value={category} onValueChange={value => {setCategory(value);setPage(1);}}>
        <option>Todas as atividades</option><option>Locação</option><option>Serviços</option><option>Transporte</option><option>Obra</option>
      </EnterpriseDropdown>
    </div>
    <div className="service-operations-filter">
      <span className="service-operations-filter-label">Ordenação</span>
      <EnterpriseDropdown aria-label="Ordenação" value={sort} onValueChange={value => {setSort(value);setPage(1);}}>
        <option value="createdAt.desc">Mais recentes</option><option value="dueDate.asc">Próximo prazo</option><option value="title.asc">Título</option>
      </EnterpriseDropdown>
    </div>
    <span className="toolbar-count" role="status">{loading ? 'Consultando…' : error ? 'Dados indisponíveis — consulta não concluída' : `${orders.length} de ${total} ordens filtradas · página ${page}`}</span>
  </div>
  {loading?<div className="service-operations-loading" role="status" aria-live="polite">Consultando fila de trabalho autorizada…</div>:error?<div className="empty" role="alert"><TriangleAlert size={22}/><h3>Fila indisponível</h3><p>{error}</p><EnterpriseButton type="button" className="secondary" onClick={()=>void load()}>Tentar novamente</EnterpriseButton></div>:<><section className="service-agenda" aria-label="Agenda operacional"><div className="agenda-heading"><div><span className="section-label">AGENDA OPERACIONAL</span><h3>Próximos compromissos</h3><p>Datas previstas das ordens nesta página; consulte as demais pelo paginador.</p></div><EnterpriseButton type="button" className="text-button" onClick={()=>{setView('Com data prevista');setPage(1);}}>Ver com prazo <ArrowRight size={14}/></EnterpriseButton></div>{upcoming.length?<div className="agenda-list">{upcoming.map(order=><EnterpriseButton type="button" className="agenda-item" key={order.id} onClick={()=>setSelectedId(order.id)}><time dateTime={order.due_date!}>{formatDueDate(order.due_date!)}</time><span><strong>{order.title}</strong><small>{order.client} · {statusLabel[order.status]??order.status}</small></span><ArrowRight size={15}/></EnterpriseButton>)}</div>:<p className="queue-empty">Nenhuma ordem com data prevista no contexto atual.</p>}</section><div className="service-operations-grid">
   <aside className="service-queue" aria-label="Fila operacional"><div className="queue-heading"><span>FILA DE TRABALHO</span><small>{orders.length} registros nesta página</small></div><section><h3><Activity size={15}/>Prioridade operacional</h3>{groups.priority.length?groups.priority.map(o=><EnterpriseButton type="button" className={'queue-item '+(o.id===selectedId?'active':'')} key={o.id} onClick={()=>setSelectedId(o.id)}><span><strong>{o.title}</strong><small>{o.client}</small></span><em>{statusLabel[o.status]??o.status}</em></EnterpriseButton>):<p className="queue-empty">Nenhuma ordem em execução.</p>}</section><section><h3><Clock3 size={15}/>Aguardando próxima ação</h3>{groups.attention.length?groups.attention.map(o=><EnterpriseButton type="button" className={'queue-item '+(o.id===selectedId?'active':'')} key={o.id} onClick={()=>setSelectedId(o.id)}><span><strong>{o.title}</strong><small>{o.client}</small></span><em>{statusLabel[o.status]??o.status}</em></EnterpriseButton>):<p className="queue-empty">Nenhuma pendência nesta fila.</p>}</section><section className="queue-muted"><h3><CheckCircle2 size={15}/>Histórico recente</h3><p>{groups.closed.length} ordens concluídas ou encerradas nesta página.</p></section></aside>
   <div className="service-object">{selected?<><header className="service-object-header"><div><span className="eyebrow">OBJETO DE NEGÓCIO · {selected.id.slice(0,8).toUpperCase()}</span><h3>{selected.title}</h3><p>{selected.client} · {selected.category}</p></div><span className={'status-pill status-'+selected.status.toLowerCase()}>{statusLabel[selected.status]??selected.status}</span></header><div className="service-progress"><span className="progress-step done">Cadastro</span><span className={['IN_PROGRESS','COMPLETED'].includes(selected.status)?'progress-step done':'progress-step'}>Execução</span><span className={(selected.relations?.measurements??0)>0?'progress-step has-record':'progress-step'}>Medições vinculadas</span><span className={(selected.relations?.invoices??0)>0?'progress-step has-record':'progress-step'}>Faturamento vinculado</span></div><div className="service-object-body"><article><span className="section-label">CONTEXTO DA ORDEM</span><p className="service-description">{selected.description||'Sem descrição operacional informada.'}</p><div className="object-facts"><div><small>Cliente</small><strong>{selected.client}</strong></div><div><small>Data prevista</small><strong>{selected.due_date?new Intl.DateTimeFormat('pt-BR').format(new Date(selected.due_date)):'Não definida'}</strong></div><div><small>Registros vinculados</small><strong>{(selected.relations?.measurements??0)+(selected.relations?.invoices??0)+(selected.relations?.receivables??0)}</strong></div></div></article><aside className="object-next"><span className="section-label">PRÓXIMA AÇÃO</span><h4>{selected.availableCommands?.[0]?.label??(selected.status==='COMPLETED'?'Revisar histórico':'Consultar continuidade')}</h4><p>A ação permanece condicionada ao estado real e às permissões do registro.</p><EnterpriseButton type="button" className="primary" onClick={()=>onOpen(selected.id)}><ClipboardList size={16}/>Abrir objeto completo<ArrowRight size={16}/></EnterpriseButton></aside></div><ServiceOrderEvidence key={selected.id} orderId={selected.id} /><footer className="service-object-footer"><span><CalendarDays size={15}/>Criada em {new Intl.DateTimeFormat('pt-BR').format(new Date(selected.created_at))}</span><EnterpriseButton type="button" className="text-button" onClick={()=>onOpen(selected.id)}>Ver histórico e vínculos</EnterpriseButton></footer></>:<div className="empty"><ClipboardList size={28}/><h3>Selecione uma ordem</h3><p>A fila operacional mostra o contexto de cada trabalho.</p></div>}</div>
   <aside className="service-inspector"><span className="section-label">INSPEÇÃO CONTEXTUAL</span><h3>Continuidade empresarial</h3><p>Da ordem de serviço aos documentos financeiros, o contexto permanece conectado.</p><div className="inspector-item"><strong>Materiais e estoque</strong><small>Consulte a disponibilidade real no módulo de estoque.</small></div><div className="inspector-item"><strong>Compras relacionadas</strong><small>Abra compras para verificar pedidos e recebimentos; vínculo não verificado nesta visão.</small></div><div className="inspector-item"><strong>Medições e faturamento</strong><small>{selected?.relations?.measurements??0} medições · {selected?.relations?.invoices??0} cobranças.</small></div><div className="inspector-note"><TriangleAlert size={16}/><span>Este painel não consulta exceções de compras ou estoque; verifique o registro de origem.</span></div></aside>
  </div><nav className="service-operations-pagination" aria-label="Paginação do centro de operações"><EnterpriseButton type="button" className="secondary" disabled={loading||!canGoBack} onClick={()=>setPage(current=>Math.max(1,current-1))}>Página anterior</EnterpriseButton><span role="status">Página {page} · {total} ordens no filtro</span><EnterpriseButton type="button" className="secondary" disabled={loading||!canGoForward} onClick={()=>setPage(current=>current+1)}>Próxima página</EnterpriseButton></nav></>}
 </section>;
}
export default function ServiceOperationsWorkspace(props:{onCreate:()=>void;onOpen:(id:string)=>void}){return <ServiceOperationsWorkspaceView {...props}/>;}
