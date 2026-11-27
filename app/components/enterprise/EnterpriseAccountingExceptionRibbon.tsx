'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CircleAlert, ShieldCheck } from 'lucide-react';

type Reconciliation={summary?:{withoutVerifiedPostingCount?:number}};
type Receipts={summary?:{unpostedEvents?:number}};
type Snapshot={invoices:number|null;receipts:number|null};

async function count<T>(url:string,key:'withoutVerifiedPostingCount'|'unpostedEvents',signal:AbortSignal):Promise<number>{
 const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal});
 if(!response.ok)throw Error('Accounting read unavailable');
 const payload=await response.json() as T;
 const summary=(payload as Reconciliation|Receipts).summary as Record<string,unknown>|undefined;
 const n=summary?.[key];
 if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)throw Error('Accounting metric invalid');
 return n;
}

/** Advisory only: records come from authenticated accounting reconciliation APIs.
 * Missing/unauthorized metrics are unknown, never silently displayed as zero.
 */
export default function EnterpriseAccountingExceptionRibbon({revision,onOpen}:{
 revision:number;onOpen:()=>void;
}){
 const [snapshot,setSnapshot]=useState<Snapshot>({invoices:null,receipts:null});
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=window.setTimeout(async()=>{
   setLoading(true);
   const [invoices,receipts]=await Promise.allSettled([
    count<Reconciliation>('/api/accounting/reconciliation','withoutVerifiedPostingCount',controller.signal),
    count<Receipts>('/api/accounting/receipt-reconciliation','unpostedEvents',controller.signal),
   ]);
   if(controller.signal.aborted)return;
   setSnapshot({
    invoices:invoices.status==='fulfilled'?invoices.value:null,
    receipts:receipts.status==='fulfilled'?receipts.value:null,
   });
   setLoading(false);
  },0);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[revision]);
 const detected=(snapshot.invoices??0)+(snapshot.receipts??0);
 const unknown=snapshot.invoices===null||snapshot.receipts===null;
 return <section className="cisne-accounting-exception-ribbon"
  data-state={loading?'loading':detected>0?'warning':unknown?'unknown':'clear'}
  aria-label="Sinais de integridade contábil">
  <span className="cisne-accounting-exception-heading">
   {detected>0?<CircleAlert size={16}/>:<ShieldCheck size={16}/>}
   <strong>Integridade contábil</strong>
  </span>
  <span className="cisne-accounting-exception-message" aria-live="polite">
   {loading?'Conferindo vínculos contabilizados…':
    <>{snapshot.invoices===null?'Faturas: indisponível':snapshot.invoices+' faturas sem diário validado'}
      <span aria-hidden="true"> · </span>
      {snapshot.receipts===null?'Baixas: indisponível':snapshot.receipts+' baixas sem diário vinculado'}
      {!detected&&!unknown?' · Sem exceções detectadas nesta consulta; não certifica fechamento.':''}
    </>}
  </span>
  <button type="button" onClick={onOpen}>Verificar na Controladoria <ArrowRight size={14}/></button>
 </section>;
}
