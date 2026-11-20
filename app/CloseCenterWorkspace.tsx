'use client';
import { EnterpriseDataGrid } from './components/enterprise/EnterprisePrimitives';


import { EnterpriseButton, EnterpriseInput, EnterpriseSearchField, EnterpriseSelectField,} from './components/enterprise/EnterprisePrimitives';
import { useCallback, useEffect, useRef, useState } from 'react';

type Close = { id: string; periodStart: string; periodEnd: string; status: string; closedAt: string; reference: string };
const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const timestamp = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function CloseCenterWorkspace() {
  const [items, setItems] = useState<Close[]>([]);
  const [q,setQ]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [sort,setSort]=useState('periodEnd.desc'),[page,setPage]=useState(1);
  const [total,setTotal]=useState(0),[hasMore,setHasMore]=useState(false);
  const generation=useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState('');

  const load=useCallback(async()=>{
    const requestId=++generation.current;
    setLoading(true);setError('');
    try{
      const params=new URLSearchParams({q,from,to,sort,page:String(page)});
      const response=await fetch('/api/finance/periods/close?'+params,{cache:'no-store'});
      const data=await response.json() as {
       items:Close[];pageInfo:{page:number;total:number;hasMore:boolean};error?:string
      };
      if(!response.ok)throw new Error(data.error||'Centro indisponível.');
      if(requestId!==generation.current)return;
      setItems(data.items);setTotal(data.pageInfo.total);setHasMore(data.pageInfo.hasMore);
    }catch(cause){
      if(requestId!==generation.current)return;
      setItems([]);setTotal(0);setHasMore(false);
      setError(cause instanceof Error?cause.message:'Centro indisponível.');
    }finally{if(requestId===generation.current)setLoading(false);}
  },[q,from,to,sort,page]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function execute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/finance/periods/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: key, periodStart: form.get('periodStart'), periodEnd: form.get('periodEnd'), reference: form.get('reference') }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error);
      setRunning(false); await load(); setNotice('Período fechado com auditoria e bloqueio transacional ativo.');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Falha ao fechar o período.'); }
    finally { setSaving(false); }
  }

  return <section className="worklist" aria-busy={loading}>
    <div className="list-title"><div><h2>Fechamento financeiro</h2><p>Períodos fechados com auditoria. Baixas, pagamentos, transferências e importações retroativas são bloqueados.</p></div><EnterpriseButton type="button" className="primary" onClick={() => { setKey(crypto.randomUUID()); setRunning(true); setNotice(''); }}>Fechar período</EnterpriseButton></div>
    <div className="linked-info">O fechamento é idempotente, por proprietário e não permite sobreposição de períodos.</div>
    <div className="filters enterprise-close-report-filters">
      <EnterpriseSearchField label="Buscar referência de fechamento" placeholder="Referência documentada" value={q} onValueChange={value=>{setQ(value);setPage(1);}}/>
      <label>Encerramento a partir de<EnterpriseInput type="date" value={from} onChange={e=>{setFrom(e.currentTarget.value);setPage(1);}}/></label>
      <label>Encerramento até<EnterpriseInput type="date" value={to} min={from||undefined} onChange={e=>{setTo(e.currentTarget.value);setPage(1);}}/></label>
      <EnterpriseSelectField label="Ordenação dos fechamentos" value={sort} onValueChange={value=>{setSort(value);setPage(1);}} options={[
        {value:'periodEnd.desc',label:'Períodos mais recentes'},
        {value:'periodEnd.asc',label:'Períodos mais antigos'},
        {value:'closedAt.desc',label:'Fechamentos registrados recentemente'},
      ]}/>
      <EnterpriseButton type="button" className="secondary" onClick={()=>{setQ('');setFrom('');setTo('');setSort('periodEnd.desc');setPage(1);}}>Limpar filtros</EnterpriseButton>
    </div>
    {error ? <div className="empty" role="alert">{error}<EnterpriseButton type="button" className="secondary" onClick={() => void load()}>Tentar novamente</EnterpriseButton></div> : loading ? <div className="empty" role="status">Consultando períodos fechados…</div> : items.length ? <EnterpriseDataGrid<Close>
  caption="Períodos contábeis fechados"
  rows={items}
  getRowKey={(item)=>item.id}
  columns={[
 {key:'period',header:'Período',render:item=><span>{date(item.periodStart)} a {date(item.periodEnd)}</span>},
 {key:'reference',header:'Referência',render:item=>item.reference||'—'},
 {key:'closed',header:'Fechado em',render:item=>timestamp(item.closedAt)},
 {key:'status',header:'Status',render:item=><span className="badge">{item.status==='closed'?'Fechado':item.status}</span>}
]}
 /> : <div className="empty"><h3>Nenhum período fechado</h3><p>Feche o primeiro período depois de conferir os lançamentos e a conciliação.</p></div>}
    <nav className="table-footer" aria-label="Paginação dos períodos fechados">
      <span role="status">{error?'Consulta indisponível':loading?'Consultando…':`${items.length} de ${total} períodos · página ${page}`}</span>
      <div className="pagination">
       <EnterpriseButton type="button" className="secondary" disabled={loading||page===1} onClick={()=>setPage(n=>Math.max(1,n-1))}>Anterior</EnterpriseButton>
       <EnterpriseButton type="button" className="secondary" disabled={loading||!hasMore} onClick={()=>setPage(n=>n+1)}>Próxima</EnterpriseButton>
      </div>
    </nav>
    {notice && !running && <p role="status" className="linked-info">{notice}</p>}
    {running && <div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Fechar período"><header><h2>Fechar período</h2><EnterpriseButton type="button" className="icon-button" onClick={() => setRunning(false)} aria-label="Fechar janela">Fechar</EnterpriseButton></header><form onSubmit={execute}><div className="form-row"><label>Início<EnterpriseInput type="date" name="periodStart" required /></label><label>Fim<EnterpriseInput type="date" name="periodEnd" required /></label></div><label>Referência<EnterpriseInput name="reference" minLength={1} maxLength={160} placeholder="Ex.: Fechamento novembro/2026" required /></label><p className="muted">Após confirmar, operações com data dentro do período serão recusadas com conflito e permanecerão auditadas.</p>{notice && <p role="alert" className="form-error">{notice}</p>}<footer><EnterpriseButton type="button" className="secondary" onClick={() => setRunning(false)}>Cancelar</EnterpriseButton><EnterpriseButton type="submit" className="primary" disabled={saving}>Confirmar fechamento</EnterpriseButton></footer></form></section></div>}
  </section>;
}
