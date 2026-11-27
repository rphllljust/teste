'use client';
import {useCallback,useEffect,useState} from 'react';
import {BookOpenText,CalendarClock,CheckCheck,RefreshCw,ShieldCheck} from 'lucide-react';
import {moneyScaled} from '../lib/domain/orders';
import {EnterprisePageHeader} from './components/enterprise/EnterprisePrimitives';
type Candidate={receivableId:string;client:string;orderTitle:string;dueDate:string;outstandingScaled:string};
type Case={id:string;receivableId:string;status:'open'|'promised'|'settled'|'cancelled';
 rowVersion:number;client:string;orderTitle:string;dueDate:string;outstandingScaled:string;promiseDate:string|null;updatedAt:string};
type Detail={case:Case&{sourceNote:string};history:{id:string;action:string;note:string;promiseDate:string|null;createdAt:string;correlationId:string}[];warnings:string[]};
const name:Record<string,string>={open:'Em acompanhamento',promised:'Promessa registrada',settled:'Quitada',cancelled:'Encerrada sem ação'};
export default function CollectionsWorkspace(){
 const [cases,setCases]=useState<Case[]>([]),[candidates,setCandidates]=useState<Candidate[]>([]);
 const [detail,setDetail]=useState<Detail|null>(null);
 const [candidate,setCandidate]=useState(''),[openingNote,setOpeningNote]=useState('');
 const [action,setAction]=useState<'log_contact'|'record_promise'|'resolve'|'reopen'|'cancel'>('log_contact');
 const [note,setNote]=useState(''),[promise,setPromise]=useState('');
 const [openKey,setOpenKey]=useState(()=>crypto.randomUUID()),[actionKey,setActionKey]=useState(()=>crypto.randomUUID());
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const r=await fetch('/api/finance/collections',{cache:'no-store'});
   const d=await r.json() as {items:Case[];candidates:Candidate[];error?:string};
   if(!r.ok)throw Error(d.error??'Carteira de cobrança indisponível.');
   setCases(d.items);setCandidates(d.candidates);
  }catch(e){setError(e instanceof Error?e.message:'Carteira de cobrança indisponível.');}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[load]);
 const inspect=useCallback(async(id:string)=>{
  const r=await fetch('/api/finance/collections/'+encodeURIComponent(id),{cache:'no-store'});
  const d=await r.json() as Detail&{error?:string};
  if(!r.ok)throw Error(d.error??'Caso indisponível.');
  setDetail(d);setActionKey(crypto.randomUUID());setNote('');
 },[]);
 async function create(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError('');setMessage('');
  try{
   const r=await fetch('/api/finance/collections',{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({id:openKey,receivableId:candidate,note:openingNote})});
   const d=await r.json() as {id?:string;error?:string};
   if(!r.ok||!d.id)throw Error(d.error??'Abertura indisponível.');
   await Promise.all([load(),inspect(d.id)]);
   setCandidate('');setOpeningNote('');setOpenKey(crypto.randomUUID());
   setMessage('Acompanhamento registrado com origem e trilha de auditoria.');
  }catch(e){setError(e instanceof Error?e.message:'Abertura indisponível.');}
  finally{setBusy(false);}
 }
 async function execute(e:React.FormEvent){
  e.preventDefault();if(!detail)return;
  setBusy(true);setError('');setMessage('');
  try{
   const r=await fetch('/api/finance/collections/'+encodeURIComponent(detail.case.id)+'/commands',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({key:actionKey,expectedVersion:detail.case.rowVersion,action,note,
     ...(action==='record_promise'?{promiseDate:promise}:{})}),
   });
   const d=await r.json() as {error?:string};
   if(!r.ok)throw Error(d.error??'Transição indisponível.');
   await Promise.all([inspect(detail.case.id),load()]);
   setActionKey(crypto.randomUUID());setNote('');setPromise('');
   setMessage('Evento de cobrança registrado. Nenhuma mensagem foi enviada nem baixa financeira criada.');
  }catch(e){setError(e instanceof Error?e.message:'Transição indisponível.');}
  finally{setBusy(false);}
 }
 return <section className="enterprise-module worklist cisne-collections">
  <EnterprisePageHeader eyebrow="CONTAS A RECEBER · COBRANÇA"
   title="Gestão de cobrança e compromissos"
   description="Acompanhe títulos persistidos, registre contatos e promessas e acompanhe liquidação com trilha imutável."/>
  <div className="list-title"><div><h2>Carteira de recuperação</h2>
   <p>Ações documentais e acompanhamento. Não há envio automático de mensagens, negativação ou registro artificial de recebimento.</p></div>
   <button type="button" className="secondary" onClick={()=>void load()} disabled={busy||loading}>
    <RefreshCw size={15}/> Atualizar</button></div>
  <div className="cisne-collections-columns">
   <section className="cisne-collections-panel" aria-label="Abrir acompanhamento">
    <h3><CalendarClock size={16}/> Abrir caso de cobrança</h3>
    <form onSubmit={e=>void create(e)}>
     <label>Título pendente<select required value={candidate} onChange={e=>setCandidate(e.target.value)}>
      <option value="">Selecione um título autorizado</option>
      {candidates.map(c=><option value={c.receivableId} key={c.receivableId}>
       {c.client} · {c.orderTitle} · {moneyScaled(c.outstandingScaled)} · vence {c.dueDate}</option>)}
     </select></label>
     <label>Motivo e providência inicial<textarea required minLength={5} maxLength={1200}
      value={openingNote} onChange={e=>setOpeningNote(e.target.value)}
      placeholder="Registre a situação do título e a próxima providência documental." rows={3}/></label>
     <button type="submit" className="primary" disabled={busy||!candidate}>Criar acompanhamento</button>
    </form>
   </section>
   <section className="cisne-collections-panel" aria-label="Casos financeiros persistidos">
    <h3><BookOpenText size={16}/> Acompanhamentos registrados</h3>
    <div className="cisne-collections-case-list">
     {loading?<p role="status">Consultando casos…</p>:cases.length===0?<p>Não existem acompanhamentos registrados nesta empresa.</p>:
      cases.map(c=><button type="button" key={c.id}
       aria-current={detail?.case.id===c.id?'true':undefined}
       onClick={()=>void inspect(c.id).catch(e=>setError(String(e)))}>
       <span><strong>{c.client}</strong><small>{c.orderTitle} · vencimento {c.dueDate}</small></span>
       <span><strong>{moneyScaled(c.outstandingScaled)}</strong><small>{name[c.status]??c.status}</small></span>
      </button>)}
    </div>
   </section>
  </div>
  {detail&&<section className="cisne-collections-detail" aria-label="Inspeção e histórico de cobrança">
   <header><h3>{detail.case.client} · {detail.case.orderTitle}</h3>
    <span><ShieldCheck size={15}/> {name[detail.case.status]}</span></header>
   <p>Saldo financeiro atual: <strong>{moneyScaled(detail.case.outstandingScaled)}</strong>
    {detail.case.promiseDate&&' · Compromisso informado para '+detail.case.promiseDate}</p>
   <div className="cisne-collections-detail-grid">
    <form onSubmit={e=>void execute(e)}>
     <h4>Registrar providência</h4>
     <label>Tipo de evento<select value={action} onChange={e=>{setAction(e.target.value as typeof action);setActionKey(crypto.randomUUID());}}>
      {detail.case.status==='settled'||detail.case.status==='cancelled'?
       <option value="reopen">Reabrir acompanhamento</option>:
       <><option value="log_contact">Contato documentado</option>
       <option value="record_promise">Promessa de pagamento</option>
       <option value="resolve">Encerrar após quitação comprovada</option>
       <option value="cancel">Encerrar sem liquidação</option></>}
     </select></label>
     {action==='record_promise'&&<label>Data prometida<input type="date" required
      value={promise} onChange={e=>setPromise(e.target.value)}/></label>}
     <label>Registro da providência<textarea required rows={3} minLength={5} maxLength={1200}
      value={note} onChange={e=>setNote(e.target.value)}
      placeholder="Informe o contato, a promessa ou a justificativa; não pressupõe envio externo."/></label>
     <button type="submit" className="primary" disabled={busy}>Gravar evento auditável</button>
    </form>
    <div className="cisne-collections-events"><h4>Histórico imutável</h4>
     {detail.history.map(h=><article key={h.id}>
      <strong>{h.action.replaceAll('_',' ')}</strong><small>{h.createdAt} · correlação {h.correlationId}</small>
      <p>{h.note}</p>{h.promiseDate&&<small>Promessa registrada: {h.promiseDate}</small>}
     </article>)}
    </div>
   </div>
  </section>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {message&&<p className="linked-info" role="status">{message}</p>}
 </section>;
}
