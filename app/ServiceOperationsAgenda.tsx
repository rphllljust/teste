'use client';

import {ArrowRight, CalendarDays} from 'lucide-react';

type AgendaOrder={id:string;title:string;client:string;status:string;due_date:string|null};

const labels:Record<string,string>={DRAFT:'Rascunho',PREPARED:'Preparada',IN_PROGRESS:'Em execução',COMPLETED:'Concluída',CANCELLED:'Cancelada'};

export default function ServiceOperationsAgenda({orders,onSelect,onShowScheduled}:{orders:AgendaOrder[];onSelect:(id:string)=>void;onShowScheduled:()=>void}){
 const isOverdue=(order:AgendaOrder)=>Boolean(order.due_date&&!['COMPLETED','CANCELLED'].includes(order.status)&&new Date(order.due_date+'T23:59:59Z').getTime()<Date.now());
 const items=orders.filter(order=>order.due_date&&!['COMPLETED','CANCELLED'].includes(order.status)).sort((a,b)=>Number(isOverdue(b))-Number(isOverdue(a))||new Date(a.due_date!).getTime()-new Date(b.due_date!).getTime()||a.title.localeCompare(b.title,'pt-BR')).slice(0,5);
 return <section className="service-agenda" aria-label="Agenda operacional"><div className="agenda-heading"><div><span className="section-label">AGENDA OPERACIONAL</span><h3>Próximos compromissos</h3><p>Datas previstas das ordens no contexto atual.</p></div><button className="text-button" onClick={onShowScheduled}>Ver todas <ArrowRight size={14}/></button></div>{items.length?<div className="agenda-list">{items.map(order=><button className="agenda-item" key={order.id} onClick={()=>onSelect(order.id)}><time dateTime={order.due_date!}>{new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(new Date(order.due_date!))}</time><span><strong>{order.title}</strong><small>{isOverdue(order)?'Atrasada · ':''}{order.client} · {labels[order.status]??order.status}</small></span><ArrowRight size={15}/></button>)}</div>:<div className="agenda-empty"><CalendarDays size={17}/><span>Nenhuma ordem com data prevista no contexto atual.</span></div>}</section>;
}
