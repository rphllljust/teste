'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,AlertTriangle,RefreshCw,ShieldCheck} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';
type Category='all'|'procurement'|'operations'|'measurements'|'billing'|'accounting'|'receivables'|'payables'|'treasury';
type Finding={id:string;category:Category;code:string;severity:'warning'|'critical';
 title:string;orderId:string|null;module:string;date:string;amountScaled:string};
type ResponseData={asOf:string;items:Finding[];
 summary:{total:number;allOpen:number;byCategory:{category:Category;total:number}[]};
 pageInfo:{page:number;hasMore:boolean};warnings:string[];error?:string};
const labels:Record<Category,string>={all:'Todos os domínios',procurement:'Compras',operations:'Operações',measurements:'Medições',
 billing:'Faturamento',accounting:'Contabilidade',receivables:'Recebíveis',payables:'Contas a pagar',treasury:'Bancos'};
const descriptions:Record<string,string>={
 PURCHASE_ORDER_LATE:'Pedido aprovado com prazo previsto ultrapassado e recebimento não concluído',
 COMPLETED_WITHOUT_MEASUREMENT:'Ordem concluída sem medição ativa (medições canceladas não encerram a pendência)',
 MEASUREMENT_PENDING_APPROVAL:'Medição em rascunho ou submetida, aguardando aprovação formal',
 EXECUTION_NOT_MEASURED:'Apontamento de execução ativo sem medição válida vinculada',
 APPROVED_UNBILLED:'Medição aprovada sem faturamento vinculado',
 INVOICE_WITHOUT_RECEIVABLE:'Fatura registrada sem título a receber vinculado',
 INVOICE_JOURNAL_UNVERIFIED:'Fatura sem diário publicado e não estornado comprovado',
 RECEIVABLE_OVERDUE:'Título a receber com saldo aberto após vencimento',
 PAYABLE_OVERDUE:'Obrigação a pagar com saldo aberto após vencimento',
 BANK_LINE_UNMATCHED:'Linha de extrato importado sem conciliação bancária ativa',
};
const money=(v:string)=>v.startsWith('-')?'−'+moneyScaled(v.slice(1)):moneyScaled(v);
export default function EnterpriseExceptionCenter({navigate,onOpenOrder}:{
 navigate:(name:string,orderId?:string)=>void;onOpenOrder:(id:string)=>void;
}){
 const [open,setOpen]=useState(false);
 const [category,setCategory]=useState<Category>('all'),[page,setPage]=useState(1);
 const [revision,setRevision]=useState(0),[asOf,setAsOf]=useState('');
 const [data,setData]=useState<ResponseData|null>(null),[error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setLoading(true);setError('');
   try{
    const params=new URLSearchParams({category,page:String(page),...(asOf?{asOf}:{})});
    const response=await fetch('/api/enterprise/exceptions?'+params,
     {credentials:'same-origin',cache:'no-store',signal:controller.signal});
    const body=await response.json() as ResponseData;
    if(!response.ok||!body.summary)throw Error(body.error??'Fila empresarial indisponível.');
    if(!controller.signal.aborted)setData(body);
   }catch(e){if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:'Fila indisponível.');}}
   finally{if(!controller.signal.aborted)setLoading(false);}
  },0);
  return()=>{clearTimeout(timer);controller.abort();};
 },[category,page,asOf,revision]);
 return <section className="enterprise-exception-center" aria-label="Fila transversal de exceções empresariais">
  <header className="enterprise-exception-heading">
   <div><span className="eyebrow">CONTROLE TRANSVERSAL</span><h2>
    <AlertTriangle size={16}/> Pendências entre módulos
    {data&&<small>{data.summary.allOpen} ocorrência(s) documentada(s)</small>}</h2>
    <p>Compras → execução → medição → faturamento → financeiro → bancos → contabilidade.</p>
   </div>
   <div><button className="secondary" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
    {open?'Recolher fila':'Inspecionar fila'} <ArrowRight size={14}/></button>
    <button type="button" className="secondary" disabled={loading} aria-label="Atualizar pendências empresariais"
     onClick={()=>setRevision(n=>n+1)}><RefreshCw size={14}/></button></div>
  </header>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {open&&<div className="enterprise-exception-body">
   <div className="enterprise-exception-filters">
    <label>Área<select value={category} onChange={e=>{setCategory(e.target.value as Category);setPage(1);}}>
     {Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></label>
    <label>Vencimento de referência<input type="date" value={asOf} onChange={e=>{setAsOf(e.target.value);setPage(1);}}/></label>
    <span>{data?.summary.total??0} ocorrência(s) neste filtro</span>
   </div>
   {loading?<p role="status" className="finance-tier1-loading">Auditando documentos e vínculos autorizados…</p>:
    data&&<>
     <div className="enterprise-exception-facets" aria-label="Ocorrências por domínio">
      {data.summary.byCategory.map(a=><button key={a.category} type="button"
       onClick={()=>{setCategory(a.category);setPage(1);}}>
       {labels[a.category]??a.category}<strong>{a.total}</strong></button>)}
     </div>
     {data.items.length?<div className="table-wrap"><table>
      <thead><tr><th>Documento e ocorrência</th><th>Área</th><th>Referência</th><th>Valor documental</th><th>Ação contextual</th></tr></thead>
      <tbody>{data.items.map(x=><tr key={x.category+'-'+x.code+'-'+x.id}>
       <td><strong>{x.title}</strong><small>{descriptions[x.code]??x.code}</small></td>
       <td>{labels[x.category]??x.category}</td>
       <td>{x.date??'—'}</td><td className="amount">{money(x.amountScaled)}</td>
       <td><button type="button" className="row-link"
        onClick={()=>x.orderId?onOpenOrder(x.orderId):navigate(x.module)}>
        {x.orderId?'Abrir OS e dossiê':'Abrir '+x.module} <ArrowRight size={12}/></button></td>
      </tr>)}</tbody></table></div>:
      <p className="enterprise-exception-empty"><ShieldCheck size={16}/>
       Nenhuma ocorrência documentada para os filtros selecionados.</p>}
     <footer className="enterprise-exception-footer"><span>Página {page} · {data.summary.total} ocorrência(s)</span>
      <div><button disabled={page===1} onClick={()=>setPage(n=>n-1)}>Anterior</button>
      <button disabled={!data.pageInfo.hasMore} onClick={()=>setPage(n=>n+1)}>Próxima</button></div>
     </footer>
     <details className="finance-source-disclosure"><summary>Escopo e ressalvas da fila</summary>
      {data.warnings.map(w=><p key={w}>{w}</p>)}
     </details>
    </>}
  </div>}
 </section>;
}
