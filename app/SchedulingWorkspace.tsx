'use client';

import {useEffect,useState} from 'react';

type Schedule={id:string;order_id:string;title:string;client:string;start_at:string;end_at:string;timezone:string;status:string;notes:string|null};
type Result={schedules:Schedule[];total:number;hasMore:boolean};

const formatDate=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));

export default function SchedulingWorkspace(){
 const [data,setData]=useState<Result|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [saving,setSaving]=useState(false);
 const [form,setForm]=useState({id:'',orderId:'',startAt:'',endAt:'',notes:''});
 const load=async()=>{setLoading(true);setError('');try{const r=await fetch('/api/schedules?pageSize=50');const body=await r.json();if(!r.ok)throw new Error(body.error||'Agenda indisponível.');setData(body);}catch(e){setError(e instanceof Error?e.message:'Agenda indisponível.');}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setSaving(true);setError('');try{const r=await fetch('/api/schedules',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...form,id:form.id||crypto.randomUUID(),timezone:'America/Porto_Velho'})});const body=await r.json();if(!r.ok)throw new Error(body.error||'Não foi possível agendar.');setForm({id:'',orderId:'',startAt:'',endAt:'',notes:''});await load();}catch(e){setError(e instanceof Error?e.message:'Não foi possível agendar.');}finally{setSaving(false);}};
 return <section className="worklist" aria-busy={loading}><div className="list-title"><div><span className="queue-eyebrow">FIELD SERVICE</span><h2>Agenda operacional</h2><p className="queue-subtitle">Agendamentos vinculados às ordens de serviço.</p></div></div><form className="filters" onSubmit={submit}><label>OS<input required value={form.orderId} onChange={e=>setForm({...form,orderId:e.target.value})} placeholder="UUID da ordem"/></label><label>Início<input required type="datetime-local" value={form.startAt} onChange={e=>setForm({...form,startAt:e.target.value})}/></label><label>Fim<input required type="datetime-local" value={form.endAt} onChange={e=>setForm({...form,endAt:e.target.value})}/></label><label>Observação<input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label><button className="primary" disabled={saving}>{saving?'Agendando…':'Agendar OS'}</button></form>{error&&<p className="form-error" role="alert">{error}</p>}{loading?<div className="empty">Carregando agenda…</div>:!data?.schedules.length?<div className="empty"><h3>Nenhum agendamento</h3><p>A agenda está pronta; o cadastro de pessoas e equipes será conectado na próxima fatia.</p></div>:<div className="table-wrap"><table><thead><tr><th>OS</th><th>Cliente</th><th>Início</th><th>Fim</th><th>Status</th><th>Responsável</th></tr></thead><tbody>{data.schedules.map(item=><tr key={item.id}><td>{item.title}</td><td>{item.client}</td><td>{formatDate(item.start_at)}</td><td>{formatDate(item.end_at)}</td><td>{item.status}</td><td>Não atribuído</td></tr>)}</tbody></table></div>}</section>;
}