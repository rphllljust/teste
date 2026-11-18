'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

type Person={id:string;fullName:string;specialty:string;active:boolean};
type Schedule={startsAt:string;endsAt:string;location:string;version:number};
type Assignment={id:string;personId:string;fullName:string;specialty:string};
type Planning={order:{id:string;status:string;version:number};schedule:Schedule|null;assignments:Assignment[]};
const displayTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));
function datetimeLocal(date:string){const d=new Date(date);const n=new Date(d.getTime()-d.getTimezoneOffset()*60000);return n.toISOString().slice(0,16);}

export default function FieldOrderPlanningPanel({orderId,onChanged}:{orderId:string;onChanged?:()=>void}){
  const [planning,setPlanning]=useState<Planning|null>(null),[people,setPeople]=useState<Person[]>([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [personId,setPersonId]=useState('');
  const [peopleQuery,setPeopleQuery]=useState('');
  const appliedPeopleQuery=useRef('');
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const [a,b]=await Promise.all([
        fetch('/api/orders/'+encodeURIComponent(orderId)+'/planning',{cache:'no-store'}),
        fetch('/api/field/people'+(appliedPeopleQuery.current?
          '?q='+encodeURIComponent(appliedPeopleQuery.current):''),{cache:'no-store'}),
      ]);
      const details=await a.json() as Planning&{error?:string};
      const persons=await b.json() as {items?:Person[];error?:string};
      if(!a.ok||!b.ok)throw new Error(details.error||persons.error||'Planejamento indisponível.');
      setPlanning(details);setPeople(persons.items??[]);setError('');
    }catch(e){setError(e instanceof Error?e.message:'Planejamento indisponível.');}
    finally{setLoading(false);}
  },[orderId]);
  useEffect(()=>{const t=setTimeout(()=>void load(),0);return()=>clearTimeout(t);},[load]);
  const writable=planning&&['draft','authorized'].includes(planning.order.status);
  async function command(body:Record<string,unknown>){
    setSaving(true);setNotice('');
    try{
      const r=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/planning',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({key:crypto.randomUUID(),...body}),
      });
      const data=await r.json() as {error?:string};
      if(!r.ok)throw new Error(data.error||'Planejamento não foi persistido.');
      await load();onChanged?.();setNotice('Planejamento salvo e confirmado no PostgreSQL.');
    }catch(e){setNotice(e instanceof Error?e.message:'Operação recusada.');}
    finally{setSaving(false);}
  }
  function schedule(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!planning)return;
    const f=new FormData(e.currentTarget);
    const start=String(f.get('startsAt')),end=String(f.get('endsAt'));
    const from=new Date(start),to=new Date(end);
    if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())){setNotice('Informe horário válido.');return;}
    void command({command:'set_schedule',expectedVersion:planning.schedule?.version??0,
      startsAt:from.toISOString(),endsAt:to.toISOString(),location:String(f.get('location'))});
  }
  return <section className="module-workspace" aria-label="Planejamento e equipe da ordem">
    <h3>Agendamento e equipe</h3>
    {loading?<p role="status">Consultando agendamento…</p>:error?<p role="alert">{error}
      <button type="button" className="secondary" onClick={()=>void load()}>Tentar novamente</button></p>:planning&&<>
      {planning.schedule?<p><strong>Agendado:</strong> {displayTime(planning.schedule.startsAt)} até {displayTime(planning.schedule.endsAt)} · {planning.schedule.location}</p>:
        <p>Esta OS ainda não possui agendamento operacional.</p>}
      {writable&&<form onSubmit={schedule} key={planning.schedule?.version??0}>
        <label>Início<input type="datetime-local" name="startsAt" required
          defaultValue={planning.schedule?datetimeLocal(planning.schedule.startsAt):''}/></label>
        <label>Fim<input type="datetime-local" name="endsAt" required
          defaultValue={planning.schedule?datetimeLocal(planning.schedule.endsAt):''}/></label>
        <label>Local<input name="location" required minLength={2} maxLength={200}
          defaultValue={planning.schedule?.location??''}/></label>
        <button type="submit" className="secondary" disabled={saving}>
          {planning.schedule?'Atualizar agendamento':'Registrar agendamento'}
        </button>
      </form>}
      <h4>Equipe designada</h4>
      {planning.assignments.length?
        planning.assignments.map(a=><div key={a.id} className="event-row"><span>{a.fullName} · {a.specialty}</span>
          {writable&&<button type="button" className="text-button" disabled={saving}
            onClick={()=>void command({command:'unassign_person',personId:a.personId})}>Desvincular</button>}
        </div>):<p>Sem profissionais designados.</p>}
      {writable&&<div className="form-row">
        <label>Buscar por nome ou especialidade<input value={peopleQuery} maxLength={160}
          onChange={e=>setPeopleQuery(e.target.value)} placeholder="Localizar profissional" /></label>
        <button type="button" className="secondary" disabled={saving||loading}
          onClick={()=>{appliedPeopleQuery.current=peopleQuery.trim();setPersonId('');void load();}}>Buscar</button>
      </div>}
      {writable&&<div className="form-row">
        <label>Selecionar profissional<select value={personId} onChange={e=>setPersonId(e.target.value)}>
          <option value="">Selecione</option>
          {people.filter(p=>p.active&&!planning.assignments.some(a=>a.personId===p.id)).map(p=>
            <option key={p.id} value={p.id}>{p.fullName} · {p.specialty}</option>)}
        </select></label>
        <button type="button" className="secondary" disabled={saving||!personId||!planning.schedule}
          onClick={()=>{void command({command:'assign_person',personId});setPersonId('');}}>
          Designar profissional
        </button>
      </div>}
      {!writable&&<p>Planejamento somente leitura após o início ou encerramento da OS.</p>}
    </>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
