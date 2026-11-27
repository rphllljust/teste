'use client';
import {useCallback,useEffect,useState} from 'react';
import {ArrowRight,RefreshCw,ShieldCheck} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';
type Project={id:string;title:string;client:string;status:string;contractId:string|null;
 billedScaled:string;costScaled:string;contributionScaled:string};
type Payable={id:string;supplier:string;sourceReference:string;principalScaled:string;remainingScaled:string;
 purchaseOrderId:string|null;purchaseOrderReference:string|null};
type Allocation={id:string;payableId:string;kind:'allocate'|'reverse';amountScaled:string;
 reference:string;sourceReference:string;supplier:string;createdAt:string;reversed:boolean;
 purchaseOrderId:string|null;purchaseOrderReference:string|null};
type Data={items:Project[];pageInfo:{page:number;total:number;hasMore:boolean};
 payables:Payable[];payablesTruncated:boolean;allocations:Allocation[];allocationsTruncated:boolean;
 warnings:string[];error?:string};
const money=(value:string)=>value.startsWith('-')?'−'+moneyScaled(value.slice(1)):moneyScaled(value);
function toScaled(value:string){
 if(!/^\d{1,9}(?:[.,]\d{1,4})?$/.test(value))throw Error('Informe um valor monetário válido.');
 const [whole,fraction='']=value.split(/[,.]/);
 const amount=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
 if(amount<=0n||amount>2147483647n)throw Error('Atribuição fora do limite financeiro.');
 return amount.toString();
}
export default function ProjectCostControlBoard({onOrder,onNavigate}:{
 onOrder:(id:string)=>void;onNavigate:(module:string)=>void;
}){
 const [data,setData]=useState<Data|null>(null);
 const [selectedId,setSelectedId]=useState(''),[q,setQ]=useState(''),[page,setPage]=useState(1);
 const [payableId,setPayableId]=useState(''),[amount,setAmount]=useState('');
 const [reference,setReference]=useState('');
 const [commandId,setCommandId]=useState(()=>crypto.randomUUID());
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [revision,setRevision]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  setLoading(true);setError('');
  try{
   const response=await fetch('/api/controlling/project-costs?'+new URLSearchParams({
    ...(q?{q}:{}),page:String(page),...(selectedId?{orderId:selectedId}:{})}),
    {signal,credentials:'same-origin',cache:'no-store'});
   const result=await response.json() as Data;
   if(!response.ok||!result.pageInfo)throw Error(result.error??'Custos da operação indisponíveis.');
   if(!signal?.aborted)setData(result);
  }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.');}
  finally{if(!signal?.aborted)setLoading(false);}
 },[q,page,selectedId]);
 useEffect(()=>{const c=new AbortController(),timer=setTimeout(()=>void load(c.signal),0);
  return()=>{clearTimeout(timer);c.abort();};},[load,revision]);
 async function post(payload:object){
  setSaving(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/controlling/project-costs',{method:'POST',
    headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
   const result=await response.json() as {error?:string};
   if(!response.ok)throw Error(result.error??'Comando de custo rejeitado.');
   setNotice('Atribuição registrada na trilha analítica. Diário contábil e pagamentos não foram alterados.');
   setCommandId(crypto.randomUUID());setAmount('');setReference('');
   setRevision(n=>n+1);
  }catch(e){setError(e instanceof Error?e.message:'Falha na atribuição.');}
  finally{setSaving(false);}
 }
 async function allocate(e:React.FormEvent){
  e.preventDefault();
  if(!selectedId||!payableId)return;
  let scaled:string;
  try{scaled=toScaled(amount);}catch(e){setError(e instanceof Error?e.message:'Valor inválido.');return;}
  if(BigInt(scaled)>BigInt(data?.payables.find(p=>p.id===payableId)?.remainingScaled??'0')){
   setError('O valor excede o saldo disponível do documento.');return;
  }
  await post({action:'allocate',id:commandId,serviceOrderId:selectedId,payableId,
   amountScaled:scaled,reference});
 }
 const selected=data?.items.find(p=>p.id===selectedId);
 return <section className="enterprise-project-costs" aria-label="Controladoria por ordem de serviço" aria-busy={loading}>
  <header className="enterprise-project-costs-title">
   <div><h2>Custos atribuídos às operações</h2>
    <p>Ligação documental: obrigação financeira → ordem de serviço → faturamento. Valores persistidos, sem custos presumidos.</p></div>
   <button type="button" className="secondary" onClick={()=>setRevision(n=>n+1)} disabled={loading}>
    <RefreshCw size={14}/> Atualizar</button>
  </header>
  <div className="enterprise-project-costs-toolbar">
   <label>Buscar operação <input value={q} placeholder="OS ou cliente"
     onChange={e=>{setQ(e.target.value);setPage(1);setSelectedId('');}}/></label>
   <span>{data?.pageInfo.total??0} ordem(ns) no escopo autorizado</span>
  </div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status" className="linked-info">{notice}</p>}
  {loading?<p role="status" className="finance-tier1-loading">Conferindo vínculos de custo…</p>:data&&<>
   <div className="enterprise-project-costs-table table-wrap">
    <table><thead><tr><th>Ordem de serviço</th><th>Faturado</th><th>Custo atribuído</th><th>Contribuição parcial</th><th>Ação</th></tr></thead>
    <tbody>{data.items.map(o=><tr key={o.id} className={selectedId===o.id?'is-selected':''}>
     <td><strong>{o.title}</strong><small>{o.client} · {o.status}</small></td>
     <td className="amount">{money(o.billedScaled)}</td><td className="amount">{money(o.costScaled)}</td>
     <td className="amount">{money(o.contributionScaled)}</td>
     <td><button type="button" className="row-link" onClick={()=>{setSelectedId(o.id);setPayableId('');}}>
       {selectedId===o.id?'Selecionada':'Atribuir custo'}</button></td>
    </tr>)}</tbody></table>
   </div>
   {!data.items.length&&<p className="enterprise-project-costs-empty">Nenhuma OS encontrada no contexto autorizado.</p>}
   <footer className="enterprise-project-costs-footer">
    <span>Página {page}</span><div><button disabled={page===1} onClick={()=>setPage(n=>n-1)}>Anterior</button>
    <button disabled={!data.pageInfo.hasMore} onClick={()=>setPage(n=>n+1)}>Próxima</button></div>
   </footer>
   {selectedId&&<section className="enterprise-project-costs-detail">
    <header><h3>{selected?.title??'Operação selecionada'}</h3>
     <button type="button" className="row-link" onClick={()=>onOrder(selectedId)}>
      Abrir dossiê completo <ArrowRight size={13}/></button></header>
    <form onSubmit={e=>void allocate(e)} className="enterprise-project-costs-form">
     <label>Obrigação documentada
      <select value={payableId} required onChange={e=>setPayableId(e.target.value)}>
       <option value="">Selecionar título</option>
       {data.payables.map(p=><option key={p.id} value={p.id}>{p.supplier} · {p.sourceReference}
        {' · '+money(p.remainingScaled)} disponíveis</option>)}
      </select></label>
     <label>Valor a atribuir (R$)<input required inputMode="decimal" placeholder="150,0000"
      value={amount} onChange={e=>setAmount(e.target.value)}/></label>
     <label>Justificativa documental<input required minLength={3} maxLength={160}
      value={reference} onChange={e=>setReference(e.target.value)}
      placeholder="Contrato, centro de execução ou rateio"/></label>
     <button type="submit" className="primary" disabled={saving||!payableId}>Registrar atribuição</button>
    </form>
    {data.payablesTruncated&&<p>Mostrando as primeiras 50 obrigações com saldo. A carteira completa permanece no Financeiro.</p>}
    <h4>Trilha de atribuições por obrigação</h4>
    {data.allocations.length?<div className="table-wrap"><table><thead><tr><th>Documento / origem</th><th>Valor</th><th>Evento</th><th>Auditoria</th></tr></thead><tbody>
     {data.allocations.map(a=><tr key={a.id}>
      <td><strong>{a.supplier}</strong><small>{a.sourceReference}
       {a.purchaseOrderReference?' · Compra '+a.purchaseOrderReference:''}</small></td>
      <td className="amount">{money(a.amountScaled)}</td>
      <td>{a.kind==='reverse'?'Estorno':a.reversed?'Estornada':'Atribuída'}</td>
      <td>{a.kind==='allocate'&&!a.reversed?
       <button type="button" className="row-link" disabled={saving} onClick={()=>{
        const reason=reference.trim().length>=3?reference:'Estorno da atribuição';
        void post({action:'reverse',id:crypto.randomUUID(),allocationId:a.id,reference:reason});
       }}>Estornar com trilha</button>:a.reference}</td>
     </tr>)}
    </tbody></table></div>:<p className="enterprise-project-costs-empty">Ainda não existem atribuições para esta operação.</p>}
    {data.allocationsTruncated&&<p>Histórico limitado aos 100 eventos mais recentes.</p>}
   </section>}
   <details className="finance-source-disclosure"><summary><ShieldCheck size={13}/> Alcance e limitações de contribuição</summary>
    {data.warnings.map(w=><p key={w}>{w}</p>)}
    <button type="button" className="row-link" onClick={()=>onNavigate('Contas a pagar')}>Consultar documentos de origem</button>
   </details>
  </>}
 </section>;
}
