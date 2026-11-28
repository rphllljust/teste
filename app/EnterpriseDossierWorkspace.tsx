'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, BookOpenText, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, DatabaseZap, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { EnterpriseObjectSectionNavigation, EnterprisePageHeader } from './components/enterprise/EnterprisePrimitives';
import { EnterpriseSmartGrid, type EnterpriseSmartColumn } from './components/enterprise/EnterpriseSmartGrid';
import EnterpriseOrderAuditTimeline from './components/enterprise/EnterpriseOrderAuditTimeline';

type DossierListItem = {
  id: string; title: string; client: string; state: string; createdAt: string;
  dueDate: string | null; billedScaled: string; settledScaled: string;
  evidence: { executions: number; measurements: number; invoices: number; receivables: number };
};
type ListResponse = {
  items: DossierListItem[];
  pageInfo: { page: number; pageSize: number; total: number; hasMore: boolean };
  source: string;
};
type Evidence = {
  id: string; reference: string; state: string; createdAt: string | null;
  amountScaled?: string; module: string;
};
type Stage = {
  key: string; title: string; module: string;
  state: 'linked' | 'not_linked'; items: Evidence[]; truncated: boolean;
};
type Dossier = {
  order: {
    id: string; title: string; client: string; status: string;
    version: number; category: string; description: string;
    createdAt: string; dueDate: string | null;
  };
  financials: { billedScaled: string; settledScaled: string; outstandingScaled: string; note: string };
  assurance: {
    invoicePostings: {total:number;verified:number};
    settlementPostings: {total:number;verified:number};
    scope:'limited_to_displayed_documents';truncated:boolean;
  };
  stages: Stage[];
  alerts: Array<{ code: string; severity: 'info'|'warning'; message: string }>;
  history: Array<{ id: string; command: string; createdAt: string }>;
  provenance: { source: string; ownerScoped: boolean; consistency: string; warning: string };
};
type Props = { navigate: (module: string,orderId?:string) => void; onOpenOrder: (id: string) => void; initialOrderId?:string|null };
type ApiFailure = { error?: string; code?: string };
const labels: Record<string,string> = {
  draft:'Rascunho',authorized:'Autorizada',executing:'Em execução',
  completed:'Concluída',cancelled:'Cancelada',
  posted:'Lançado',approved:'Aprovada',billed:'Faturada',registered:'Registrado',
  receipt:'Recebimento',reversal:'Estorno',
};
const statusLabel = (status: string) => labels[status] ?? status;

function dateLabel(raw: string | null): string {
  if (!raw) return 'Não informado';
  const value = raw.length === 10 ? raw + 'T12:00:00Z' : raw;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? raw : new Intl.DateTimeFormat('pt-BR', {
    dateStyle:'short',timeZone:'UTC',
  }).format(date);
}

/** Display a PostgreSQL integer in 1/10_000 BRL units without precision loss. */
function scaledMoney(raw: string): string {
  if (!/^-?\d+$/.test(raw)) return '—';
  const n = BigInt(raw);
  const sign = n < 0n ? '−' : '';
  const absolute = (n < 0n ? -n : n).toString().padStart(5, '0');
  const integer = absolute.slice(0, -4).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const decimals = absolute.slice(-4);
  return sign + 'R$ ' + integer + ',' + (decimals.endsWith('00') ? decimals.slice(0, 2) : decimals);
}

class HmlSessionRequired extends Error {}
async function json<T>(response:Response):Promise<T>{
  const value = await response.json() as T & ApiFailure;
  if (response.status === 403 && value.code === 'STAGING_PRIVATE_ACCESS_REQUIRED')
    throw new HmlSessionRequired('Entre com a credencial de homologação para consultar os dossiês.');
  if (!response.ok) throw new Error(value.error ?? 'Não foi possível consultar os registros empresariais.');
  return value;
}

export default function EnterpriseDossierWorkspace({navigate,onOpenOrder,initialOrderId=null}:Props){
  const [search,setSearch] = useState('');
  const [query,setQuery] = useState('');
  const [status,setStatus] = useState('all');
  const [page,setPage] = useState(1);
  const [revision,setRevision] = useState(0);
  const [list,setList] = useState<ListResponse|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [needsAuth,setNeedsAuth] = useState(false);
  const [loginBusy,setLoginBusy] = useState(false);
  const [selectedId,setSelectedId] = useState<string|null>(initialOrderId);
  const [detail,setDetail] = useState<Dossier|null>(null);
  const [detailLoading,setDetailLoading] = useState(false);
  const [detailError,setDetailError] = useState('');

  useEffect(()=>{
    const timer=setTimeout(()=>{setPage(1);setQuery(search.trim());},260);
    return ()=>clearTimeout(timer);
  },[search]);

  useEffect(()=>{
    const abort=new AbortController();
    const params=new URLSearchParams({q:query,status,page:String(page),pageSize:'20'});
    const timer=setTimeout(async()=>{
      setLoading(true);setError('');
      try{
        const result=await json<ListResponse>(await fetch('/api/enterprise/journeys?'+params,{
          cache:'no-store',credentials:'same-origin',signal:abort.signal,
        }));
        if(!abort.signal.aborted){setList(result);setNeedsAuth(false);}
      }catch(cause){
        if(!abort.signal.aborted){
          setList(null);
          if(cause instanceof HmlSessionRequired)setNeedsAuth(true);
          setError(cause instanceof Error?cause.message:'Consulta empresarial indisponível.');
        }
      }finally{if(!abort.signal.aborted)setLoading(false);}
    },0);
    return ()=>{clearTimeout(timer);abort.abort();};
  },[query,status,page,revision]);

  useEffect(()=>{
    if(!selectedId){return;}
    const abort=new AbortController();
    const timer=setTimeout(async()=>{
      setDetailLoading(true);setDetailError('');setDetail(null);
      try{
        const result=await json<Dossier>(await fetch('/api/enterprise/journeys/'+encodeURIComponent(selectedId),{
          cache:'no-store',credentials:'same-origin',signal:abort.signal,
        }));
        if(!abort.signal.aborted)setDetail(result);
      }catch(cause){
        if(!abort.signal.aborted){
          if(cause instanceof HmlSessionRequired){
            setNeedsAuth(true);
            setSelectedId(null);
          }
          setDetailError(cause instanceof Error?cause.message:'Dossiê indisponível.');
        }
      }finally{if(!abort.signal.aborted)setDetailLoading(false);}
    },0);
    return ()=>{clearTimeout(timer);abort.abort();};
  },[selectedId,revision]);


  useEffect(()=>{
    if(!selectedId)return;
    const previous=document.activeElement as HTMLElement|null;
    const listener=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();setSelectedId(null);setDetail(null);return;
      }
      if(event.key!=='Tab')return;
      const overlay=document.querySelector<HTMLElement>('.enterprise-dossier-drawer');
      if(!overlay)return;
      const controls=[...overlay.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled)')]
        .filter(element=>element.getClientRects().length>0);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',listener);
    return ()=>{document.removeEventListener('keydown',listener);previous?.focus();};
  },[selectedId]);
  async function loginHml(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(loginBusy)return;
    const form=event.currentTarget;
    const passphrase=String(new FormData(form).get('passphrase')??'');
    setLoginBusy(true);
    try{
      const response=await fetch('/api/auth/staging-login',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({passphrase}),
      });
      const result=await response.json() as {authenticated?:boolean;error?:string};
      if(!response.ok||result.authenticated!==true)
        throw new Error(result.error??'Credencial de homologação não autorizada.');
      form.reset();
      setNeedsAuth(false);
      setError('');
      setDetailError('');
      setRevision(previous=>previous+1);
    }catch(cause){
      form.reset();
      setError(cause instanceof Error?cause.message:'Falha ao autenticar no ambiente de homologação.');
    }finally{
      setLoginBusy(false);
    }
  }
  const dossierColumns:EnterpriseSmartColumn<DossierListItem>[]=[
    {key:'document',title:'Documento e cliente',required:true,
      render:item=><span className="enterprise-smart-primary"><strong>{item.title}</strong><small>{item.client} · {item.id.slice(0,8).toUpperCase()}</small></span>,
      text:item=>item.id+' · '+item.title+' · '+item.client,sortValue:item=>item.title},
    {key:'state',title:'Situação da OS',
      render:item=><span className={'enterprise-dossier-status status-'+item.state}>{statusLabel(item.state)}</span>,
      text:item=>statusLabel(item.state),sortValue:item=>item.state},
    {key:'execution',title:'Execuções',render:item=>item.evidence.executions,
      text:item=>String(item.evidence.executions),sortValue:item=>item.evidence.executions,align:'end'},
    {key:'measurements',title:'Medições',render:item=>item.evidence.measurements,
      text:item=>String(item.evidence.measurements),sortValue:item=>item.evidence.measurements,align:'end'},
    {key:'invoices',title:'Faturas',render:item=>item.evidence.invoices,
      text:item=>String(item.evidence.invoices),sortValue:item=>item.evidence.invoices,align:'end'},
    {key:'billed',title:'Faturado',render:item=>scaledMoney(item.billedScaled),
      text:item=>scaledMoney(item.billedScaled),align:'end'},
    {key:'settled',title:'Recebido líquido',render:item=>scaledMoney(item.settledScaled),
      text:item=>scaledMoney(item.settledScaled),align:'end'},
  ];
  const reload=()=>setRevision(r=>r+1);
  const select=(id:string)=>{setDetail(null);setDetailError('');setSelectedId(id);};
  const close=()=>{setSelectedId(null);setDetail(null);setDetailError('');};
  return <section className="enterprise-dossier" aria-label="Dossiês de processos empresariais">
    <EnterprisePageHeader
      eyebrow="PROCESSOS INTEGRADOS · CISNE TIER 1"
      breadcrumb="CISNE / Gestão empresarial / Dossiês"
      title="Dossiês empresariais"
      description="Rastreabilidade comercial, operacional, financeira e contábil baseada exclusivamente nos documentos persistidos no PostgreSQL."
      actions={<button type="button" className="secondary" disabled={loading} onClick={reload}>
        <RefreshCw size={16} aria-hidden="true"/> Atualizar evidências
      </button>}
    />
    <div className="enterprise-dossier-notice" role="note">
      <ShieldCheck size={19} aria-hidden="true"/>
      <p><strong>Consulta empresarial autenticada.</strong> Apenas ordens de serviço pertencentes ao contexto autorizado.
      Os vínculos exibidos não representam aprovação automática, liquidação, encerramento ou emissão fiscal.</p>
    </div>
    <div className="enterprise-dossier-toolbar">
      <label className="enterprise-dossier-search"><span>Localizar processo</span>
        <span className="enterprise-dossier-search-input"><Search size={17} aria-hidden="true"/>
          <input type="search" value={search} onChange={event=>setSearch(event.target.value)}
            placeholder="Número, título da OS ou cliente" aria-label="Buscar processos empresariais"/>
        </span>
      </label>
      <label><span>Situação da OS</span>
        <select value={status} onChange={event=>{setPage(1);setStatus(event.target.value);}}>
          <option value="all">Todas</option><option value="draft">Rascunho</option>
          <option value="authorized">Autorizada</option><option value="executing">Em execução</option>
          <option value="completed">Concluída</option><option value="cancelled">Cancelada</option>
        </select>
      </label>
    </div>
    {error && <div className="enterprise-dossier-error" role="alert">
      <CircleAlert size={18} aria-hidden="true"/><p>{error}</p>
      <button className="secondary" type="button" onClick={reload}>Tentar novamente</button>
    </div>}
    {needsAuth&&<section className="enterprise-dossier-auth" aria-labelledby="enterprise-dossier-auth-title">
      <div><span className="eyebrow">ACESSO CONTROLADO · SOMENTE HOMOLOGAÇÃO</span>
        <h2 id="enterprise-dossier-auth-title">Entrar no CISNE HML</h2>
        <p>Os dossiês exigem sessão assinada. A credencial não é gravada no navegador e libera somente os documentos autorizados ao operador de homologação.</p>
      </div>
      <form onSubmit={event=>{void loginHml(event);}}>
        <label>Credencial de homologação
          <input name="passphrase" type="password" minLength={24} maxLength={160}
            autoComplete="off" placeholder="Insira sua credencial de homologação" required/>
        </label>
        <button type="submit" className="primary" disabled={loginBusy}>
          {loginBusy?'Autenticando…':'Entrar nos Dossiês'}
        </button>
      </form>
    </section>}
    {loading ? <div className="enterprise-dossier-loading" role="status">Consultando cadeia empresarial…</div>
    : list ? <>
      <div className="enterprise-dossier-list-meta" aria-live="polite">
        <span><strong>{list.pageInfo.total}</strong> processo(s) no contexto da consulta</span>
        <span>Consulta persistida · PostgreSQL · sem estimativas</span>
      </div>
      {list.items.length===0 ? <div className="enterprise-dossier-empty" role="status">
        <BookOpenText size={24} aria-hidden="true"/>
        <strong>Nenhum processo corresponde aos filtros.</strong>
        <span>Os vínculos de ordens históricas sem proprietário não são expostos.</span>
      </div> :
      <EnterpriseSmartGrid viewId="enterprise-dossiers" caption="Tabela de processos empresariais"
        currentPageLabel={'Página '+list.pageInfo.page+' · '+list.pageInfo.total+' processos autorizados'}
        rows={list.items} columns={dossierColumns} getRowKey={item=>item.id}
        onOpen={item=>select(item.id)} openLabel={item=>'Abrir dossiê da OS '+item.title}/>}
      <div className="enterprise-dossier-pagination">
        <span>Página {list.pageInfo.page} · total {list.pageInfo.total}</span>
        <div><button type="button" className="secondary" disabled={page===1} onClick={()=>setPage(v=>Math.max(1,v-1))}>
          <ChevronLeft size={16} aria-hidden="true"/> Anterior</button>
        <button type="button" className="secondary" disabled={!list.pageInfo.hasMore} onClick={()=>setPage(v=>v+1)}>
          Próxima <ChevronRight size={16} aria-hidden="true"/></button></div>
      </div>
    </>:null}

    {selectedId && <div className="overlay enterprise-dossier-overlay" onClick={close}>
      <aside className="enterprise-dossier-drawer" role="dialog" aria-modal="true"
        aria-label="Dossiê empresarial transacional" onClick={e=>e.stopPropagation()}>
        <header className="enterprise-dossier-drawer-head">
          <div><span className="eyebrow">DOCUMENTO TRANSACIONAL · LEITURA VERIFICADA</span>
          <h2>Dossiê empresarial</h2></div>
          <button type="button" className="icon-button" aria-label="Fechar dossiê" onClick={close} autoFocus>
            <X size={22}/>
          </button>
        </header>
        {detailLoading&&<p role="status" className="enterprise-dossier-loading">Reconstruindo documentos relacionados…</p>}
        {detailError&&<div role="alert" className="enterprise-dossier-error">
          <CircleAlert size={18} aria-hidden="true"/>{detailError}
          <button type="button" className="secondary" onClick={reload}>Tentar novamente</button>
        </div>}
        {detail&&<>
          <div className="enterprise-dossier-object-head">
            <span className="eyebrow">OS · {detail.order.id.slice(0,8).toUpperCase()}</span>
            <h2>{detail.order.title}</h2>
            <p>{detail.order.client} · {detail.order.category}</p>
            <div className="enterprise-dossier-factrow">
              <div><span>Situação confirmada</span><strong>{statusLabel(detail.order.status)}</strong></div>
              <div><span>Registrada em</span><strong>{dateLabel(detail.order.createdAt)}</strong></div>
              <div><span>Vencimento previsto</span><strong>{dateLabel(detail.order.dueDate)}</strong></div>
            </div>
            <button type="button" className="secondary" onClick={()=>{const id=detail.order.id;close();onOpenOrder(id);}}>
              <ClipboardList size={16} aria-hidden="true"/> Abrir ordem de serviço
            </button>
          </div>
          <EnterpriseObjectSectionNavigation rootSelector=".enterprise-dossier-drawer"
            label="Navegação pelas seções da cadeia empresarial"
            sections={[
              {id:'dossier-financials',label:'Valores'},
              ...detail.stages.map(stage=>({id:'dossier-'+stage.key,label:stage.title})),
              {id:'dossier-history',label:'Auditoria'},
            ]}/>
          <div id="dossier-financials" className="enterprise-dossier-financials" aria-label="Conciliação de valores da cadeia identificada">
            <div><span>Faturado identificado</span><strong>{scaledMoney(detail.financials.billedScaled)}</strong></div>
            <div><span>Recebimentos líquidos</span><strong>{scaledMoney(detail.financials.settledScaled)}</strong></div>
            <div><span>Diferença documental</span><strong>{scaledMoney(detail.financials.outstandingScaled)}</strong></div>
            <p>{detail.financials.note} Não equivale ao saldo contábil global do cliente.</p>
            <p role="note"><strong>Evidências de integração contábil:</strong> faturas verificadas
              {' '+detail.assurance.invoicePostings.verified+' de '+detail.assurance.invoicePostings.total}
              {' · '}baixas/estornos verificados
              {' '+detail.assurance.settlementPostings.verified+' de '+detail.assurance.settlementPostings.total}.
              {' '}Os números comprovam apenas os documentos exibidos neste dossiê.
              {detail.assurance.truncated&&' A lista foi truncada; esta proporção não representa a jornada completa.'}
            </p>
          </div>
          {detail.alerts.length>0&&<section className="enterprise-dossier-alerts" aria-label="Pontos de atenção da rastreabilidade">
            <h3>Pontos de atenção</h3>
            {detail.alerts.map(alert=><p key={alert.code} className={'enterprise-dossier-alert severity-'+alert.severity}>
              <CircleAlert size={16} aria-hidden="true"/>{alert.message}
            </p>)}
          </section>}
          <section className="enterprise-dossier-stages" aria-labelledby="enterprise-dossier-stages-title">
            <div className="enterprise-dossier-section-head">
              <h3 id="enterprise-dossier-stages-title">Rastreabilidade documental</h3>
              <span>{detail.stages.filter(stage=>stage.state==='linked').length} de {detail.stages.length} etapas com registros</span>
            </div>
            <p className="enterprise-dossier-legend">Etapas com registros não representam processos concluídos. Cada situação corresponde ao estado efetivamente persistido.</p>
            {detail.stages.map((stage,index)=><section key={stage.key} id={'dossier-'+stage.key}
              className="enterprise-dossier-stage" aria-label={stage.title}>
              <div className="enterprise-dossier-stage-heading">
                <span className="enterprise-dossier-stage-number">{String(index+1).padStart(2,'0')}</span>
                <div><h4>{stage.title}</h4>
                  <small>{stage.state==='linked'?'Vínculos recuperados':'Sem vínculo confirmado'}</small></div>
                <button type="button" className="secondary" onClick={()=>{close();navigate(stage.module,['Execução','Medições','Faturamento','Financeiro'].includes(stage.module)?detail.order.id:undefined);}}
                  aria-label={'Abrir módulo '+stage.module}>Abrir módulo <ArrowRight size={14}/></button>
              </div>
              {stage.items.length>0?<ul className="enterprise-dossier-evidence">
                {stage.items.map(item=><li key={item.id}>
                  <div><strong>{item.reference}</strong>
                    <small>{statusLabel(item.state)} · {dateLabel(item.createdAt)}</small></div>
                  {item.amountScaled!==undefined&&<span className="enterprise-dossier-num">{scaledMoney(item.amountScaled)}</span>}
                </li>)}
              </ul>:<p className="enterprise-dossier-stage-empty">Nenhum documento desta etapa foi identificado a partir da OS autorizada.</p>}
              {stage.truncated&&<p className="enterprise-dossier-limit">Exibindo somente os 50 registros mais recentes nesta etapa.</p>}
            </section>)}
          </section>
          <section id="dossier-history" className="enterprise-dossier-history">
            <h3>Histórico da ordem</h3>
            {detail.history.length? <ol>{detail.history.map(event=><li key={event.id}>
              <strong>{event.command}</strong><span>{dateLabel(event.createdAt)}</span>
            </li>)}</ol>:<p>Nenhum evento de OS disponível.</p>}
          </section>
          <EnterpriseOrderAuditTimeline key={detail.order.id+'-'+revision} orderId={detail.order.id}/>
          <footer className="enterprise-dossier-provenance">
            <DatabaseZap size={16} aria-hidden="true"/>
            <p>Consulta autenticada com leitura consistente no banco de dados.
              {detail.provenance.warning}</p>
          </footer>
        </>}
      </aside>
    </div>}
  </section>;
}
