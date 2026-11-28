'use client';
import {useState,type FormEvent} from 'react';

export type PlanLine={kind:string;resourceRef:string;quantityMilli:number;unit:string};
export type PlanRevision={id:string;revision:number;reason:string;lines:PlanLine[];actorId:string;createdAt:string};
type PlanDraft={key:string;kind:string;resourceRef:string;quantityMilli:number;unit:string};
const kinds=[['team','Equipe'],['vehicle','Veículo'],['equipment','Equipamento'],['material','Material'],['hours','Horas'],['quantity','Quantidade / volume']] as const;

function quantityMilli(value:string){
 const m=value.trim().match(/^(\d{1,9})(?:[,.](\d{1,3}))?$/);
 if(!m)return null;
 const number=Number(m[1])*1000+Number((m[2]??'').padEnd(3,'0'));
 return Number.isSafeInteger(number)&&number>0&&number<=999999999999?number:null;
}
const decimal=(n:number)=>String(n/1000).replace('.',',');
export default function ServiceNeedsPlanBuilder({tenantId,needId,current,history,onRefresh}:{
 tenantId:string;needId:string;current:PlanLine[];history:PlanRevision[];onRefresh:()=>void;
}){
 const [draft,setDraft]=useState<PlanDraft[]>(()=>current.map(l=>({...l,key:crypto.randomUUID()})));
 const [kind,setKind]=useState('hours'),[ref,setRef]=useState(''),[quantity,setQuantity]=useState('1'),[unit,setUnit]=useState('h');
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const version=history[0]?.revision??0;
 function append(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError('');
  const amount=quantityMilli(quantity);
  if(amount===null||!ref.trim()||!unit.trim()) {setError('Preencha o recurso, a unidade e a quantidade positiva.');return;}
  if(draft.length>=100){setError('Limite de 100 linhas de planejamento por versão.');return;}
  setDraft(old=>[...old,{key:crypto.randomUUID(),kind,resourceRef:ref.trim(),quantityMilli:amount,unit:unit.trim()}]);
  setRef('');setQuantity('1');
 }
 async function save(){
  if(busy||!draft.length)return;
  if(version>0&&reason.trim().length<3){setError('Revisões do plano exigem justificativa.');return;}
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/'+encodeURIComponent(needId)+'/commands',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({command:'set_plan',commandKey:crypto.randomUUID(),reason:reason.trim()||undefined,
      lines:draft.map(({kind,resourceRef,quantityMilli,unit})=>({kind,resourceRef,quantityMilli,unit}))})
   });
   const result=await response.json() as {error?:string;revision?:number};
   if(!response.ok)throw Error(result.error??'Versão do plano recusada.');
   setNotice('Plano registrado na versão '+result.revision+'. O histórico anterior foi preservado.');
   setReason('');onRefresh();
  }catch(ex){setError(ex instanceof Error?ex.message:'Falha na gravação do plano.');}
  finally{setBusy(false);}
 }
 return <section className="enterprise-governance-panel" aria-label="Planejamento versionado da ordem">
  <h3>Planejamento operacional · versão {version}</h3>
  <p>O conjunto planejado é salvo como versão completa, com responsável e justificativa. A liberação bloqueia alterações posteriores.</p>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  <form className="enterprise-governance-panel" onSubmit={append}>
   <div className="form-row">
    <label>Tipo de recurso<select value={kind} onChange={e=>setKind(e.target.value)}>
     {kinds.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></label>
    <label>Recurso / identificação<input required minLength={1} maxLength={200} value={ref} onChange={e=>setRef(e.target.value)}/></label>
    <label>Quantidade prevista<input required value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="8,000"/></label>
    <label>Unidade<input required minLength={1} maxLength={20} value={unit} onChange={e=>setUnit(e.target.value)}/></label>
   </div>
   <button type="submit" disabled={busy||draft.length>=100}>Adicionar ao plano</button>
  </form>
  <table><thead><tr><th>Tipo</th><th>Recurso</th><th>Quantidade prevista</th><th>Ação</th></tr></thead><tbody>
   {draft.map(l=><tr key={l.key}><td>{l.kind}</td><td>{l.resourceRef}</td><td>{decimal(l.quantityMilli)} {l.unit}</td>
    <td><button type="button" disabled={busy} onClick={()=>setDraft(old=>old.filter(x=>x.key!==l.key))}>Remover</button></td></tr>)}
  </tbody></table>
  {!draft.length&&<p>Inclua pelo menos um recurso antes de registrar o plano.</p>}
  {version>0&&<label>Justificativa da revisão<input minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}
   placeholder="Por que o plano foi alterado?"/></label>}
  <button type="button" className="primary" disabled={busy||!draft.length||(version>0&&reason.trim().length<3)} onClick={()=>void save()}>
   {version?'Publicar nova versão auditável':'Publicar planejamento inicial'}
  </button>
  <details><summary>Histórico imutável · {history.length} versões disponíveis</summary>
   {history.map(h=><div key={h.id} className="enterprise-governance-panel">
    <strong>Versão {h.revision}</strong><p>{h.reason} · {h.actorId} · {h.createdAt}</p>
    {h.lines.map((l,i)=><p key={i}>{l.kind} · {l.resourceRef} · {decimal(l.quantityMilli)} {l.unit}</p>)}
   </div>)}
  </details>
 </section>;
}
