'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
type Account={id:string;code:string;name:string;type:string;active:number};
type Item={id:string;accountId:string;accountCode:string;accountName:string;plannedScaled:string;actualScaled:string;
 deviationScaled:string;state:'draft'|'approved';rowVersion:number;reference:string};
type Report={items:Item[];summary:{approved:number;drafts:number;plannedScaled:string;actualScaled:string;deviationScaled:string};
 provenance:string;disclaimer:string;error?:string};
function money(v:string){const n=BigInt(v),a=n<0n?-n:n;return (n<0n?'−':'')+'R$ '+
 (a/10000n).toLocaleString('pt-BR')+','+((a%10000n)/100n).toString().padStart(2,'0');}
function scale(value:string){const m=/^([0-9]{1,12})(?:[,.]([0-9]{1,4}))?$/.exec(value.trim());
 if(!m)throw new Error('Use valor sem separador de milhar, com até quatro casas decimais.');
 const n=BigInt(m[1])*10000n+BigInt((m[2]??'').padEnd(4,'0'));if(n<=0n)throw new Error('Valor deve ser positivo.');return n.toString();}
export default function ControllingBudgetBoard({onLedger}:{onLedger:()=>void}){
 const [period,setPeriod]=useState(()=>new Date().toISOString().slice(0,7));
 const [report,setReport]=useState<Report|null>(null),[accounts,setAccounts]=useState<Account[]>([]);
 const [account,setAccount]=useState(''),[value,setValue]=useState(''),[reason,setReason]=useState('');
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0),refresh=useCallback(()=>setRevision(x=>x+1),[]);
 useEffect(()=>{
  const ctl=new AbortController();const load=async()=>{
   setLoading(true);setError('');
   try{const [r,a]=await Promise.all([
    fetch('/api/controlling/budgets?'+new URLSearchParams({periodMonth:period}),{cache:'no-store',signal:ctl.signal}),
    fetch('/api/accounting/accounts',{cache:'no-store',signal:ctl.signal})]);
    const data=await r.json() as Report;const acc=await a.json() as {items:Account[];error?:string};
    if(!r.ok||!a.ok)throw Error(data.error??acc.error??'Orçamento indisponível.');
    if(!ctl.signal.aborted){setReport(data);setAccounts(acc.items.filter(x=>x.active===1&&(x.type==='expense'||x.type==='revenue')));}
   }catch(e){if(!ctl.signal.aborted)setError(e instanceof Error?e.message:'Falha de consulta.');}
   finally{if(!ctl.signal.aborted)setLoading(false);}
  };void load();return()=>ctl.abort();
 },[period,revision]);
 const available=useMemo(()=>accounts.filter(a=>!report?.items.some(b=>b.accountId===a.id)),[accounts,report]);
 async function create(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setNotice('');setError('');
  try{const r=await fetch('/api/controlling/budgets',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id:crypto.randomUUID(),accountId:account,periodMonth:period,plannedScaled:scale(value),reference:reason})});
   const d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error??'Falha no cadastro.');
   setValue('');setReason('');setAccount('');setNotice('Dotação em rascunho registrada com auditoria.');refresh();
  }catch(e){setError(e instanceof Error?e.message:'Falha no cadastro.');}finally{setSaving(false);}}
 async function approve(b:Item){
  if(!window.confirm('Aprovar esta dotação? Após aprovação ela fica imutável.'))return;
  setSaving(true);setError('');setNotice('');
  try{const r=await fetch('/api/controlling/budgets/commands',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({key:crypto.randomUUID(),budgetId:b.id,expectedVersion:b.rowVersion,command:'approve'})});
   const d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error??'Falha ao aprovar.');
   setNotice('Dotação aprovada e auditada.');refresh();
  }catch(e){setError(e instanceof Error?e.message:'Falha ao aprovar.');}finally{setSaving(false);}}
 return <section className="worklist" aria-label="Orçamento gerencial x realizado" aria-busy={loading}>
  <header className="list-title"><div><h2>Controladoria · orçamento x realizado</h2><p>Dotações por conta e competência confrontadas com débitos/créditos efetivamente publicados no razão.</p></div>
   <label>Competência <input type="month" aria-label="Competência orçamentária" value={period} onChange={e=>setPeriod(e.target.value)}/></label></header>
  {error&&<p className="linked-info" role="alert">{error}</p>}{notice&&<p className="linked-info" role="status">{notice}</p>}
  {loading?<p role="status">Conferindo saldos contábeis…</p>:report&&<>
   <section className="metrics linked-metrics" aria-label="Orçamento aprovado">
    <div><span>Orçado aprovado</span><strong>{money(report.summary.plannedScaled)}</strong></div>
    <div><span>Realizado das contas orçadas</span><strong>{money(report.summary.actualScaled)}</strong></div>
    <div><span>Desvio realizado - orçado</span><strong>{money(report.summary.deviationScaled)}</strong></div>
    <div><span>Dotações</span><strong>{report.summary.approved} aprovadas · {report.summary.drafts} rascunhos</strong></div>
   </section>
   {report.items.length?<div className="table-wrap"><table><thead><tr><th>Conta</th><th>Estado</th><th>Orçado</th><th>Realizado</th><th>Desvio</th><th>Ação</th></tr></thead><tbody>
   {report.items.map(b=><tr key={b.id}><td><strong>{b.accountCode} · {b.accountName}</strong><small>{b.reference}</small></td>
    <td>{b.state==='approved'?'Aprovado':'Rascunho'}</td><td>{money(b.plannedScaled)}</td>
    <td>{money(b.actualScaled)}</td><td>{money(b.deviationScaled)}</td>
    <td>{b.state==='draft'?<button disabled={saving} onClick={()=>void approve(b)}>Aprovar</button>:
     <button className="secondary" onClick={onLedger}>Razão</button>}</td></tr>)}
   </tbody></table></div>:<p className="empty">Nenhuma dotação registrada. Não existe orçamento sintético.</p>}
   <form onSubmit={create} className="filters linked-filters">
    <label>Conta<select required value={account} onChange={e=>setAccount(e.target.value)}><option value="">Escolha receita/despesa</option>
     {available.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
    <label>Valor em BRL<input required value={value} onChange={e=>setValue(e.target.value)} placeholder="15000,00"/></label>
    <label>Justificativa<input required minLength={3} maxLength={160} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button type="submit" disabled={saving||!account||!available.length} className="primary">{saving?'Registrando…':'Criar dotação'}</button>
   </form>
   <footer className="table-footer"><span>{report.provenance}</span><span>{report.disclaimer}</span></footer>
  </>}
 </section>;
}
