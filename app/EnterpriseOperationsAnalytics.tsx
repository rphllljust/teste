'use client';

import { ArrowRight, BarChart3, CalendarClock, CircleAlert, ClipboardList, Coins, Layers3 } from 'lucide-react';

export type OperationsAnalytics = {
  statusBuckets: Array<{status:string;total:number}>;
  dueBuckets: {overdue:number;next7:number;next15:number;later:number;withoutDate:number};
  completed: number;
};
type Summary = {total:number;draft:number;executing:number;overdue:number;unmeasured:number;authorized:number};
type Props = {summary: Summary | null | undefined; analytics: OperationsAnalytics | null | undefined; generatedAt?:string; navigate:(module:string)=>void};
const statusName:Record<string,string> = {
 draft:'Rascunhos',prepared:'Preparadas',planned:'Planejadas',authorized:'Autorizadas',
 executing:'Em execução',in_progress:'Em execução',completed:'Concluídas',cancelled:'Canceladas',
};
const statusColor:Record<string,string> = {
 draft:'#efb950',prepared:'#ffda88',planned:'#6d9dcc',authorized:'#2e9866',
 executing:'#2689b8',in_progress:'#2689b8',completed:'#326b9e',cancelled:'#b0bdc8',
};
const steps = [
 {label:'Cliente',module:'Clientes e propostas'},
 {label:'Proposta',module:'Propostas e PO'},
 {label:'Contrato',module:'Contratos'},
 {label:'OS',module:'Ordens de serviço'},
 {label:'Execução',module:'Execução'},
 {label:'Medição',module:'Medições'},
 {label:'Faturamento',module:'Faturamento'},
] as const;
const int = (value:number|undefined) => value == null ? '—' : new Intl.NumberFormat('pt-BR').format(value);
const pct=(part:number,total:number)=>total>0?Math.round(part/total*100):0;

export default function EnterpriseOperationsAnalytics({summary,analytics,generatedAt,navigate}:Props) {
 const total=summary?.total??0;
 const statuses=analytics?.statusBuckets??[];
 const segmentTotal=statuses.reduce((sum,bucket)=>sum+bucket.total,0);
 let offset=0;
 const segments=statuses.map(bucket=>{
  const start=offset;
  offset+=segmentTotal>0?100*bucket.total/segmentTotal:0;
  return `${statusColor[bucket.status]??'#8ba4b4'} ${start}% ${offset}%`;
 });
 const ring = segmentTotal>0 ? `conic-gradient(${segments.join(',')})` : 'conic-gradient(#d8e4ec 0 100%)';
 const deadlines=[
  {label:'Vencidas',total:analytics?.dueBuckets.overdue??0,className:'is-critical'},
  {label:'Até 7 dias',total:analytics?.dueBuckets.next7??0,className:'is-warning'},
  {label:'8–15 dias',total:analytics?.dueBuckets.next15??0,className:'is-normal'},
  {label:'Mais de 15 dias',total:analytics?.dueBuckets.later??0,className:'is-normal'},
  {label:'Sem prazo',total:analytics?.dueBuckets.withoutDate??0,className:'is-muted'},
 ];
 const max=Math.max(1,...deadlines.map(item=>item.total));
 return <section className="cisne-operations-control-tower" aria-label="Painel analítico de operações">
  <div className="cisne-operations-context">
   <span><Layers3 size={15}/> Painel de gestão · ordens autorizadas por escopo</span>
   <span>{generatedAt ? 'Consulta: '+new Date(generatedAt).toLocaleString('pt-BR') : 'Consulta em andamento'}</span>
  </div>
  <div className="cisne-operations-management-kpis">
   <div><ClipboardList size={18}/><span>OS autorizadas / planejadas</span><strong>{int(analytics ? summary?.authorized : undefined)}</strong><small>No contexto autenticado</small></div>
   <div><BarChart3 size={18}/><span>OS concluídas</span><strong>{int(analytics?.completed)}</strong><small>Estados persistidos</small></div>
   <div><CalendarClock size={18}/><span>Vencimento até 7 dias</span><strong>{int(analytics?.dueBuckets.next7)}</strong><small>OS não encerradas</small></div>
   <div><CircleAlert size={18}/><span>Sem prazo cadastrado</span><strong>{int(analytics?.dueBuckets.withoutDate)}</strong><small>OS não encerradas</small></div>
   <button type="button" className="cisne-operations-finance-entry" onClick={()=>navigate('Financeiro')}>
    <Coins size={18}/><span>Visão financeira</span><strong>Abrir módulo <ArrowRight size={14}/></strong><small>Sem indicadores monetários simulados</small>
   </button>
  </div>
  <div className="cisne-operations-analytics-grid">
   <section className="cisne-operations-chart" aria-labelledby="cisne-operations-status-title">
    <h2 id="cisne-operations-status-title">OS por situação</h2>
    <div className="cisne-operations-donut-row">
     <div className="cisne-operations-donut" role="img" aria-label={statuses.map(b=>`${statusName[b.status]??b.status}: ${b.total}`).join('; ') || 'Sem dados'} style={{background:ring}}>
      <div><strong>{int(analytics?total:undefined)}</strong><small>OS</small></div>
     </div>
     <ul>{statuses.length?statuses.map(bucket=><li key={bucket.status}>
      <span className="cisne-operations-dot" style={{backgroundColor:statusColor[bucket.status]??'#8ba4b4'}}/>
      <span>{statusName[bucket.status]??bucket.status}</span>
      <strong>{int(bucket.total)} ({pct(bucket.total,total)}%)</strong>
     </li>):<li>Sem dados de situação</li>}</ul>
    </div>
   </section>
   <section className="cisne-operations-chart" aria-labelledby="cisne-operations-deadline-title">
    <h2 id="cisne-operations-deadline-title">Ordens por prazo</h2>
    <div className="cisne-operations-bars">
     {deadlines.map(bucket=><div key={bucket.label} className="cisne-operations-bar">
      <span>{bucket.label}</span>
      <div className="cisne-operations-bar-track" role="progressbar"
       aria-label={bucket.label} aria-valuenow={bucket.total} aria-valuemin={0} aria-valuemax={max}>
       <span className={bucket.className} style={{width:`${100*bucket.total/max}%`}}/>
      </div><strong>{analytics?int(bucket.total):'—'}</strong>
     </div>)}
    </div>
    <small className="cisne-operations-chart-note">Classificação exclusiva das ordens não concluídas e não canceladas.</small>
   </section>
   <section className="cisne-operations-chart cisne-operations-exception-chart" aria-labelledby="cisne-operations-attention-title">
    <h2 id="cisne-operations-attention-title">Controle de exceções</h2>
    <div className="cisne-operations-attention">
     <div><span>Prazo vencido</span><strong>{int(analytics?summary?.overdue:undefined)}</strong><div><i style={{width:`${pct(summary?.overdue??0,total)}%`}}/></div></div>
     <div><span>Concluída sem medição</span><strong>{int(analytics?summary?.unmeasured:undefined)}</strong><div><i style={{width:`${pct(summary?.unmeasured??0,total)}%`}}/></div></div>
     <div><span>Rascunho / preparação</span><strong>{int(analytics?summary?.draft:undefined)}</strong><div><i style={{width:`${pct(summary?.draft??0,total)}%`}}/></div></div>
    </div>
    <small className="cisne-operations-chart-note">Exceções podem se sobrepor; não são parcelas de um mesmo total.</small>
   </section>
  </div>
  <nav className="cisne-operations-process" aria-label="Fluxo empresarial integrado">
   <div><strong>Fluxo do processo</strong><span>Navegação entre documentos reais; não presume etapas concluídas</span></div>
   <ol>{steps.map((step,index)=><li key={step.module}>
    <button type="button" className={step.label==='OS'?'is-current':undefined}
     aria-current={step.label==='OS'?'step':undefined} onClick={()=>navigate(step.module)}>
     <span>{String(index+1).padStart(2,'0')}</span>{step.label}
    </button>
   </li>)}</ol>
  </nav>
 </section>;
}
