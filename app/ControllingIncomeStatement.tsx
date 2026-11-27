'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,BookOpenCheck,RefreshCw} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';
type Account={id:string;code:string;name:string;type:'revenue'|'expense';
 currentScaled:string;priorScaled:string;currentLineCount:number;priorLineCount:number};
type Report={periodMonth:string;priorMonth:string;accounts:Account[];
 totals:{revenueScaled:string;expenseScaled:string;netScaled:string;
  priorRevenueScaled:string;priorExpenseScaled:string;priorNetScaled:string;netChangeScaled:string;
  currentLineCount:number;priorLineCount:number;accountCount:number};
 emptyState:'no_classified_accounts'|'no_postings'|null;warnings:string[];source:string;generatedAt:string;error?:string};
const signed=(v:string)=>v.startsWith('-')?'−'+moneyScaled(v.slice(1)):moneyScaled(v);
const toDate=(month:string)=>{
 const [y,m]=month.split('-').map(Number);
 return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
};
export default function ControllingIncomeStatement({onLedgerAccount,onNavigate}:{
 onLedgerAccount:(id:string,from:string,to:string)=>void;onNavigate:(module:string)=>void;
}){
 const [month,setMonth]=useState(()=>new Date().toISOString().slice(0,7));
 const [data,setData]=useState<Report|null>(null),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [showZero,setShowZero]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setLoading(true);setError('');
   try{
    const res=await fetch('/api/controlling/income-statement?'+new URLSearchParams({periodMonth:month}),
     {signal:controller.signal,credentials:'same-origin',cache:'no-store'});
    const body=await res.json() as Report;
    if(!res.ok||!body.totals)throw Error(body.error??'DRE gerencial indisponível.');
    if(!controller.signal.aborted)setData(body);
   }catch(cause){if(!controller.signal.aborted){setData(null);setError(cause instanceof Error?cause.message:'Consulta indisponível.');}}
   finally{if(!controller.signal.aborted)setLoading(false);}
  },0);
  return()=>{clearTimeout(timer);controller.abort();};
 },[month,revision]);
 const list=(kind:'revenue'|'expense')=>(data?.accounts??[]).filter(a=>
   a.type===kind&&(showZero||a.currentLineCount>0||a.priorLineCount>0));
 return <section className="finance-income-report" aria-label="DRE gerencial comparativa" aria-busy={loading}>
  <header className="finance-income-header">
   <div><h2><BookOpenCheck size={16}/> DRE gerencial comparativa</h2>
    <p>Receitas e despesas das partidas contábeis publicadas, por competência. Não representa lucro fiscal certificado.</p></div>
   <div className="finance-income-tools">
    <label>Competência <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
     aria-label="Competência da DRE gerencial"/></label>
    <button type="button" className="secondary" disabled={loading}
     onClick={()=>setRevision(n=>n+1)}><RefreshCw size={14}/> Atualizar</button>
   </div>
  </header>
  {loading?<div role="status" className="finance-tier1-loading">Consolidando os diários publicados…</div>:
   error?<div role="alert" className="finance-tier1-unavailable">{error}</div>:data&&<>
    <div className="finance-income-metrics" aria-label="Resultado do período e comparação">
     <div><span>Receitas reconhecidas</span><strong>{signed(data.totals.revenueScaled)}</strong></div>
     <div><span>Despesas reconhecidas</span><strong>{signed(data.totals.expenseScaled)}</strong></div>
     <div><span>Resultado gerencial</span><strong>{signed(data.totals.netScaled)}</strong></div>
     <div><span>Resultado mês anterior ({data.priorMonth})</span><strong>{signed(data.totals.priorNetScaled)}</strong></div>
    </div>
    {data.emptyState&&<p className="finance-income-empty" role="status">
     {data.emptyState==='no_classified_accounts'?
       'Não existem contas classificadas como receita ou despesa no plano de contas autorizado.':
       'Nenhuma partida contábil foi publicada nos dois meses analisados. Os zeros acima não representam DRE certificada.'}
     <button type="button" onClick={()=>onNavigate('Contabilidade')}>Abrir Contabilidade</button>
    </p>}
    <div className="finance-income-controlbar">
     <span>{data.totals.currentLineCount} linhas publicadas na competência · {data.totals.priorLineCount} na anterior</span>
     <label><input type="checkbox" checked={showZero} onChange={e=>setShowZero(e.target.checked)}/> Mostrar contas sem movimento</label>
    </div>
    <div className="finance-income-tables">
    {(['revenue','expense'] as const).map(kind=><section key={kind}
      aria-label={kind==='revenue'?'Receitas contábeis':'Despesas contábeis'}>
     <h3>{kind==='revenue'?'Receitas operacionais classificadas':'Despesas classificadas'}</h3>
     {list(kind).length?
      <div className="table-wrap"><table><thead><tr><th>Conta</th><th>{data.priorMonth}</th><th>{data.periodMonth}</th><th>Origem</th></tr></thead>
      <tbody>{list(kind).map(a=><tr key={a.id}><td><strong>{a.code}</strong> · {a.name}</td>
       <td className="amount">{signed(a.priorScaled)}</td><td className="amount">{signed(a.currentScaled)}</td>
       <td><button type="button" className="row-link" onClick={()=>onLedgerAccount(a.id,data.periodMonth+'-01',toDate(data.periodMonth))}>
        Razão <ArrowRight size={12}/></button></td></tr>)}</tbody></table></div>:
      <p className="finance-income-empty-small">Nenhuma conta com movimento nesta classificação.</p>}
    </section>)}
    </div>
    <details className="finance-source-disclosure">
     <summary>Proveniência, limites e regras de contabilização</summary>
     <p>{data.source}. {data.warnings.join(' ')}</p>
    </details>
   </>}
 </section>;
}
