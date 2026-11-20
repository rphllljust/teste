'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {EnterpriseButton,EnterpriseInput,EnterpriseTextarea,EnterpriseDialog} from './components/enterprise/EnterprisePrimitives';

type Approval={id:string;entityType:'service_order'|'measurement'|'finance_period_close';entityId:string;
 command:string;state:string;requestedBy:string;rowVersion:number;createdAt:string;decidedAt:string|null};
type List={items:Approval[];page:number;total:number;hasMore:boolean;authority:string};
type Decision={item:Approval;command:'approve'|'reject';key:string};

const entityLabels:Record<Approval['entityType'],string>={
 service_order:'Autorização de ordem de serviço',
 measurement:'Aprovação de medição',
 finance_period_close:'Fechamento de período financeiro',
};
function displayDate(value:string){
 if(!value||!Number.isFinite(Date.parse(value)))return 'Data não informada';
 return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Porto_Velho'}).format(new Date(value));
}

export default function EnterpriseApprovalsInbox({onClose,onDecided}:{onClose:()=>void;onDecided:()=>void}){
 const [state,setState]=useState<'pending'|'approved'|'rejected'>('pending');
 const [page,setPage]=useState(1);
 const [refresh,setRefresh]=useState(0);
 const [list,setList]=useState<List|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [decision,setDecision]=useState<Decision|null>(null);
 const [reason,setReason]=useState('');
 const [submitting,setSubmitting]=useState(false);
 const [notice,setNotice]=useState('');
 const modalRef=useRef<HTMLDivElement>(null);
 const closeDecision=useCallback(()=>{if(!submitting){setDecision(null);setReason('');setError('');}},[submitting]);
 useEffect(()=>{
  const controller=new AbortController();
  const run=async()=>{
   setLoading(true);
   try{
    const response=await fetch('/api/workflow/approvals?'+new URLSearchParams({state,page:String(page)}),
      {cache:'no-store',signal:controller.signal});
    const data=await response.json() as List&{error?:string};
    if(!response.ok)throw new Error(data.error||'Aprovações indisponíveis.');
    if(data.authority!=='assigned_approver_postgresql.v1'||!Array.isArray(data.items))
      throw new Error('Sem atestação de aprovações atribuídas.');
    if(!controller.signal.aborted){setList(data);setError('');}
   }catch(cause){
    if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Aprovações indisponíveis.');setList(null);}
   }finally{if(!controller.signal.aborted)setLoading(false);}
  };
  const timer=setTimeout(()=>void run(),0);
  return()=>{clearTimeout(timer);controller.abort();};
 },[state,page,refresh]);

 function choose(item:Approval,command:'approve'|'reject'){
  setError('');setReason('');setNotice('');
  setDecision({item,command,key:crypto.randomUUID()});
 }
 async function decide(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!decision||submitting)return;
  if(decision.command==='reject'&&reason.trim().length<3){setError('Informe uma justificativa de pelo menos três caracteres.');return;}
  setSubmitting(true);setError('');
  try{
   const response=await fetch('/api/workflow/approvals/'+encodeURIComponent(decision.item.id)+'/commands',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key:decision.key,version:decision.item.rowVersion,command:decision.command,
      ...(decision.command==='reject'?{reason:reason.trim()}:{})}),
   });
   const result=await response.json() as {error?:string;state?:string};
   if(!response.ok)throw new Error(result.error||'A decisão não foi persistida.');
   setNotice(decision.command==='approve'?'Decisão aprovada e registrada no servidor.':'Rejeição registrada com justificativa.');
   setDecision(null);setReason('');setRefresh(n=>n+1);onDecided();
  }catch(cause){
   setError(cause instanceof Error?cause.message:'Decisão indisponível.');
  }finally{setSubmitting(false);}
 }
 return <section className="enterprise-approvals-inbox" aria-label="Aprovações atribuídas">
  <header className="enterprise-approvals-heading"><div><span className="eyebrow">SEGREGAÇÃO DE FUNÇÕES</span>
   <h3>Solicitações atribuídas a você</h3>
   <p>Somente o aprovador designado pode decidir. Uma decisão não substitui as transições empresariais que ainda não foram executadas.</p>
   </div><EnterpriseButton type="button" className="secondary" onClick={onClose}>Recolher aprovações</EnterpriseButton></header>
  <div className="enterprise-approvals-filters" role="group" aria-label="Situação das solicitações">
   {([{key:'pending',label:'Pendentes'},{key:'approved',label:'Aprovadas'},{key:'rejected',label:'Rejeitadas'}] as const).map(option=>
    <EnterpriseButton key={option.key} type="button" appearance={state===option.key?'primary':'subtle'}
     aria-pressed={state===option.key} onClick={()=>{setState(option.key);setPage(1);}}>{option.label}</EnterpriseButton>)}
   <EnterpriseButton type="button" className="secondary" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Atualizar</EnterpriseButton>
  </div>
  {notice&&<p role="status" className="linked-info">{notice}</p>}
  {error&&!decision&&<p role="alert" className="form-error">{error}</p>}
  {loading&&<p role="status">Consultando solicitações autorizadas…</p>}
  {!loading&&list&&<><div className="enterprise-approvals-list">
    {list.items.length===0?<p>Nenhuma solicitação {state==='pending'?'pendente':state==='approved'?'aprovada':'rejeitada'} foi atribuída a este usuário.</p>:
    <ol>{list.items.map(item=><li key={item.id}><div className="enterprise-approval-identity">
      <strong>{entityLabels[item.entityType]??item.command}</strong>
      <small>Solicitação {item.id} · Entidade {item.entityId} · Solicitada em {displayDate(item.createdAt)}</small>
      <span>Situação: {item.state} · versão {item.rowVersion}</span>
      </div><div className="enterprise-approval-actions">
       {item.state==='pending'&&<><EnterpriseButton type="button" className="primary" onClick={()=>choose(item,'approve')}>Avaliar aprovação</EnterpriseButton>
       <EnterpriseButton type="button" className="secondary" onClick={()=>choose(item,'reject')}>Rejeitar</EnterpriseButton></>}
      </div></li>)}</ol>}
   </div><nav className="enterprise-queue-pagination" aria-label="Paginação das aprovações">
    <EnterpriseButton type="button" className="secondary" disabled={loading||page===1} onClick={()=>setPage(n=>Math.max(1,n-1))}>Anterior</EnterpriseButton>
    <span role="status">Página {page} · {list.total} solicitações {state==='pending'?'pendentes':state==='approved'?'aprovadas':'rejeitadas'}</span>
    <EnterpriseButton type="button" className="secondary" disabled={loading||!list.hasMore} onClick={()=>setPage(n=>n+1)}>Próxima</EnterpriseButton>
   </nav></>}
  {decision&&<EnterpriseDialog open={true} ariaLabel="Confirmar decisão da aprovação" onDismiss={closeDecision}>
   <div ref={modalRef} className="enterprise-approval-dialog">
    <h3>{decision.command==='approve'?'Confirmar aprovação':'Confirmar rejeição'}</h3>
    <p>{entityLabels[decision.item.entityType]} · solicitação {decision.item.id}</p>
    <p>O servidor revalidará a identidade do aprovador, a segregação de funções, o estado e a versão do registro. A decisão será auditada.</p>
    <form onSubmit={e=>void decide(e)}>
     {decision.command==='reject'&&<label>Justificativa obrigatória<EnterpriseTextarea value={reason} onChange={e=>setReason(e.currentTarget.value)} required minLength={3} maxLength={500}/></label>}
     {error&&<p className="form-error" role="alert">{error}</p>}
     <footer><EnterpriseButton type="button" className="secondary" disabled={submitting} onClick={closeDecision}>Cancelar</EnterpriseButton>
      <EnterpriseButton type="submit" className="primary" disabled={submitting||decision.command==='reject'&&reason.trim().length<3}>
       {submitting?'Validando…':decision.command==='approve'?'Confirmar aprovação':'Confirmar rejeição'}
      </EnterpriseButton></footer>
    </form>
   </div>
  </EnterpriseDialog>}
 </section>;
}
