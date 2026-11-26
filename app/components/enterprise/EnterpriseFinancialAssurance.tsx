'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, BookOpenCheck, CircleAlert, Wallet } from 'lucide-react';

type FinanceMetric={metricId:string;value:string|null;status:'available'|'unknown'};
type FinanceData={metrics:FinanceMetric[];generatedAt:string};
type Reconciliation={summary:{withoutVerifiedPostingCount:number;missingReceivableCount:number}};
type Cash={summary:{unpostedEvents:number}};
type Result={finance:FinanceData|null;accounting:Reconciliation|null;cash:Cash|null};
const money=(scaled:string|null|undefined)=>{
 if(scaled==null||!/^-?\d+$/.test(scaled))return 'Indisponível';
 try {
  const n=BigInt(scaled);
  const minus=n<0n?'-':'';
  const abs=n<0n?-n:n;
  const cents=(abs+50n)/100n;
  return minus+'R$ '+new Intl.NumberFormat('pt-BR').format(cents/100n)+','+String(cents%100n).padStart(2,'0');
 }catch{return 'Indisponível';}
};
const unknown='—';
const get=async<T,>(url:string,signal:AbortSignal):Promise<T>=>{
 const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal});
 if(!response.ok)throw Error('Consulta protegida indisponível: '+response.status);
 return response.json() as Promise<T>;
};
export default function EnterpriseFinancialAssurance({navigate}:{
 navigate:(module:string)=>void
}){
 const [data,setData]=useState<Result>({finance:null,accounting:null,cash:null});
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  const abort=new AbortController();
  const run=async()=>{
   const [finance,accounting,cash]=await Promise.allSettled([
    get<FinanceData>('/api/finance/workspace',abort.signal),
    get<Reconciliation>('/api/accounting/reconciliation',abort.signal),
    get<Cash>('/api/accounting/receipt-reconciliation',abort.signal),
   ]);
   if(abort.signal.aborted)return;
   setData({
    finance:finance.status==='fulfilled'?finance.value:null,
    accounting:accounting.status==='fulfilled'?accounting.value:null,
    cash:cash.status==='fulfilled'?cash.value:null,
   });
   setLoading(false);
  };
  void run();
  return()=>abort.abort();
 },[]);
 const metric=(id:string)=>{
  const found=data.finance?.metrics.find(item=>item.metricId===id);
  return found?.status==='available'?money(found.value):unknown;
 };
 const missingAccounting=data.accounting?.summary.withoutVerifiedPostingCount;
 const unpostedCash=data.cash?.summary.unpostedEvents;
 const issues=(missingAccounting??0)+(unpostedCash??0);
 return <section className="cisne-finance-assurance" aria-label="Integração financeira e contábil">
  <header><div><BookOpenCheck size={17}/><strong>Gestão econômica e integridade contábil</strong>
   <span>Consultas autenticadas aos registros de Finanças, Faturamento e Contabilidade</span></div>
   <button type="button" onClick={()=>navigate('Visão financeira')}>Visão financeira <ArrowRight size={14}/></button>
  </header>
  <div className="cisne-finance-assurance-grid">
   <button type="button" onClick={()=>navigate('Financeiro')}>
    <Wallet size={16}/><span>Contas a receber</span><strong>{metric('receivables.outstanding')}</strong><small>Saldo de títulos persistidos</small>
   </button>
   <button type="button" onClick={()=>navigate('Contas a pagar')}>
    <Wallet size={16}/><span>Contas a pagar</span><strong>{metric('payables.outstanding')}</strong><small>Saldo de obrigações persistidas</small>
   </button>
   <button type="button" onClick={()=>navigate('Contabilidade')}>
    <CircleAlert size={16}/><span>Faturas sem diário validado</span>
    <strong>{missingAccounting??unknown}</strong><small>{missingAccounting===0?'Nenhuma pendência identificada':'Conferir vínculos de escrituração'}</small>
   </button>
   <button type="button" onClick={()=>navigate('Caixa e conciliação')}>
    <CircleAlert size={16}/><span>Baixas sem diário vinculado</span>
    <strong>{unpostedCash??unknown}</strong><small>{unpostedCash===0?'Nenhuma pendência identificada':'Legado ou lançamento não apropriado'}</small>
   </button>
  </div>
  <p className={issues>0?'cisne-finance-assurance-warning':''}>
   {loading?'Consultando indicadores com autorização do usuário…':
    !data.finance&&!data.accounting&&!data.cash?'As consultas financeiras estão indisponíveis. Nenhum valor foi presumido.':
    issues>0?'Atenção: existem registros com escrituração não comprovada. Não inferir contabilização por haver uma fatura ou um recebimento.':
    'Indicadores limitados ao escopo autenticado. Ausência de pendências exibidas não certifica fechamento ou conciliação integral.'}
  </p>
 </section>;
}
