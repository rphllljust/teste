'use client';
import {useEffect,useState} from 'react';
import {Activity,ArrowRight,CalendarClock,FileText,RefreshCw,ShieldAlert,Wallet} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';

type Phase='intake'|'planning'|'execution'|'measurement'|'approval'|'billing'|'collections'|'invoiced'|'review'|'cancelled';
type Evidence={
 allocations:number;futureAllocations:number;allocationsOngoingNow:number;releasedAllocations:number;
 activeExecution:number;correctedExecution:number;unmeasuredExecution:number;
 measurements:number;pendingMeasurements:number;approvedUnbilled:number;
 cancelledMeasurements:number;invoices:number;activeCostAllocations:number;
};
type Control={
 phase:Phase;flags:string[];severity:'high'|'attention'|'none';overdue:boolean;asOf:string;
 financial:{billedScaled:string;receivedScaled:string;receivableOutstandingScaled:string;
  attributedCostScaled:string;partialContributionScaled:string};
};
type Resource={id:string;label:string;resourceType:string;status:string;startsAt:string;endsAt:string};
type Execution={id:string;reference:string;kind:string;quantityScaled:string;unit:string;effectiveDate:string};
type Measurement={id:string;status:string;description:string;amountScaled:string;invoiceId:string|null};
type Cost={id:string;kind:string;amountScaled:string;payableId:string;reference:string;reversed:boolean};
type Report={
 order:{id:string;title:string;status:string;client:string;dueDate:string|null;contractId:string|null};
 evidence:Evidence;control:Control;
 recent:{allocations:Resource[];allocationsTruncated:boolean;execution:Execution[];
 executionTruncated:boolean;measurements:Measurement[];measurementsTruncated:boolean;
 costs:Cost[];costsTruncated:boolean};
 warnings:string[];generatedAt:string;
};
const phases:Record<Phase,string>={
 intake:'Preparação',planning:'Planejamento',execution:'Execução',measurement:'Medição',
 approval:'Aprovação de medições',billing:'Faturamento',collections:'Recebimento pendente',
 invoiced:'Faturamento registrado',review:'Revisão documental',cancelled:'Cancelada'
};
const alerts:Record<string,string>={
 OS_DEADLINE_OVERDUE:'Prazo da OS vencido',
 RESOURCE_ALLOCATION_NOT_RECORDED:'Sem alocação ativa registrada para esta OS em execução',
 EXECUTION_EVIDENCE_MISSING:'OS concluída sem apontamento de execução ativo',
 EXECUTION_WITHOUT_MEASUREMENT:'Apontamento concluído sem medição vigente',
 MEASUREMENT_DECISION_PENDING:'Medições aguardando submissão ou aprovação',
 APPROVED_MEASUREMENT_UNBILLED:'Medição aprovada sem fatura vinculada',
 RECEIPTS_EXCEED_INVOICES:'Recebimentos líquidos superiores ao faturamento',
 RECEIVABLE_BALANCE_OPEN:'Saldo de recebíveis ainda em aberto'
};
const cash=(value:string)=>value.startsWith('-')?'−'+moneyScaled(value.slice(1)):moneyScaled(value);
const date=(value:string|null)=>{
 if(!value)return 'Sem data';
 const d=new Date(value.length===10?value+'T12:00:00Z':value);
 return Number.isNaN(d.getTime())?'Data indisponível':
  new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(d);
};
/** Only owner-authorized, read-only document evidence. Commands remain in native pages. */
export default function EnterpriseServiceOrderControlPanel({orderId,onOpenOrder,navigate}:{
 orderId:string;onOpenOrder:(id:string)=>void;navigate:(module:string,orderId?:string)=>void;
}){
 const [data,setData]=useState<Report|null>(null),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setData(null);setError('');
  const run=async()=>{
   try{
    const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/control',{
     cache:'no-store',credentials:'same-origin',signal:controller.signal});
    const body=await response.json() as Report&{error?:string};
    if(!response.ok||!body.order||body.order.id!==orderId)
     throw Error(body.error??'Controle operacional indisponível.');
    if(!controller.signal.aborted)setData(body);
   }catch(cause){
    if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Controle indisponível.');
   }finally{if(!controller.signal.aborted)setLoading(false);}
  };
  void run();
  return()=>controller.abort();
 },[orderId,revision]);
 return <section className="enterprise-os-control" aria-label="Controle transacional da ordem">
  <header className="enterprise-os-control-title">
   <div><span className="eyebrow">CONTROLE DOCUMENTAL · ORDEM DE SERVIÇO</span>
    <h3>Planejamento → Execução → Medição → Financeiro</h3></div>
   <button type="button" className="secondary" onClick={()=>setRevision(v=>v+1)}
    disabled={loading} aria-label="Atualizar controle da OS"><RefreshCw size={13}/></button>
  </header>
  {loading&&<p role="status" className="enterprise-os-control-placeholder">Conferindo evidências vinculadas…</p>}
  {error&&<p role="alert" className="enterprise-os-control-placeholder">{error}</p>}
  {data&&<>
   <div className="enterprise-os-control-phase">
    <span>Etapa documental atual</span>
    <strong>{phases[data.control.phase]??data.control.phase}</strong>
    <small>Não representa aprovação, autorização de execução ou conciliação bancária.</small>
   </div>
   <div className="enterprise-os-control-metrics">
    <div><span>Alocações ativas</span><strong>{data.evidence.allocations}</strong>
     <small>{data.evidence.allocationsOngoingNow} em curso no momento</small></div>
    <div><span>Apontamentos ativos</span><strong>{data.evidence.activeExecution}</strong>
     <small>{data.evidence.correctedExecution} corrigido(s)</small></div>
    <div><span>Medições vigentes</span><strong>{data.evidence.measurements}</strong>
     <small>{data.evidence.unmeasuredExecution} apontamento(s) sem medição</small></div>
    <div><span>Faturas vinculadas</span><strong>{data.evidence.invoices}</strong>
     <small>{data.evidence.approvedUnbilled} medição(ões) aprovadas sem fatura</small></div>
   </div>
   <dl className="enterprise-os-control-money">
    <div><dt>Faturado</dt><dd>{cash(data.control.financial.billedScaled)}</dd></div>
    <div><dt>Recebimentos lançados</dt><dd>{cash(data.control.financial.receivedScaled)}</dd></div>
    <div><dt>Saldo documental a receber</dt><dd>{cash(data.control.financial.receivableOutstandingScaled)}</dd></div>
    <div><dt>Custos atribuídos à OS</dt><dd>{cash(data.control.financial.attributedCostScaled)}</dd></div>
   </dl>
   <p className="enterprise-os-control-finance-note">
    <Wallet size={13}/> Receita e custo são evidências parciais. Nenhum recebimento presume conciliação bancária;
    contribuição parcial não equivale à margem ou lucro contábil.
   </p>
   {data.control.flags.length>0&&<section className="enterprise-os-control-alerts" aria-label="Pendências da OS">
    <h4><ShieldAlert size={14}/> Pendências e exceções · {data.control.flags.length}</h4>
    <ul>{data.control.flags.map(flag=><li key={flag}>{alerts[flag]??flag}</li>)}</ul>
   </section>}
   {!data.control.flags.length&&<p className="enterprise-os-control-clear">
    Nenhuma lacuna identificada pelos controles atuais. Isso não constitui fechamento auditado.</p>}
   <nav className="enterprise-os-control-nav" aria-label="Abrir registros de origem da OS">
    <button type="button" onClick={()=>onOpenOrder(orderId)}><FileText size={13}/> Documento da OS</button>
    <button type="button" onClick={()=>navigate('Execução',orderId)}><Activity size={13}/> Apontar execução</button>
    <button type="button" onClick={()=>navigate('Medições',orderId)}>Medições <ArrowRight size={12}/></button>
    <button type="button" onClick={()=>navigate('Resource Planning Board')}>Alocar recursos <ArrowRight size={12}/></button>
    <button type="button" onClick={()=>navigate('Dossiês empresariais',orderId)}>Dossiê completo <ArrowRight size={12}/></button>
    <button type="button" onClick={()=>navigate('Visão financeira')}>Controladoria <ArrowRight size={12}/></button>
   </nav>
   <details className="enterprise-os-control-trace">
    <summary>Rastreabilidade por documento <span>{data.recent.allocations.length} recursos · {data.recent.execution.length} apontamentos · {data.recent.measurements.length} medições</span></summary>
    <div className="enterprise-os-control-trace-grid">
     <div><h4>Recursos alocados</h4>
      {data.recent.allocations.map(x=><p key={x.id}><strong>{x.label}</strong><small>{x.status} · {date(x.startsAt)} → {date(x.endsAt)}</small></p>)}
      {!data.recent.allocations.length&&<p>Nenhum recurso registrado.</p>}
      {data.recent.allocationsTruncated&&<small>Exibindo os oito mais recentes.</small>}</div>
     <div><h4>Execução registrada</h4>
      {data.recent.execution.map(x=><p key={x.id}><strong>{x.reference}</strong><small>{x.kind} · {x.effectiveDate} · quantidade escalada {x.quantityScaled} · {x.unit}</small></p>)}
      {!data.recent.execution.length&&<p>Nenhum apontamento ativo.</p>}
      {data.recent.executionTruncated&&<small>Exibindo os oito mais recentes.</small>}</div>
     <div><h4>Medições e faturamento</h4>
      {data.recent.measurements.map(x=><p key={x.id}><strong>{x.description}</strong>
       <small>{x.status} · {cash(x.amountScaled)} · {x.invoiceId?'Fatura vinculada':'Sem fatura'}</small></p>)}
      {!data.recent.measurements.length&&<p>Nenhuma medição registrada.</p>}
      {data.recent.measurementsTruncated&&<small>Exibindo as oito mais recentes.</small>}</div>
     <div><h4>Custos analíticos atribuídos</h4>
      {data.recent.costs.map(x=><p key={x.id}><strong>{x.reference}</strong>
       <small>{x.kind==='reverse'||x.reversed?'Revertido':'Atribuição'} · {cash(x.amountScaled)}</small></p>)}
      {!data.recent.costs.length&&<p>Nenhuma atribuição analítica registrada.</p>}
      {data.recent.costsTruncated&&<small>Exibindo as oito mais recentes.</small>}</div>
    </div>
   </details>
   <details className="enterprise-os-control-notes"><summary><CalendarClock size={13}/> Origem e limites do controle</summary>
    {data.warnings.map(w=><p key={w}>{w}</p>)}
    <p>Fotografia consistente somente leitura · {new Date(data.generatedAt).toLocaleString('pt-BR')}.</p>
   </details>
  </>}
 </section>;
}
