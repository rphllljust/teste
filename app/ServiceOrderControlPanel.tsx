'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,ClipboardCheck,RefreshCw,ShieldAlert} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';
import ServiceOrderMilestonesPanel from './ServiceOrderMilestonesPanel';

type Alert={code:string;severity:'warning'|'info';module:string;message:string};
type Control={
 order:{id:string;title:string;status:string;version:number};
 focus:string;overdue:boolean;alerts:Alert[];asOf:string;
 financial:{billedScaled:string;settledScaled:string;openReceivableScaled:string;
  attributedCostScaled:string;partialContributionScaled:string};
 counts:{activeAllocations:number;activeExecutions:number;unmeasuredExecutions:number;
  measurements:number;approvedUnbilled:number;invoices:number};
 evidence:{resources:{active:number;released:number;elapsedActive:number};
  execution:{active:number;reversed:number;pendingMeasurement:number};
  measurements:{draft:number;submitted:number;approved:number;billed:number;cancelled:number;approvedUnbilled:number};
  billing:{invoices:number;withoutReceivable:number;withoutVerifiedPosting:number};
  bank:{receiptsWithoutActiveMatch:number};
  costs:{allocationEvents:number;reversalEvents:number}};
 warnings:string[];
};
const currency=(value:string)=>value.startsWith('-')?'−'+moneyScaled(value.slice(1)):moneyScaled(value);
const modules=['Resource Planning Board','Execução','Medições','Faturamento','Visão financeira','Dossiês empresariais'] as const;
const moduleNames:Record<string,string>={
 'Resource Planning Board':'Planejar recursos','Execução':'Registrar execução',
 'Medições':'Consultar medições','Faturamento':'Ver faturamento',
 'Visão financeira':'Ver financeiro','Dossiês empresariais':'Abrir rastreabilidade'
};
/** Evidence inspector; all writes remain inside the canonical server-authorized workspaces. */
export default function ServiceOrderControlPanel({orderId,onNavigate,onExecuteOrder}:{
 orderId:string;onNavigate:(module:string)=>void;onExecuteOrder?:()=>void;
}){
 const [revision,setRevision]=useState(0);
 const [snapshot,setSnapshot]=useState<{
  orderId:string;revision:number;result:Control|null;error:string
 }|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  void(async()=>{
   try{
    const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/control',{
     cache:'no-store',credentials:'same-origin',signal:controller.signal});
    const body=await response.json() as Control&{error?:string};
    if(!response.ok)throw Error(body.error??'Controles da OS indisponíveis.');
    if(!controller.signal.aborted)setSnapshot({orderId,revision,result:body,error:''});
   }catch(e){if(!controller.signal.aborted)setSnapshot({
    orderId,revision,result:null,
    error:e instanceof Error?e.message:'Evidências indisponíveis.'
   });}
  })();
  return()=>controller.abort();
 },[orderId,revision]);
 const current=snapshot?.orderId===orderId&&snapshot.revision===revision?snapshot:null;
 const loading=!current,data=current?.result??null,error=current?.error??'';
 const open=(module:string)=>{
  if(module==='Execução'&&onExecuteOrder){onExecuteOrder();return;}
  const target=module==='Controladoria'||module==='Financeiro'?'Visão financeira':module;
  onNavigate(target);
 };
 return <section className="service-order-control" aria-label="Controle transacional da ordem de serviço">
  <header className="service-order-control-heading">
   <div><span className="eyebrow">CONTROLE DE OPERAÇÃO · EVIDÊNCIAS PERSISTIDAS</span>
    <h3>Planejamento, execução e resultado documental</h3></div>
   <button type="button" className="secondary" aria-label="Revalidar evidências da OS"
    disabled={loading} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={14}/> Atualizar</button>
  </header>
  {loading?<p role="status" className="service-order-control-message">Verificando informações da ordem…</p>:
  error?<div className="service-order-control-message" role="alert">{error}
   <button type="button" className="secondary" onClick={()=>setRevision(n=>n+1)}>Repetir</button></div>:
  data&&<div className="service-order-control-body">
   <div className="service-order-control-stages" aria-label="Rastreabilidade por etapa">
    {[
     {name:'Recursos',value:data.evidence.resources.active,secondary:'alocações ativas',module:'Resource Planning Board'},
     {name:'Execução',value:data.evidence.execution.active,secondary:'apontamentos válidos',module:'Execução'},
     {name:'Medição',value:data.evidence.measurements.approved,secondary:'aprovadas',module:'Medições'},
     {name:'Faturamento',value:data.evidence.billing.invoices,secondary:'faturas vinculadas',module:'Faturamento'},
     {name:'Tesouraria',value:currency(data.financial.settledScaled),secondary:'recebimento líquido',module:'Visão financeira'},
    ].map(stage=><button type="button" key={stage.name} className="service-order-control-stage"
     onClick={()=>open(stage.module)}>
     <span>{stage.name}</span><strong>{stage.value}</strong><small>{stage.secondary}</small>
    </button>)}
   </div>
   <div className="service-order-control-finance" aria-label="Valores nominais e custos atribuídos">
    <div><small>Faturamento emitido</small><strong>{currency(data.financial.billedScaled)}</strong></div>
    <div><small>Recebimento líquido</small><strong>{currency(data.financial.settledScaled)}</strong></div>
    <div><small>Saldo de faturas</small><strong>{currency(data.financial.openReceivableScaled)}</strong></div>
    <div><small>Custo atribuído à OS</small><strong>{currency(data.financial.attributedCostScaled)}</strong></div>
    <div><small>Contribuição parcial*</small><strong>{currency(data.financial.partialContributionScaled)}</strong></div>
   </div>
   <section className="service-order-control-exceptions" aria-label="Pendências e evidências faltantes">
    <header><h4>Verificações operacionais</h4>
     <span>{data.alerts.length} observação(ões)</span></header>
    {data.alerts.length?
     <div className="service-order-control-alerts">{data.alerts.map(alert=>
      <div key={alert.code} className={'service-order-control-alert '+alert.severity}>
       <ShieldAlert size={14}/><span><strong>{alert.message}</strong><small>{alert.module}</small></span>
       <button type="button" onClick={()=>open(alert.module)}>Abrir <ArrowRight size={12}/></button>
      </div>)}</div>:
     <p className="service-order-control-all-clear"><CheckCircle2 size={15}/>
      Nenhuma lacuna detectada pelas regras deste painel. Isto não certifica fechamento da OS.</p>}
   </section>
   <details className="service-order-control-evidence">
    <summary><ClipboardCheck size={14}/> Evidências e limites de interpretação</summary>
    <dl>
     <div><dt>Alocações encerradas</dt><dd>{data.evidence.resources.released}</dd></div>
     <div><dt>Alocações ativas vencidas</dt><dd>{data.evidence.resources.elapsedActive}</dd></div>
     <div><dt>Apontamentos revertidos</dt><dd>{data.evidence.execution.reversed}</dd></div>
     <div><dt>Execuções sem medição vigente</dt><dd>{data.evidence.execution.pendingMeasurement}</dd></div>
     <div><dt>Medições submetidas</dt><dd>{data.evidence.measurements.submitted}</dd></div>
     <div><dt>Medições aprovadas sem fatura</dt><dd>{data.evidence.measurements.approvedUnbilled}</dd></div>
     <div><dt>Faturas sem recebível</dt><dd>{data.evidence.billing.withoutReceivable}</dd></div>
     <div><dt>Faturas sem lançamento comprovado</dt><dd>{data.evidence.billing.withoutVerifiedPosting}</dd></div>
     <div><dt>Recebimentos sem conciliação bancária</dt><dd>{data.evidence.bank.receiptsWithoutActiveMatch}</dd></div>
     <div><dt>Eventos de custo e estorno</dt><dd>{data.evidence.costs.allocationEvents} / {data.evidence.costs.reversalEvents}</dd></div>
    </dl>
    {data.warnings.map(text=><p key={text}>{text}</p>)}
    <p>Referência UTC: {data.asOf}. *Contribuição parcial não é margem nem lucro.</p>
   </details>
   <ServiceOrderMilestonesPanel orderId={orderId}/>
   <div className="service-order-control-actions">
    <span>Continuidade documental recomendada: <strong>{data.focus}</strong></span>
    <div>{modules.map(module=><button className="secondary" type="button" key={module}
     onClick={()=>open(module)}>{moduleNames[module]} <ArrowRight size={12}/></button>)}</div>
   </div>
  </div>}
 </section>;
}
