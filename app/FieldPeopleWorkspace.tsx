'use client';
import {useCallback,useEffect,useState} from 'react';

type Person={id:string;fullName:string;specialty:string;active:boolean};
export default function FieldPeopleWorkspace(){
  const [items,setItems]=useState<Person[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const r=await fetch('/api/field/people',{cache:'no-store'});
      const data=await r.json() as {items?:Person[];error?:string};
      if(!r.ok)throw new Error(data.error||'Cadastro indisponível.');
      setItems(data.items??[]);setError('');
    }catch(e){setError(e instanceof Error?e.message:'Cadastro indisponível.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[load]);
  async function create(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget,body=new FormData(form);
    setSaving(true);setNotice('');
    try{
      const r=await fetch('/api/field/people',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:crypto.randomUUID(),fullName:String(body.get('fullName')),
          specialty:String(body.get('specialty'))}),
      });
      const result=await r.json() as {error?:string};
      if(!r.ok)throw new Error(result.error||'Não foi possível salvar.');
      form.reset();
      await load();setNotice('Profissional registrado no PostgreSQL.');
    }catch(e){setNotice(e instanceof Error?e.message:'Falha ao salvar.');}
    finally{setSaving(false);}
  }
  return <section className="worklist" aria-label="Pessoas e equipes">
    <header className="list-title"><div><h2>Pessoas e equipes</h2>
      <p>Profissionais registrados para planejamento e execução das ordens de serviço.</p>
    </div><button className="secondary" type="button" disabled={loading} onClick={()=>void load()}>Atualizar</button></header>
    <form onSubmit={create} className="module-workspace">
      <h3>Cadastrar profissional</h3>
      <label>Nome completo<input name="fullName" minLength={2} maxLength={160} required /></label>
      <label>Função ou especialidade<input name="specialty" minLength={2} maxLength={120} required /></label>
      <button className="primary" type="submit" disabled={saving}>Salvar profissional</button>
    </form>
    {notice&&<p role="status">{notice}</p>}
    {error?<div className="empty" role="alert">{error}</div>:loading?
      <div className="empty" role="status">Consultando profissionais…</div>:
      items.length?<div className="table-wrap"><table><thead><tr><th>Profissional</th><th>Especialidade</th><th>Estado</th></tr></thead>
        <tbody>{items.map(person=><tr key={person.id}><td>{person.fullName}</td><td>{person.specialty}</td>
          <td>{person.active?'Ativo':'Inativo'}</td></tr>)}</tbody></table></div>:
        <div className="empty">Nenhum profissional cadastrado para este contexto.</div>}
  </section>;
}
