'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {CircleCheck,ClipboardCheck,FileClock,RefreshCw,ShieldAlert,Wallet,ArrowRight} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';
import {EnterprisePageHeader} from './components/enterprise/EnterprisePrimitives';
type Payable={id:string;supplier:string;sourceReference:string;outstandingScaled:string;dueDate:string};
type Run={id:string;reference:string;effectiveDate:string;status:'prepared'|'posted'|'cancelled';
 rowVersion:number;itemCount:number;totalScaled:string;createdAt:string};
type Item={id:string;payableId:string;supplier:string;sourceReference:string;amountScaled:string;
 baselineOutstandingScaled:string;currentOutstandingScaled:string;paymentId:string|null};
type Detail={run:Run;items:Item[];history:{action:string;createdAt:string;correlationId:string}[];warnings:string[]};
const money=(s:string)=>moneyScaled(s);
const currentDate=()=>new Date().toISOString().slice(0,10);
const stateLabel:Record<string,string>={prepared:'Preparado',posted:'Lançado',cancelled:'Cancelado'};
export default function PaymentRunsWorkspace(){
 const [runs,setRuns]=useState<Run[]>([]);
 const [payables,setPayables]=useState<Payable[]>([]);
 const [amounts,setAmounts]=useState<Record<string,string>>({});
 const [selected,setSelected]=useState<Record<string,boolean>>({});
 const [reference,setReference]=useState('');
 const [date,setDate]=useState(currentDate);
 const [detail,setDetail]=useState<Detail|null>(null);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const [key,setKey]=useState(()=>crypto.randomUUID());
 const [executeKey,setExecuteKey]=useState(()=>crypto.randomUUID());
 const [confirm,setConfirm]=useState(false);
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const [r,p]=await Promise.all([
    fetch('/api/finance/payment-runs',{cache:'no-store'}),
    fetch('/api/payables?state=outstanding&page=1&pageSize=50',{cache:'no-store'}),
   ]);
   const [rd,pd]=await Promise.all([r.json(),p.json()]) as [
    {items:Run[];error?:string},{items:Payable[];error?:string}];
   if(!r.ok||!p.ok)throw Error(rd.error??pd.error??'Carteira indisponível.');
   setRuns(rd.items);setPayables(pd.items);
  }catch(e){setError(e instanceof Error?e.message:'Consulta indisponível.');}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[load]);
 const open=useCallback(async(id:string)=>{
  const response=await fetch('/api/finance/payment-runs/'+encodeURIComponent(id),{cache:'no-store'});
  const data=await response.json() as Detail&{error?:string};
  if(!response.ok)throw Error(data.error??'Lote indisponível.');
  setDetail(data);setConfirm(false);setExecuteKey(crypto.randomUUID());
 },[]);
 const draft=useMemo(()=>payables.filter(p=>selected[p.id]).map(p=>({
  payableId:p.id,amount:amounts[p.id]??(Number(p.outstandingScaled)/10000).toFixed(4),
 })),[payables,selected,amounts]);
 async function prepare(e:React.FormEvent){
  e.preventDefault();if(!draft.length)return;
  setSaving(true);setMessage('');setError('');
  try{
   const response=await fetch('/api/finance/payment-runs',{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({id:key,reference,effectiveDate:date,items:draft})});
   const data=await response.json() as {id?:string;error?:string};
   if(!response.ok||!data.id)throw Error(data.error??'Preparação não autorizada.');
   await load();await open(data.id);setKey(crypto.randomUUID());setSelected({});
   setMessage('Lote preparado. Nenhum pagamento foi registrado ou transmitido.');
  }catch(e){setError(e instanceof Error?e.message:'Falha ao preparar lote.');}
  finally{setSaving(false);}
 }
 async function command(action:'execute'|'cancel'){
  if(!detail||saving)return;
  if(action==='execute'&&!confirm)return;
  setSaving(true);setError('');setMessage('');
  try{
   const response=await fetch('/api/finance/payment-runs/'+encodeURIComponent(detail.run.id)+'/commands',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({key:executeKey,action,expectedVersion:detail.run.rowVersion}),
   });
   const data=await response.json() as {error?:string;status?:string};
   if(!response.ok)throw Error(data.error??'Comando não executado.');
   await Promise.all([open(detail.run.id),load()]);
   setMessage(action==='execute'?
    'Lote lançado integralmente no livro financeiro local. Não ocorreu transferência bancária.':
    'Lote cancelado sem novos pagamentos.');
  }catch(e){setError(e instanceof Error?e.message:'Comando não executado.');}
  finally{setSaving(false);}
 }
 return <section className="enterprise-module worklist cisne-payment-runs">
  <EnterprisePageHeader eyebrow="TESOURARIA · OPERAÇÕES TRANSACIONAIS"
   title="Central de lotes de pagamentos"
   description="Prepare, revise e registre múltiplas baixas de fornecedores em uma transação única, com origem persistida."/>
  <div className="list-title"><div><h2>Execução financeira controlada</h2>
   <p>O lote não envia ordens ao banco. Executar registra baixas financeiras e os diários previstos nas políticas contábeis ativas.</p></div>
   <button type="button" className="secondary" disabled={loading||saving} onClick={()=>void load()}>
    <RefreshCw size={15}/> Atualizar</button></div>
  <div className="cisne-payment-run-sections">
   <section className="cisne-payment-run-panel" aria-label="Preparar novo lote">
    <h3><Wallet size={16}/> Preparar carteira</h3>
    <form onSubmit={e=>void prepare(e)}>
     <div className="cisne-payment-run-fields">
      <label>Referência documental<input required minLength={3} maxLength={160}
       value={reference} onChange={e=>setReference(e.target.value)}
       placeholder="Ex.: Lote fornecedores semana 48"/></label>
      <label>Data efetiva<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
     </div>
     <div className="cisne-payment-run-source">
      <strong>Obrigações em aberto · primeira página autorizada (máximo 50)</strong>
      {loading?<p role="status">Consultando títulos…</p>:
       payables.length===0?<p>Não há títulos em aberto nesta página. Cadastre ou consulte as obrigações antes de preparar um lote.</p>:
       <div className="cisne-payment-run-items">
        {payables.map(p=><div key={p.id} className="cisne-payment-run-source-row">
         <label><input type="checkbox" checked={Boolean(selected[p.id])}
          onChange={e=>setSelected(s=>({...s,[p.id]:e.target.checked}))}/>
          <span><strong>{p.supplier}</strong><small>{p.sourceReference} · vence {p.dueDate}</small></span></label>
         <span>Saldo: <strong>{money(p.outstandingScaled)}</strong></span>
         <label>Valor (R$)<input aria-label={'Valor a pagar · '+p.supplier}
          disabled={!selected[p.id]} inputMode="decimal" required={Boolean(selected[p.id])}
          placeholder="0.0000" value={amounts[p.id]??(Number(p.outstandingScaled)/10000).toFixed(4)}
          onChange={e=>setAmounts(a=>({...a,[p.id]:e.target.value}))}/></label>
        </div>)}
       </div>}
     </div>
     <div className="cisne-payment-run-foot">
      <span>{draft.length} título(s) selecionado(s) · execução sujeita à conferência dos saldos</span>
      <button className="primary" type="submit" disabled={saving||!draft.length}>
       <ClipboardCheck size={15}/> Preparar lote</button>
     </div>
    </form>
   </section>
   <section className="cisne-payment-run-panel" aria-label="Histórico de lotes">
    <h3><FileClock size={16}/> Lotes persistidos</h3>
    <div className="cisne-payment-run-history">
     {runs.length===0?<p>Nenhum lote criado nesta empresa.</p>:
      runs.map(run=><button key={run.id} type="button"
       aria-current={detail?.run.id===run.id?'true':undefined}
       onClick={()=>void open(run.id).catch(e=>setError(String(e)))}>
       <span><strong>{run.reference}</strong><small>{run.effectiveDate} · {run.itemCount} título(s)</small></span>
       <span><strong>{money(run.totalScaled)}</strong><small>{stateLabel[run.status]??run.status}</small></span>
       <ArrowRight size={14}/></button>)}
    </div>
   </section>
  </div>
  {detail&&<section className="cisne-payment-run-detail" aria-label="Inspeção de lote financeiro">
   <header><div><h3>Revisão documental · {detail.run.reference}</h3>
    <p>Estado {stateLabel[detail.run.status]} · versão {detail.run.rowVersion} · registros imutáveis por título</p></div>
    {detail.run.status==='posted'&&<CircleCheck size={20}/>}
   </header>
   <div className="table-wrap"><table><thead><tr><th>Fornecedor / título</th><th>Valor do lote</th>
    <th>Saldo na preparação</th><th>Saldo atual</th><th>Registro</th></tr></thead>
    <tbody>{detail.items.map(item=><tr key={item.id}>
     <td><strong>{item.supplier}</strong><small>{item.sourceReference}</small></td>
     <td>{money(item.amountScaled)}</td><td>{money(item.baselineOutstandingScaled)}</td>
     <td>{money(item.currentOutstandingScaled)}</td>
     <td>{item.paymentId?'Lançado · '+item.paymentId.slice(0,8):'Pendente'}</td></tr>)}</tbody></table></div>
   {detail.run.status==='prepared'&&<div className="cisne-payment-run-confirm">
    <p><ShieldAlert size={16}/> A confirmação revalida os saldos atuais e a competência.
     Se qualquer título mudar ou falhar, nenhum pagamento do lote será registrado.</p>
    <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>
     Confirmo que revisei os documentos e autorizo o registro interno deste lote.</label>
    <div><button type="button" className="secondary" disabled={saving}
     onClick={()=>void command('cancel')}>Cancelar lote</button>
     <button type="button" className="primary" disabled={saving||!confirm}
      onClick={()=>void command('execute')}>Registrar lote integralmente</button></div>
   </div>}
   <footer>Eventos de auditoria: {detail.history.map(h=>h.action+' · '+h.createdAt).join(' | ')}</footer>
  </section>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {message&&<p role="status" className="linked-info">{message}</p>}
 </section>;
}
