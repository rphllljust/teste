'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,BookOpenCheck,Building2,CalendarClock,Landmark,RefreshCw,ShieldCheck,TriangleAlert,Wallet} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';
import {EnterprisePageHeader} from './components/enterprise/EnterprisePrimitives';
import FinancialAgingBoard from './FinancialAgingBoard';

type Drilldown={viewKey:string;filters:Record<string,string>};
type Metric={metricId:string;label:string;value:string|null;count:number;status:string;authority:string;drilldown:Drilldown};
type Snapshot={asOf:string;generatedAt:string;metrics:Metric[];warnings:string[];availableCash:{value:null;reason:string}};
type Reconciliation={summary:{withoutVerifiedPostingCount:number;missingReceivableCount:number}};
type CashAccounting={summary:{unpostedEvents:number}};
type Treasury={items:Array<{accountReference:string;unmatchedCount:number}>;pageInfo:{sourceTotal:number;hasMore:boolean}};
type Assurance={accounting:Reconciliation|null;cash:CashAccounting|null;treasury:Treasury|null};
const metricMoney=(m:Metric)=>m.status==='available'&&m.value!==null?moneyScaled(m.value):'Indisponível';
const verifiedCount=(value:unknown):number|null=>
 typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
async function get<T>(url:string,signal:AbortSignal):Promise<T>{
 const response=await fetch(url,{signal,credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('Consulta protegida indisponível ('+response.status+').');
 return await response.json() as T;
}
type Action={label:string;module:string;description:string;count:number|null;critical:boolean};
export default function FinanceOverviewWorkspace({onDrilldown,onNavigate}:{
 onDrilldown:(d:Drilldown)=>void;onNavigate:(module:string)=>void;
}){
 const [asOf,setAsOf]=useState('');
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [assurance,setAssurance]=useState<Assurance>({accounting:null,cash:null,treasury:null});
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=window.setTimeout(async()=>{
   setLoading(true);setError('');
   const params=asOf?'?'+new URLSearchParams({asOf}):'';
   const [financial,accounting,cash,treasury]=await Promise.allSettled([
    get<Snapshot>('/api/finance/workspace'+params,controller.signal),
    get<Reconciliation>('/api/accounting/reconciliation',controller.signal),
    get<CashAccounting>('/api/accounting/receipt-reconciliation',controller.signal),
    get<Treasury>('/api/treasury?page=1',controller.signal),
   ]);
   if(controller.signal.aborted)return;
   if(financial.status==='fulfilled'&&Array.isArray(financial.value.metrics))setSnapshot(financial.value);
   else {setSnapshot(null);setError('Não foi possível consultar os saldos financeiros autorizados.');}
   setAssurance({
    accounting:accounting.status==='fulfilled'?accounting.value:null,
    cash:cash.status==='fulfilled'?cash.value:null,
    treasury:treasury.status==='fulfilled'?treasury.value:null,
   });
   setLoading(false);
  },0);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[asOf,revision]);
 const invoice=verifiedCount(assurance.accounting?.summary?.withoutVerifiedPostingCount);
 const cash=verifiedCount(assurance.cash?.summary?.unpostedEvents);
 const bank=verifiedCount(assurance.treasury?.pageInfo?.sourceTotal);
 const pendingBank=assurance.treasury?.items.every(a=>verifiedCount(a.unmatchedCount)!==null)?
   assurance.treasury.items.reduce((s,a)=>s+a.unmatchedCount,0):null;
 const actions:Action[]=[
  {label:'Faturas sem diário comprovado',module:'Contabilidade',
   description:'Conferir os documentos e os lançamentos de origem, sem presumir escrituração',
   count:invoice,critical:true},
  {label:'Baixas sem diário vinculado',module:'Caixa e conciliação',
   description:'Conferir eventos financeiros e correspondências contábeis',
   count:cash,critical:true},
  {label:'Linhas bancárias pendentes',module:'Caixa e conciliação',
   description:assurance.treasury?.pageInfo.hasMore?
    'Contagem limitada à primeira página de contas; consultar a fila completa':
    'Contagem da página consultada de contas; não presume conciliação integral',
   count:pendingBank,critical:false},
  {label:'Referências bancárias informadas',module:'Tesouraria',
   description:'Extratos documentados; não representam conexão bancária em tempo real',
   count:bank,critical:false},
 ];
 const knownIssues=actions.slice(0,3).filter(a=>(a.count??0)>0).length;
 return <section className="enterprise-module finance-enterprise finance-tier1-control-tower">
  <EnterprisePageHeader eyebrow="FINANCEIRO E CONTROLADORIA" title="Centro financeiro"
   description="Posição dos títulos, pendências de escrituração e conciliação com origem persistida."/>
  <section className="worklist" aria-busy={loading}>
   <header className="list-title"><div><h2>Controle financeiro e integridade</h2>
    <p>Gestão por exceção: os valores são consultados no escopo autenticado; nenhum saldo é estimado.</p></div>
    <button type="button" className="secondary" disabled={loading}
     onClick={()=>setRevision(n=>n+1)}><RefreshCw size={15}/> Atualizar</button>
   </header>
   <div className="finance-tier1-filter-strip">
    <label>Referência de vencimento
     <input type="date" aria-label="Data de referência financeira" value={asOf}
      onChange={e=>setAsOf(e.target.value)}/></label>
    <span><ShieldCheck size={14}/> Corte: {snapshot?.asOf??'não disponível'}</span>
    <span>Fonte: PostgreSQL · consultas autorizadas</span>
   </div>
   {error&&<div className="finance-tier1-unavailable" role="alert">{error}
    <button type="button" onClick={()=>setRevision(n=>n+1)}>Tentar novamente</button></div>}
   {loading?<div className="finance-tier1-loading" role="status">Consolidando títulos, lançamentos e extratos…</div>:
    <section className="finance-tier1-metric-grid" aria-label="Indicadores financeiros autoritativos">
     {snapshot?.metrics.map((m,i)=><button type="button" key={m.metricId} disabled={m.status!=='available'}
       onClick={()=>onDrilldown(m.drilldown)} title={'Origem: '+m.authority}>
       <span>{i===0||i===1?<Wallet size={16}/>:<CalendarClock size={16}/>}
        {m.label}</span>
       <strong>{metricMoney(m)}</strong>
       <small>{m.count} título(s) · abrir fila autorizada <ArrowRight size={12}/></small>
      </button>)}
    </section>}
   <FinancialAgingBoard asOf={asOf||snapshot?.asOf||''} onDrilldown={onDrilldown} onNavigate={onNavigate}/>
   <div className="finance-tier1-grid">
    <section className="finance-tier1-worklist" aria-label="Filas de exceção e encaminhamento">
     <header><div><h3>Filas de exceção</h3>
      <p>Regularize os documentos nos módulos de origem, com trilha auditável.</p></div>
      <span>{knownIssues} categoria(s) com ocorrência confirmada</span>
     </header>
     <div className="finance-tier1-task-list">
      {actions.map(task=><button key={task.label} type="button"
       onClick={()=>onNavigate(task.module)} className={task.critical&&task.count!==null&&task.count>0?'has-exceptions':''}>
       <span className="finance-tier1-task-icon">
        {task.critical?<TriangleAlert size={17}/>:task.module==='Tesouraria'?<Landmark size={17}/>:<Building2 size={17}/>}
       </span>
       <span className="finance-tier1-task-copy"><strong>{task.label}</strong><small>{task.description}</small></span>
       <span className="finance-tier1-task-number">
        {task.count===null?'Indisponível':String(task.count)}</span>
       <ArrowRight size={15}/>
      </button>)}
     </div>
     {bank===0&&<div className="finance-tier1-no-bank" role="note">
      <TriangleAlert size={15}/> Nenhum extrato informado. As entradas e saídas previstas não constituem saldo bancário disponível.
      <button type="button" onClick={()=>onNavigate('Caixa e conciliação')}>Importar extrato <ArrowRight size={13}/></button>
     </div>}
    </section>
    <aside className="finance-tier1-controlrail" aria-label="Governança financeira">
     <h3><BookOpenCheck size={16}/> Confiabilidade e fechamento</h3>
     <p>Os valores de contas a receber e pagar representam os títulos persistidos. A posição de caixa depende de extratos e conciliação.</p>
     <button type="button" onClick={()=>onNavigate('Fechamentos')}>
      Verificar competência contábil <ArrowRight size={14}/></button>
     <button type="button" onClick={()=>onNavigate('Fluxo de caixa')}>
      Projetado × realizado <ArrowRight size={14}/></button>
     <button type="button" onClick={()=>onNavigate('Razão contábil')}>
      Consultar razão <ArrowRight size={14}/></button>
     <small>Fechamento financeiro e certificação Tier 1 são avaliações diferentes. A ausência de alertas não autoriza transições.</small>
    </aside>
   </div>
   <footer className="table-footer">
    <span>{!loading&&snapshot&&!error?'Consulta: '+new Date(snapshot.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Porto_Velho'}):'Consulta financeira indisponível'}</span>
    <span>Moeda BRL · sem saldo bancário presumido</span>
   </footer>
  </section>
 </section>;
}
