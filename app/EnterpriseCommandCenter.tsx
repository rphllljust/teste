'use client';
import {useState} from 'react';
import {ArrowRight, Map as MapIcon} from 'lucide-react';
import EnterpriseOperationsWorkbench from './EnterpriseOperationsWorkbench';
import EnterpriseExceptionCenter from './EnterpriseExceptionCenter';
type Props={summary:{total:number;drafts:number;planned:number;pendingMeasurements:number};navigate:(name:string,orderId?:string)=>void;onCreate:()=>void;onOpenOrder:(id:string)=>void;onCommandOrder?:(id:string,commandId:string)=>void};

const enterpriseJourney = [
 {module:'Clientes e propostas',label:'Clientes e propostas',detail:'origem comercial'},
 {module:'Contratos',label:'Contratos',detail:'compromisso formal'},
 {module:'Ordens de serviço',label:'Ordens de serviço',detail:'demanda autorizada'},
 {module:'Execução',label:'Execução',detail:'produção operacional'},
 {module:'Medições',label:'Medições',detail:'evidências de execução'},
 {module:'Faturamento',label:'Faturamento',detail:'cobrança documental'},
 {module:'Caixa e conciliação',label:'Caixa e conciliação',detail:'movimentação e conferência'},
 {module:'Contabilidade',label:'Contabilidade',detail:'escrituração e controles'},
] as const;

const enterpriseContinuityActions = [
 {module:'CRM e Vendas',label:'Oportunidades e CRM'},
 {module:'Propostas e PO',label:'Propostas e pedidos'},
 {module:'Tesouraria',label:'Tesouraria'},
 {module:'Fechamentos',label:'Fechamento contábil'},
 {module:'Dossiês empresariais',label:'Rastrear processo completo'},
] as const;

export default function EnterpriseCommandCenter({navigate,onCreate,onOpenOrder,onCommandOrder}:Props){
 const [showMap,setShowMap]=useState(false);
 return <section className="enterprise-command-center enterprise-command-center-v2" aria-label="Centro de comando empresarial">
  <EnterpriseOperationsWorkbench navigate={navigate} onCreate={onCreate} onOpenOrder={onOpenOrder} onCommandOrder={onCommandOrder}/>
  <EnterpriseExceptionCenter navigate={navigate} onOpenOrder={onOpenOrder}/>
  <section className="enterprise-command-navigation" aria-labelledby="enterprise-command-map-title">
   <div className="enterprise-command-navigation-heading">
    <div><span className="eyebrow">PROCESSOS EMPRESARIAIS</span>
     <h2 id="enterprise-command-map-title">Jornada comercial ao fechamento</h2>
     <p>Os comandos e os documentos permanecem disponíveis nos módulos de origem.</p>
    </div>
    <button className="secondary" type="button" aria-expanded={showMap}
      onClick={()=>setShowMap(current=>!current)}>
      <MapIcon size={16}/> {showMap?'Recolher mapa':'Abrir mapa de processos'} <ArrowRight size={14}/>
    </button>
   </div>
   {showMap&&<div className="enterprise-command-navigation-content">
    <p className="enterprise-value-note">A navegação não significa que uma transação foi concluída.</p>
    <nav className="value-stream" aria-label="Jornada empresarial entre módulos">
     {enterpriseJourney.map((step,i)=><button type="button" key={step.module}
       onClick={()=>navigate(step.module)} aria-label={'Abrir '+step.label}>
      <span>{String(i+1).padStart(2,'0')}</span><strong>{step.label}</strong>
      <small>{step.detail}</small>{i<enterpriseJourney.length-1&&<ArrowRight size={15}/>}
     </button>)}
    </nav>
    <div className="enterprise-journey-complements" role="group" aria-label="Acessos complementares da jornada">
     {enterpriseContinuityActions.map(action=><button type="button" className="secondary" key={action.module}
       onClick={()=>navigate(action.module)}>{action.label} <ArrowRight size={14}/></button>)}
    </div>
   </div>}
  </section>
 </section>;
}
