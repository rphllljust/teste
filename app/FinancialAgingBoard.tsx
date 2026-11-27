'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,Clock3,Landmark,ShieldAlert,Wallet} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';

type BucketCode='not_due'|'overdue_1_30'|'overdue_31_60'|'overdue_61_90'|'overdue_91_plus';
type Bucket={bucket:BucketCode;count:number;valueScaled:string};
type Portfolio={buckets:Bucket[];authority:string};
type Report={
 asOf:string;generatedAt:string;basis:string;
 receivables:Portfolio;payables:Portfolio;
 bankCoverage:{accountCount:number;pendingLines:number;staleAccounts:number;
 latestStatementEnd:string|null;reportedBalanceScaled:string|null;
 availableCashScaled:null;consolidated:false};
 warnings:string[];
};
type Drilldown={viewKey:string;filters:Record<string,string>};
const names:Record<BucketCode,string>={
 not_due:'A vencer',overdue_1_30:'Vencidos 1–30 dias',
 overdue_31_60:'Vencidos 31–60 dias',
 overdue_61_90:'Vencidos 61–90 dias',
 overdue_91_plus:'Vencidos há mais de 90 dias',
};
const day=(date:string,offset:number)=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const display=(scaled:string|null)=>scaled===null?'Indisponível':
 scaled.startsWith('-')?'−'+moneyScaled(scaled.slice(1)):moneyScaled(scaled);
function bounds(asOf:string,bucket:BucketCode):Record<string,string>{
 switch(bucket){
  case 'not_due':return {dueFrom:asOf};
  case 'overdue_1_30':return {dueFrom:day(asOf,-30),dueTo:day(asOf,-1)};
  case 'overdue_31_60':return {dueFrom:day(asOf,-60),dueTo:day(asOf,-31)};
  case 'overdue_61_90':return {dueFrom:day(asOf,-90),dueTo:day(asOf,-61)};
  case 'overdue_91_plus':return {dueTo:day(asOf,-91)};
 }
}
export default function FinancialAgingBoard({asOf,onDrilldown,onNavigate}:{
 asOf:string;onDrilldown:(view:Drilldown)=>void;onNavigate:(module:string)=>void;
}){
 const [data,setData]=useState<Report|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setLoading(true);setError('');
   try{
    const params=asOf?'?'+new URLSearchParams({asOf}).toString():'';
    const response=await fetch('/api/finance/aging'+params,{
     credentials:'same-origin',cache:'no-store',signal:controller.signal,
    });
    const body=await response.json() as Report&{error?:string};
    if(!response.ok||!body.receivables||!body.payables)throw Error(body.error??'Posição financeira indisponível.');
    if(!controller.signal.aborted)setData(body);
   }catch(e){if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:'Posição financeira indisponível.');}}
   finally{if(!controller.signal.aborted)setLoading(false);}
  },0);
  return()=>{clearTimeout(timer);controller.abort();};
 },[asOf,refresh]);
 const drill=(kind:'receivables'|'payables',bucket:BucketCode)=>{
  if(!data)return;
  onDrilldown({
   viewKey:kind==='receivables'?'operation.receivables':'payables.worklist',
   filters:{
    ...(kind==='receivables'?{settlementState:'outstanding'}:{state:'outstanding'}),
    sort:'dueDate.asc',...bounds(data.asOf,bucket),
   },
  });
 };
 const matrix=(kind:'receivables'|'payables',portfolio:Portfolio)=>{
  const total=portfolio.buckets.reduce((n,b)=>n+BigInt(b.valueScaled),0n);
  const overdue=portfolio.buckets.filter(b=>b.bucket!=='not_due');
  const overdueTotal=overdue.reduce((n,b)=>n+BigInt(b.valueScaled),0n);
  return <section className="finance-tier1-aging-card" aria-label={kind==='receivables'?'Aging de recebíveis':'Aging de obrigações'}>
   <header><div><span className="finance-tier1-aging-eyebrow">{kind==='receivables'?'CONTAS A RECEBER':'CONTAS A PAGAR'}</span>
    <h3>{display(String(total))}</h3>
    <p>Saldo atual · vencidos {display(String(overdueTotal))}</p></div>
    {kind==='receivables'?<Wallet size={20}/>:<Clock3 size={20}/>}
   </header>
   <div className="finance-tier1-aging-bars">
    {portfolio.buckets.map(b=>{
     const ratio=total===0n?0:Number(BigInt(b.valueScaled)*1000n/total)/10;
     return <button key={b.bucket} type="button" disabled={b.count===0}
      onClick={()=>drill(kind,b.bucket)} title={'Abrir '+names[b.bucket]+' nos títulos autorizados'}>
      <span className="finance-tier1-aging-label"><span>{names[b.bucket]}</span><strong>{display(b.valueScaled)}</strong></span>
      <span className="finance-tier1-aging-track"><span style={{width:ratio+'%'}}/></span>
      <span className="finance-tier1-aging-foot"><small>{b.count} título(s)</small><small>{ratio.toLocaleString('pt-BR',{maximumFractionDigits:1})}% · abrir</small></span>
     </button>;
    })}
   </div>
  </section>;
 };
 return <section className="finance-tier1-aging-board" aria-label="Análise de vencimentos e liquidez documental" aria-busy={loading}>
  <header className="finance-tier1-aging-heading"><div>
   <strong>Controladoria · exposição e envelhecimento dos títulos</strong>
   <p>Aging de carteira, cobrança, pagamento e cobertura bancária. Todas as posições são consultadas no proprietário autenticado.</p>
  </div><button type="button" className="secondary" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>
   Recalcular posição</button></header>
  {loading?<div className="finance-tier1-loading" role="status">Consolidando a carteira autorizada…</div>:
   error?<div className="finance-tier1-unavailable" role="alert">{error}</div>:
   data&&<><div className="finance-tier1-aging-columns">
    {matrix('receivables',data.receivables)}
    {matrix('payables',data.payables)}
   </div>
   <div className="finance-tier1-aging-bank" role="region" aria-label="Cobertura documental de tesouraria">
    <div><Landmark size={18}/><span><strong>Tesouraria · extratos de referência</strong>
     <small>{data.bankCoverage.accountCount} referência(s) · Último corte {data.bankCoverage.latestStatementEnd??'não informado'}</small></span></div>
    <div><span className="finance-tier1-aging-eyebrow">Soma informativa dos últimos extratos</span>
     <strong>{display(data.bankCoverage.reportedBalanceScaled)}</strong>
     <small>Não representa disponibilidade bancária, nem saldo conciliado.</small></div>
    <div><ShieldAlert size={17}/><span><strong>{data.bankCoverage.pendingLines} linha(s) por conciliar</strong>
     <small>{data.bankCoverage.staleAccounts} conta(s) com extrato defasado ou futuro.</small></span></div>
    <button type="button" onClick={()=>onNavigate('Caixa e conciliação')}>
     Conferir extratos <ArrowRight size={14}/></button>
   </div>
   <p className="finance-tier1-aging-source">Referência {data.asOf} · Saldos atuais classificados pelo vencimento, não reconstrução histórica. Valores monetários em escala de quatro casas. {data.warnings.join(' ')}</p>
  </>}
 </section>;
}
