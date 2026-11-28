'use client';
import {useEffect,useState} from 'react';
type KPIs={total:number;open:number;intake:number;preparation:number;released:number;executing:number;awaiting_review:number;completed:number;rejected:number;overdue:number};
type Finance={not_measured:number;measurements_draft:number;awaiting_invoice:number;billed:number;billed_cents:string;received_cents:string;open_receivables:number;overdue_receivables:number};
type Exception={needId:string;clientName:string;status:string;priority:string;requestedDate:string;code:string;reason:string};
type FinancialIntegrity={invoiceJournalGaps:number;receiptJournalGaps:number;bankUnmatchedReceipts:number;sampleLimited:boolean;sampleLimit:number;scope:string;note:string};
type Board={kpis:KPIs;finance:Finance;financialIntegrity:FinancialIntegrity;pendingAdditionals:number;exceptions:Exception[];generatedAt:string;note:string};
const format=(value:number|string)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)/100);
export default function ServiceNeedsControlTower({tenantId,onSelect,revision=0}:{
 tenantId:string;onSelect:(needId:string)=>void;revision?:number;
}){
 const [board,setBoard]=useState<Board|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{
  const ac=new AbortController();
  void fetch('/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/control-tower',{
   credentials:'same-origin',cache:'no-store',signal:ac.signal,
  }).then(async r=>{
   const d=await r.json() as Board&{error?:string};
   if(!r.ok)throw Error(d.error??'Indicadores indisponíveis.');
   if(!ac.signal.aborted){setBoard(d);setError('');}
  }).catch(e=>{if(!ac.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.');});
  return()=>ac.abort();
 },[tenantId,reload,revision]);
 return <section className="enterprise-governance-panel" aria-label="Centro de controle operacional e financeiro">
  <div className="form-row"><h3>Centro de controle · operações e exceções</h3>
   <button type="button" onClick={()=>setReload(n=>n+1)}>Revalidar indicadores</button></div>
  <p>Estado real do banco. A execução, o aceite, a medição, a cobrança e a liquidação são etapas independentes.</p>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {!board&&!error&&<p>Consultando indicadores da empresa…</p>}
  {board&&<>
   <div className="enterprise-governance-layout">
    {([
     ['Necessidades abertas',board.kpis.open],['OS em execução',board.kpis.executing],
     ['Aguardando aceite de campo',board.kpis.awaiting_review],['Atrasadas',board.kpis.overdue],
     ['Adicionais sem decisão',board.pendingAdditionals],['Concluídas sem medição',board.finance.not_measured],
     ['Faturas sem diário contábil',board.financialIntegrity.invoiceJournalGaps],
     ['Baixas sem diário íntegro',board.financialIntegrity.receiptJournalGaps],
     ['Recebimentos sem extrato conciliado',board.financialIntegrity.bankUnmatchedReceipts],
     ['Medições em aprovação',board.finance.measurements_draft],['Aprovadas não faturadas',board.finance.awaiting_invoice],['Contas a receber em aberto',board.finance.open_receivables],['Recebíveis vencidos',board.finance.overdue_receivables],
    ] as const).map(([label,value])=><div key={label} className="enterprise-governance-panel">
     <strong>{value}</strong><p>{label}</p>
    </div>)}
   </div>
   <p>{board.financialIntegrity.note}
    {board.financialIntegrity.sampleLimited&&<strong> Amostra limitada a {board.financialIntegrity.sampleLimit} necessidades; não certificar toda a empresa com estes números.</strong>}</p>
   <p><strong>Faturas geradas:</strong> {board.finance.billed} · valor faturado: {format(board.finance.billed_cents)} · recebido: {format(board.finance.received_cents)} · saldo contábil não liquidado: {format(Math.max(0,Number(board.finance.billed_cents)-Number(board.finance.received_cents)))}.</p>
   <details open><summary>Fila de exceções para atuação administrativa · {board.exceptions.length}</summary>
    {!board.exceptions.length&&<p>Sem exceções ativas na amostra consultada.</p>}
    <div role="list" className="enterprise-governance-layout">
     {board.exceptions.map(item=><button type="button" role="listitem" className="secondary" key={item.needId}
      onClick={()=>onSelect(item.needId)}>
      <strong>{item.clientName}</strong>
      <span> · {item.reason}</span>
      <span> · {item.priority} · {item.status} · {item.requestedDate}</span>
     </button>)}
    </div>
   </details>
   <p><small>{board.note} Consultado em {board.generatedAt}.</small></p>
  </>}
 </section>;
}
