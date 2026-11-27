'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,FileDown,RefreshCw,Search,ShieldAlert} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';

type Phase='draft'|'cancelled'|'receiving'|'document'|'accounting'|'payment'|'bank'|'exception'|'verified';
type Row={
 id:string;reference:string;supplier:string;status:string;expectedOn:string|null;
 payableDueOn:string|null;severity:'overdue'|'today'|'soon'|'none';
 alerts:string[];delivery:{state:string;daysUntil:number|null};payment:{state:string;daysUntil:number|null};
 payableId:string|null;invoiceId:string|null;phase:Phase;flags:string[];
 orderScaled:string;payableScaled:string;paidScaled:string;outstandingScaled:string;
 attributedScaled:string;orderedQuantity:string;acceptedQuantity:string;
 accrualVerified:boolean;unmatchedPayments:number;
};
type Response={
 items:Row[];pageInfo:{page:number;pageSize:number;total:number;hasMore:boolean};
 summary:{pageOrders:number;pageDocumentExceptions:number;pageDeliveryOverdue:number;
 pagePaymentOverdue:number;pagePurchaseScaled:string;
 pageOutstandingScaled:string;pageAttributedScaled:string};
 warnings:string[];generatedAt:string;error?:string
};
const money=(s:string)=>s.startsWith('-')?'−'+moneyScaled(s.slice(1)):moneyScaled(s);
const phases:Record<Phase,string>={
 draft:'Em preparação',cancelled:'Cancelado',receiving:'Recebimento pendente',
 document:'Documento pendente',accounting:'Escrituração pendente',
 payment:'Saldo a pagar',bank:'Banco não conciliado',exception:'Divergência documental',
 verified:'Evidências conferidas'
};
const flags:Record<string,string>={
 PURCHASE_LINES_MISSING:'Pedido sem itens',
 RECEIPT_INCOMPLETE:'Quantidade recebida inferior à solicitada',
 RECEIPT_EXCEEDS_ORDER:'Quantidade aceita superior à solicitada',
 SUPPLIER_DOCUMENT_PENDING:'Documento do fornecedor pendente',
 PAYABLE_LINK_MISSING:'Obrigação financeira não vinculada',
 DOCUMENT_AP_AMOUNT_MISMATCH:'Documento e título financeiro divergentes',
 ACCOUNTING_UNVERIFIED:'Reconhecimento contábil não comprovado',
 BANK_MATCH_UNVERIFIED:'Pagamento sem correspondência bancária vigente',
 PAYABLE_OVERSETTLED:'Pagamentos líquidos superiores ao título'
};
const dueAlerts:Record<string,string>={
 DELIVERY_OVERDUE:'Entrega vencida',DELIVERY_DUE_TODAY:'Entrega prevista hoje',
 DELIVERY_DUE_SOON:'Entrega nos próximos sete dias',
 PAYMENT_OVERDUE:'Título vencido',PAYMENT_DUE_TODAY:'Título vence hoje',
 PAYMENT_DUE_SOON:'Título vence nos próximos sete dias'
};
const date=(raw:string|null)=>{
 if(!raw)return '—';
 const d=new Date(raw.slice(0,10)+'T12:00:00Z');
 return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(d);
};
export default function EnterpriseProcureToPayPortfolio({onOpenOrder,onOpenPayable,onNavigate}:{
 onOpenOrder:(orderId:string)=>void;onOpenPayable:(payableId:string)=>void;
 onNavigate:(module:string)=>void;
}){
 const [search,setSearch]=useState(''),[query,setQuery]=useState('');
 const [status,setStatus]=useState('all'),[page,setPage]=useState(1);
 const [reload,setReload]=useState(0),[busy,setBusy]=useState(true);
 const [result,setResult]=useState<Response|null>(null),[error,setError]=useState('');
 const [attentionOnly,setAttentionOnly]=useState(false);
 useEffect(()=>{
  const t=setTimeout(()=>{setQuery(search.trim());setPage(1);},240);
  return()=>clearTimeout(t);
 },[search]);
 useEffect(()=>{
  const ctrl=new AbortController();
  const run=async()=>{
   setBusy(true);setError('');setResult(null);
   try{
    const params=new URLSearchParams({q:query,status,page:String(page)});
    const response=await fetch('/api/enterprise/procure-to-pay/portfolio?'+params,
     {cache:'no-store',credentials:'same-origin',signal:ctrl.signal});
    const body=await response.json() as Response;
    if(!response.ok||!Array.isArray(body.items))throw Error(body.error??'Carteira documental indisponível.');
    if(!ctrl.signal.aborted)setResult(body);
   }catch(e){if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Carteira indisponível.');}
   finally{if(!ctrl.signal.aborted)setBusy(false);}
  };
  void run();
  return()=>ctrl.abort();
 },[query,status,page,reload]);
 const visible=(result?.items??[]).filter(r=>!attentionOnly||r.flags.length>0||r.alerts.length>0);
 const exportParams=new URLSearchParams({q:query,status,page:String(page),format:'csv'});
 return <section className="enterprise-procure-portfolio" aria-label="Carteira de compras até pagamento">
  <header className="enterprise-procure-portfolio-heading">
   <div><span className="eyebrow">CONTROLES TRANSVERSAIS · PROCURE TO PAY</span>
    <h3>Carteira de compras até pagamento</h3>
    <p>Pedidos, recebimento, título, escrituração e conciliação bancária sob o mesmo contexto autenticado.</p>
   </div>
   <div className="enterprise-procure-portfolio-head-actions">
    <a className="secondary enterprise-procure-portfolio-export" href={'/api/enterprise/procure-to-pay/portfolio?'+exportParams.toString()}
     download title="Exportar somente os pedidos desta página com valores escalados exatos">
     <FileDown size={13}/> Exportar página CSV</a>
    <button className="secondary" type="button" onClick={()=>onNavigate('Contas a pagar')}>
     Abrir contas a pagar <ArrowRight size={13}/></button>
    <button className="secondary" type="button" aria-label="Atualizar carteira de compras"
     disabled={busy} onClick={()=>setReload(r=>r+1)}><RefreshCw size={14}/></button>
   </div>
  </header>
  <div className="enterprise-procure-portfolio-filterbar">
   <label className="enterprise-procure-portfolio-search"><Search size={14}/>
    <input type="search" placeholder="Pedido ou fornecedor" aria-label="Buscar pedido ou fornecedor"
     value={search} onChange={e=>setSearch(e.target.value)}/>
   </label>
   <label>Situação do pedido<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>
    <option value="all">Todas</option><option value="draft">Em preparação</option>
    <option value="approved">Aprovadas</option><option value="received">Recebidas</option>
    <option value="cancelled">Canceladas</option>
   </select></label>
   <label className="enterprise-procure-portfolio-check">
    <input type="checkbox" checked={attentionOnly} onChange={e=>setAttentionOnly(e.target.checked)}/>
    Ressalvas e prazos da página</label>
  </div>
  {error&&<div className="form-error" role="alert">{error}<button type="button"
   onClick={()=>setReload(r=>r+1)}>Repetir consulta</button></div>}
  {busy?<p className="enterprise-procure-portfolio-wait" role="status">Verificando documentos autorizados…</p>:
   result&&<>
    <div className="enterprise-procure-portfolio-metrics" aria-label="Indicadores apenas da página atual">
     <div><span>Pedidos nesta página</span><strong>{result.summary.pageOrders}</strong>
      <small>{result.pageInfo.total} no filtro completo</small></div>
     <div><span>Valor nominal dos pedidos</span><strong>{money(result.summary.pagePurchaseScaled)}</strong>
      <small>Soma da página</small></div>
     <div><span>Saldo a pagar vinculado</span><strong>{money(result.summary.pageOutstandingScaled)}</strong>
      <small>Soma da página · sem caixa presumido</small></div>
     <div><span>Pendências documentais</span><strong>{result.summary.pageDocumentExceptions}</strong>
      <small>Pedidos com uma ou mais ressalvas</small></div>
     <div><span>Entregas atrasadas</span><strong>{result.summary.pageDeliveryOverdue}</strong>
      <small>Somente da página atual</small></div>
     <div><span>Títulos vencidos</span><strong>{result.summary.pagePaymentOverdue}</strong>
      <small>Sem pressupor encargos</small></div>
    </div>
    <div className="enterprise-procure-portfolio-tablewrap">
     <table><thead><tr>
      <th>Pedido / fornecedor</th><th>Etapa verificada</th><th>Pedido</th>
      <th>Obrigação</th><th>Saldo em aberto</th><th>Custo atribuído à OS</th>
      <th>Entrega prevista</th><th>Vencimento AP</th><th>Prazo / risco</th><th>Origem</th>
     </tr></thead><tbody>
     {visible.map(item=><tr key={item.id}>
      <td><strong>{item.reference}</strong><small>{item.supplier}</small></td>
      <td><span className={'enterprise-procure-portfolio-phase '+item.phase}>{phases[item.phase]}</span>
       {item.flags.length>0&&<small title={item.flags.map(f=>flags[f]??f).join(' · ')}>
        <ShieldAlert size={11}/> {item.flags.length} ressalva(s)</small>}
       {item.phase==='verified'&&<small><CheckCircle2 size={11}/> Sem lacuna identificada</small>}
      </td>
      <td className="amount">{money(item.orderScaled)}</td>
      <td className="amount">{item.payableId?money(item.payableScaled):'Não vinculada'}</td>
      <td className="amount">{item.payableId?money(item.outstandingScaled):'Não apurado'}</td>
      <td className="amount">{item.payableId?money(item.attributedScaled):'—'}</td>
      <td>{date(item.expectedOn)}</td>
      <td>{item.payableId?date(item.payableDueOn):'—'}</td>
      <td>{item.alerts.length?<span className={'enterprise-procure-portfolio-urgency '+item.severity}
       title={item.alerts.map(x=>dueAlerts[x]??x).join(' · ')}>
       {item.alerts.map(x=>dueAlerts[x]??x).join(' · ')}</span>:'Sem alerta de prazo'}</td>
      <td><div className="enterprise-procure-portfolio-source-actions">
       <button type="button" className="row-link" onClick={()=>onOpenOrder(item.id)}>
        Abrir pedido <ArrowRight size={12}/></button>
       {item.payableId&&<button type="button" className="row-link"
        onClick={()=>onOpenPayable(item.payableId!)}>Abrir título AP <ArrowRight size={12}/></button>}
      </div></td>
     </tr>)}
     </tbody></table>
     {!visible.length&&<div className="enterprise-procure-portfolio-empty">
      {result.items.length&&attentionOnly?'Nenhuma ressalva ou prazo crítico nesta página. Desmarque o filtro para ver os pedidos.':
       'Nenhum pedido recuperado para os critérios.'}</div>}
    </div>
    <footer className="enterprise-procure-portfolio-footer">
     <span>Página {result.pageInfo.page} · {result.pageInfo.total} pedido(s) no filtro</span>
     <div><button type="button" disabled={page===1} onClick={()=>setPage(n=>n-1)}>Anterior</button>
      <button type="button" disabled={!result.pageInfo.hasMore} onClick={()=>setPage(n=>n+1)}>Próxima</button></div>
    </footer>
    <details className="finance-source-disclosure enterprise-procure-portfolio-disclaimer">
     <summary>Escopo, evidências e limites do controle</summary>
     {result.warnings.map(s=><p key={s}>{s}</p>)}
     <p>Consulta somente leitura · dados isolados por proprietário · atualizado em
      {' '+new Date(result.generatedAt).toLocaleString('pt-BR')}.</p>
    </details>
   </>}
 </section>;
}
