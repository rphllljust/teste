'use client';

import { useState } from 'react';
import { ArrowRight, CalendarCheck2, CircleAlert, LoaderCircle } from 'lucide-react';

type Tier1Blocker = {code:string;count:number};
type Preflight = {
  periodStart:string;periodEnd:string;
  tier1Readiness:{ready:boolean;status:'ready'|'blocked';blockers:Tier1Blocker[]};
  advisoryOnly:boolean;
};
const titles:Record<string,string>={
 invoicesWithoutVerifiedPosting:'Faturas sem diário comprovado',
 invalidCashLinks:'Baixas com vínculo contábil inconsistente',
 invalidPayableLinks:'Obrigações com lançamento inconsistente',
 invalidPayablePaymentLinks:'Pagamentos com lançamento inconsistente',
 unpostedCashEvents:'Baixas sem diário contábil',
 unpostedPayables:'Obrigações sem diário contábil',
 unpostedPayablePayments:'Pagamentos sem diário contábil',
};
function currentMonth(){
 const d=new Date();
 const year=d.getFullYear(),month=d.getMonth()+1;
 const monthText=String(month).padStart(2,'0');
 const end=String(new Date(year,month,0).getDate()).padStart(2,'0');
 return {start:`${year}-${monthText}-01`,end:`${year}-${monthText}-${end}`,label:`${monthText}/${year}`};
}
export default function EnterpriseCloseReadiness({navigate}:{
 navigate:(module:string)=>void;
}){
 const [result,setResult]=useState<Preflight|null>(null);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const [period,setPeriod]=useState('');
 async function run(){
  if(pending)return;
  const month=currentMonth();
  setPending(true);setError('');setResult(null);setPeriod(month.label);
  try{
   const response=await fetch('/api/finance/periods/preflight?'+new URLSearchParams({
    periodStart:month.start,periodEnd:month.end,
   }).toString(),{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Conferência indisponível ('+response.status+').');
   const payload:Preflight=await response.json();
   if(!payload.tier1Readiness||!Array.isArray(payload.tier1Readiness.blockers))
    throw Error('O servidor não retornou a prontidão estrita de competência.');
   setResult(payload);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível verificar a competência.');}
  finally{setPending(false);}
 }
 return <section className="cisne-close-readiness" aria-label="Pré-fechamento contábil estrito">
  <div className="cisne-close-readiness-top">
   <div><CalendarCheck2 size={18}/><strong>Prontidão contábil Tier 1</strong>
    <small>Validação estrita da competência atual, sem alterar lançamentos</small></div>
   <button type="button" disabled={pending} onClick={()=>void run()}>
    {pending?<LoaderCircle size={15}/>:<CalendarCheck2 size={15}/>}
    {pending?'Conferindo…':'Verificar competência'}
   </button>
  </div>
  {error&&<p className="cisne-close-error" role="alert"><CircleAlert size={14}/>{error}</p>}
  {result&&<div className="cisne-close-result" role="status">
   <p><strong>{period} · {result.tier1Readiness.ready?'Sem bloqueadores detectados':'Pendências de escrituração'}</strong>
    <span>{result.tier1Readiness.ready?'A prontidão estrita não detectou pendências neste escopo. Isso não substitui a autorização de fechamento.':
     'Não certificar fechamento contábil Tier 1 enquanto persistirem as pendências listadas.'}</span></p>
   {result.tier1Readiness.blockers.length>0&&<ul>{result.tier1Readiness.blockers.map(item=>
    <li key={item.code}><span>{titles[item.code]??item.code}</span><strong>{item.count}</strong></li>)}</ul>}
   <button type="button" onClick={()=>navigate('Fechamentos')}>Abrir fechamentos <ArrowRight size={14}/></button>
  </div>}
  {!result&&!error&&!pending&&<p>Conferência sob demanda: não apresenta saldos presumidos nem executa fechamento automático.</p>}
 </section>;
}
