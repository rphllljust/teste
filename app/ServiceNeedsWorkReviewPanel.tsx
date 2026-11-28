'use client';
import {useState} from 'react';
type Line={kind:string;resourceRef:string;quantityMilli:number|string;unit:string;recordedBy?:string};
export type WorkReport={id:string;assignmentId:string;summary:string;evidenceRef:string|null;planRevision:number;
 plannedSnapshot:Line[];actualSnapshot:Line[];submittedByActorId:string;submittedAt:string;decision:'pending'|'returned'|'accepted';
 reviewReason:string|null;reviewedByActorId:string|null;reviewedAt:string|null};
const digits=(v:number|string)=>Number(v)/1000;
function grouped(lines:Line[]){
 const m=new Map<string,{kind:string;resourceRef:string;unit:string;quantity:number}>();
 for(const l of lines){
  const key=JSON.stringify([l.kind,l.resourceRef,l.unit]),old=m.get(key);
  if(old)old.quantity+=Number(l.quantityMilli);
  else m.set(key,{kind:l.kind,resourceRef:l.resourceRef,unit:l.unit,quantity:Number(l.quantityMilli)});
 }
 return [...m.values()];
}
export default function ServiceNeedsWorkReviewPanel({tenantId,needId,status,reports,onRefresh}:{
 tenantId:string;needId:string;status:string;reports:WorkReport[];onRefresh:()=>void;
}){
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const current=reports[0],pending=status==='review_pending'&&current?.decision==='pending';
 async function review(decision:'returned'|'accepted'){
  if(!current||busy||reason.trim().length<3)return;
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/'+encodeURIComponent(needId)+'/commands',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({
     command:'review_work_report',commandKey:crypto.randomUUID(),reportId:current.id,decision,reason:reason.trim(),
    })
   });
   const result=await response.json() as {error?:string;status?:string;readyForMeasurement?:boolean};
   if(!response.ok)throw Error(result.error??'Não foi possível registrar a decisão.');
   setNotice(decision==='returned'?'Relatório devolvido ao empregado para correção.':'Relatório aceito. OS concluída e liberada para medição mediante processo próprio.');
   setReason('');onRefresh();
  }catch(ex){setError(ex instanceof Error?ex.message:'Não foi possível gravar a conferência.');}
  finally{setBusy(false);}
 }
 return <section className="enterprise-governance-panel" aria-label="Conferência operacional da OS">
  <h3>Conferência de campo e aceite da operação</h3>
  <p>O empregado apresenta o relatório; um proprietário verificado devolve para correção ou aceita. O aceite conclui a OS, mas não cria cobrança ou nota fiscal automaticamente.</p>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!reports.length&&<p>Ainda não foi apresentado relatório de conclusão pelo empregado.</p>}
  {current&&<div className="enterprise-governance-panel">
   <strong>Último relatório: {current.decision==='pending'?'Aguardando conferência':current.decision==='accepted'?'Aceito':'Devolvido'}</strong>
   <p>Enviado por {current.submittedByActorId} em {current.submittedAt}; baseado no plano v{current.planRevision}</p>
   <p>{current.summary}</p>
   {current.evidenceRef&&<p>Evidência: {current.evidenceRef}</p>}
   <table><thead><tr><th>Recurso</th><th>Previsto no envio</th><th>Realizado no envio</th><th>Diferença</th></tr></thead>
    <tbody>{Array.from(new Set([...current.plannedSnapshot,...current.actualSnapshot].map(l=>JSON.stringify([l.kind,l.resourceRef,l.unit])))).map(key=>{
     const [kind,ref,unit]=JSON.parse(key) as string[];
     const p=grouped(current.plannedSnapshot).find(l=>l.kind===kind&&l.resourceRef===ref&&l.unit===unit)?.quantity??0;
     const a=grouped(current.actualSnapshot).find(l=>l.kind===kind&&l.resourceRef===ref&&l.unit===unit)?.quantity??0;
     return <tr key={key}><td>{ref} · {kind}</td><td>{digits(p)} {unit}</td><td>{digits(a)} {unit}</td><td>{digits(a-p)} {unit}</td></tr>;
    })}</tbody>
   </table>
   {pending&&<>
    <label>Fundamento da conferência<input minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}
     placeholder="Conferência realizada / correções necessárias"/></label>
    <div className="form-row">
     <button type="button" disabled={busy||reason.trim().length<3} onClick={()=>void review('returned')}>Devolver para correção</button>
     <button type="button" className="primary" disabled={busy||reason.trim().length<3} onClick={()=>void review('accepted')}>Aceitar relatório e concluir OS</button>
    </div>
   </>}
  </div>}
  {reports.length>1&&<details><summary>Histórico dos relatórios · {reports.length} envios</summary>
   {reports.map(r=><p key={r.id}><strong>{r.decision}</strong> · {r.summary} · revisão {r.planRevision} · {r.submittedAt}
    {r.reviewReason?' · '+r.reviewReason:''}</p>)}
  </details>}
 </section>;
}
