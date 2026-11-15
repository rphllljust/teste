'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Plus, RefreshCw, Search, Users, X } from 'lucide-react';

type Lead = {
  id:string; contactName:string; companyName:string; contactEmail:string|null;
  source:string; status:'new'|'qualified'|'disqualified'; clientId:string|null;
  rowVersion:number; createdAt:string;
};
type Opportunity = {
  id:string; leadId:string; clientId:string|null; title:string; amountCents:string;
  stage:'discovery'|'proposal'|'negotiation'|'won'|'lost'; rowVersion:number; createdAt:string;
};
type Client = {id:string;legalName:string};
type Snapshot = {
  leads:Lead[]; opportunities:Opportunity[]; clients:Client[];
  totals:{leads:number;opportunities:number}; limits:{leads:number;opportunities:number};
  error?:string;code?:string;
};
type Notice = {message:string;error:boolean};
const stages:Opportunity['stage'][]=['discovery','proposal','negotiation','won','lost'];
const stageLabel:Record<Opportunity['stage'],string>={
  discovery:'Diagnóstico',proposal:'Proposta',negotiation:'Negociação',won:'Ganha',lost:'Perdida',
};
const sourceLabel:Record<string,string>={manual:'Manual',referral:'Indicação',web:'Site',event:'Evento'};
const nextStage:Record<Opportunity['stage'],Opportunity['stage']|null>={
  discovery:'proposal',proposal:'negotiation',negotiation:'won',won:null,lost:null,
};
function money(cents:string){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents)/100);}
function parseMoney(input:string):number{
  if(!/^\d{1,10}(?:[,.]\d{1,2})?$/.test(input.trim()))throw new Error('Informe o valor em reais (ex.: 1250,50).');
  const cents=Math.round(Number(input.replace(',','.'))*100);
  if(!Number.isSafeInteger(cents)||cents<0)throw new Error('Valor monetário inválido.');
  return cents;
}

export default function CRMWorkspace({onClients,onProposals}:{onClients:()=>void;onProposals:()=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [loading,setLoading]=useState(true),[sending,setSending]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState<Notice|null>(null);
  const [needsAuth,setNeedsAuth]=useState(false),[loginBusy,setLoginBusy]=useState(false);
  const [tab,setTab]=useState<'leads'|'opportunities'>('leads');
  const [query,setQuery]=useState('');
  const [newLeadOpen,setNewLeadOpen]=useState(false);
  const [qualifyLead,setQualifyLead]=useState<Lead|null>(null);
  const [opportunityLead,setOpportunityLead]=useState<Lead|null>(null);
  const [qualifyClient,setQualifyClient]=useState('');
  const [attempt,setAttempt]=useState<{key:string;encoded:string}|null>(null);
  const busy=useRef(false);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/crm',{cache:'no-store'});
      const data=await response.json() as Snapshot;
      if(!response.ok){if(response.status===403||response.status===401)setNeedsAuth(true);throw new Error(data.error||'CRM indisponível.');}
      setNeedsAuth(false);setSnapshot(data);
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível consultar o CRM.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{
    // Schedule the initial network read after commit; do not synchronously
    // cascade a loading-state update from an effect.
    const handle=window.setTimeout(()=>{void load();},0);
    return ()=>window.clearTimeout(handle);
  },[load]);

  async function login(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(loginBusy)return;
    setLoginBusy(true);setNotice(null);
    const form=e.currentTarget;
    const passphrase=String(new FormData(form).get('passphrase')||'');
    try{
      const response=await fetch('/api/auth/staging-login',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({passphrase}),
      });
      const body=await response.json() as {authenticated?:boolean;error?:string};
      if(!response.ok||!body.authenticated)throw new Error(body.error||'Acesso não autorizado.');
      form.reset();
      setNotice({message:'Sessão de homologação autenticada. Dados liberados conforme o proprietário autorizado.',error:false});
      await load();
    }catch(err){setNotice({message:err instanceof Error?err.message:'Falha na autenticação.',error:true});}
    finally{setLoginBusy(false);}
  }
  const send=useCallback(async(payload:Record<string,unknown>)=>{
    if(busy.current)return false;
    busy.current=true;setSending(true);setNotice(null);
    const encoded=JSON.stringify(payload);
    const id=String(payload.key);
    if(attempt&&attempt.encoded!==encoded){
      setNotice({message:'O comando mudou após uma tentativa. Feche e reabra o formulário para continuar com segurança.',error:true});
      busy.current=false;setSending(false);return false;
    }
    setAttempt({key:id,encoded});
    try{
      const response=await fetch('/api/crm',{method:'POST',headers:{'Content-Type':'application/json'},body:encoded});
      const result=await response.json() as {error?:string};
      if(!response.ok)throw new Error(result.error||'O comando não foi confirmado.');
      setAttempt(null);setNotice({message:'Alteração registrada e confirmada no PostgreSQL do Field.',error:false});
      await load();
      return true;
    }catch(e){setNotice({message:e instanceof Error?e.message:'Falha no comando comercial.',error:true});return false;}
    finally{busy.current=false;setSending(false);}
  },[attempt,load]);
  function resetForms(){
    if(sending)return;
    setNewLeadOpen(false);setQualifyLead(null);setOpportunityLead(null);setQualifyClient('');
    setAttempt(null);
  }

  async function submitLead(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    const email=String(f.get('contactEmail')||'').trim();
    const command={
      action:'createLead',key:attempt?.key??crypto.randomUUID(),
      lead:{id:crypto.randomUUID(),contactName:String(f.get('contactName')||'').trim(),
        companyName:String(f.get('companyName')||'').trim(),contactEmail:email||null,
        source:String(f.get('source')||'manual')},
    };
    // Preserve identical IDs and payload across retries of a timed-out request.
    const payload=attempt?JSON.parse(attempt.encoded) as Record<string,unknown>:command;
    if(await send(payload))resetForms();
  }
  async function submitQualification(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!qualifyLead)return;
    const data={
      action:'qualifyLead',key:attempt?.key??crypto.randomUUID(),
      leadId:qualifyLead.id,expectedVersion:qualifyLead.rowVersion,
      outcome:String(new FormData(e.currentTarget).get('outcome')||'qualified'),
      clientId:qualifyClient||null,
    };
    if(await send(attempt?JSON.parse(attempt.encoded) as Record<string,unknown>:data))resetForms();
  }
  async function submitOpportunity(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!opportunityLead)return;
    const f=new FormData(e.currentTarget);
    try{
      const payload={
        action:'createOpportunity',key:attempt?.key??crypto.randomUUID(),
        opportunity:{id:crypto.randomUUID(),leadId:opportunityLead.id,
          title:String(f.get('title')||'').trim(),
          amountCents:parseMoney(String(f.get('amount')||''))},
      };
      if(await send(attempt?JSON.parse(attempt.encoded) as Record<string,unknown>:payload)){
        resetForms();setTab('opportunities');
      }
    }catch(e){setNotice({message:e instanceof Error?e.message:'Valor inválido.',error:true});}
  }
  async function moveOpportunity(op:Opportunity,stage:Opportunity['stage']){
    const data={action:'changeStage',key:crypto.randomUUID(),
      opportunityId:op.id,expectedVersion:op.rowVersion,stage};
    await send(data);
  }
  const q=query.trim().toLocaleLowerCase('pt-BR');
  const leads=(snapshot?.leads??[]).filter(l=>
    !q||[l.contactName,l.companyName,l.contactEmail].some(x=>x?.toLocaleLowerCase('pt-BR').includes(q)));
  const opportunities=(snapshot?.opportunities??[]).filter(o=>
    !q||[o.title,snapshot?.leads.find(l=>l.id===o.leadId)?.companyName]
      .some(x=>x?.toLocaleLowerCase('pt-BR').includes(q)));
  const active=(snapshot?.opportunities??[]).filter(o=>o.stage!=='won'&&o.stage!=='lost').length;
  return <section className="cisne-crm" aria-label="CRM nativo do CISNE">
    <header className="cisne-crm-heading">
      <div>
        <span className="eyebrow">GESTÃO COMERCIAL · CISNE RONDÔNIA</span>
        <h2>CRM e Vendas</h2>
        <p>Leads, oportunidades e relacionamento no mesmo workspace do ERP, com dados persistidos no Field.</p>
      </div>
      <div className="cisne-crm-actions">
        <button className="secondary" onClick={()=>void load()} disabled={loading||sending}><RefreshCw size={16}/> Atualizar</button>
        <button className="primary" onClick={()=>{resetForms();setNewLeadOpen(true);}} disabled={sending}><Plus size={17}/> Novo lead</button>
      </div>
    </header>

    {error&&<div role="alert" className="cisne-crm-alert">
      <CircleAlert size={19}/><span><strong>Dados do CRM não disponíveis.</strong> {error}
      <small>Os registros só são exibidos após autenticação válida. Nenhum dado é inventado durante a falha de acesso.</small>
      {needsAuth&&<form onSubmit={e=>void login(e)} className="cisne-crm-login">
        <label>Credencial de homologação <input name="passphrase" type="password" autoComplete="off"
          minLength={24} maxLength={160} placeholder="Credencial de acesso ao CISNE HML" required/></label>
        <button className="primary" disabled={loginBusy}>{loginBusy?'Autenticando…':'Entrar no CISNE'}</button>
        <small>Uma sessão segura de até 8 horas libera o CRM e os módulos operacionais no mesmo Field.</small>
      </form>}</span>
    </div>}
    {notice&&<div className={'cisne-crm-notice '+(notice.error?'is-error':'is-success')} role={notice.error?'alert':'status'}>
      {notice.error?<CircleAlert size={17}/>:<CheckCircle2 size={17}/>}<span>{notice.message}</span>
      <button aria-label="Dispensar aviso" onClick={()=>setNotice(null)}><X size={16}/></button>
    </div>}

    <div className="cisne-crm-metrics">
      <div><span>Leads registrados</span><strong>{snapshot?snapshot.totals.leads:'—'}</strong><small>Cadastro comercial</small></div>
      <div><span>Leads qualificados</span><strong>{snapshot?snapshot.leads.filter(l=>l.status==='qualified').length:'—'}</strong><small>Prontos para oportunidades</small></div>
      <div><span>Oportunidades abertas</span><strong>{snapshot?active:'—'}</strong><small>Funil comercial</small></div>
      <div><span>Oportunidades ganhas</span><strong>{snapshot?snapshot.opportunities.filter(o=>o.stage==='won').length:'—'}</strong><small>Concluídas</small></div>
    </div>

    <div className="cisne-crm-toolbar">
      <div className="cisne-crm-tabs" role="tablist" aria-label="Áreas comerciais">
        <button role="tab" aria-selected={tab==='leads'} className={tab==='leads'?'selected':''}
          onClick={()=>setTab('leads')}>Leads</button>
        <button role="tab" aria-selected={tab==='opportunities'} className={tab==='opportunities'?'selected':''}
          onClick={()=>setTab('opportunities')}>Oportunidades</button>
      </div>
      <label className="cisne-crm-search"><Search size={16}/><input aria-label="Buscar registros comerciais"
        placeholder="Buscar por nome ou empresa..." value={query} onChange={e=>setQuery(e.target.value)}/></label>
    </div>

    {loading&&!snapshot?<div className="cisne-crm-state" role="status">Consultando registros comerciais…</div>:
      snapshot&&tab==='leads'?<div className="cisne-crm-table" role="tabpanel" aria-label="Leads comerciais">
        <div className="cisne-crm-table-head"><span>Contato / empresa</span><span>Origem</span><span>Estado</span><span>Ações</span></div>
        {leads.length?leads.map(l=><div className="cisne-crm-row" key={l.id}>
          <div><strong>{l.contactName}</strong><small>{l.companyName}{l.contactEmail?' · '+l.contactEmail:''}</small></div>
          <span>{sourceLabel[l.source]??l.source}</span>
          <span className={'cisne-crm-status '+l.status}>{l.status==='new'?'Novo':l.status==='qualified'?'Qualificado':'Descartado'}</span>
          <div className="cisne-crm-row-actions">
            {l.status==='new'&&<button className="secondary" disabled={sending}
              onClick={()=>{resetForms();setQualifyLead(l);}}>Classificar</button>}
            {l.status==='qualified'&&<button className="secondary" disabled={sending}
              onClick={()=>{resetForms();setOpportunityLead(l);}}>Nova oportunidade <ArrowRight size={14}/></button>}
            {l.clientId&&<span className="cisne-crm-owner">Cliente vinculado</span>}
          </div>
        </div>):<div className="cisne-crm-state">Nenhum lead para o filtro atual.</div>}
        {snapshot.totals.leads>snapshot.limits.leads&&<p className="cisne-crm-footnote">Exibindo os 100 leads mais recentes. O histórico completo permanece no banco.</p>}
      </div>:
      snapshot&&<div role="tabpanel" aria-label="Funil de oportunidades" className="cisne-crm-pipeline">
        {stages.map(stage=><div className="cisne-crm-column" key={stage}>
          <header><strong>{stageLabel[stage]}</strong><span>{opportunities.filter(o=>o.stage===stage).length}</span></header>
          {opportunities.filter(o=>o.stage===stage).map(o=><article className="cisne-crm-deal" key={o.id}>
            <strong>{o.title}</strong>
            <small>{snapshot.leads.find(l=>l.id===o.leadId)?.companyName??'Lead de origem'}</small>
            <b>{money(o.amountCents)}</b>
            <div className="cisne-crm-deal-actions">
              {nextStage[stage]&&<button className="secondary" disabled={sending}
                onClick={()=>void moveOpportunity(o,nextStage[stage]!)}>
                {nextStage[stage]==='won'?'Marcar ganha':'Avançar'} <ArrowRight size={13}/>
              </button>}
              {stage!=='won'&&stage!=='lost'&&<button className="text-button" disabled={sending}
                onClick={()=>void moveOpportunity(o,'lost')}>Perdida</button>}
            </div>
          </article>)}
          {!opportunities.some(o=>o.stage===stage)&&<p className="cisne-crm-empty">Sem oportunidades</p>}
        </div>)}
      </div>}

    <footer className="cisne-crm-footer">
      <span><Users size={15}/> O CRM utiliza o mesmo proprietário e o PostgreSQL do Field.</span>
      <div><button className="text-button" onClick={onClients}>Clientes do ERP <ArrowRight size={14}/></button>
      <button className="text-button" onClick={onProposals}>Propostas e pedidos <ArrowRight size={14}/></button></div>
    </footer>

    {(newLeadOpen||qualifyLead||opportunityLead)&&<div className="overlay modal-overlay" onClick={resetForms}>
      <section className="modal cisne-crm-modal" role="dialog" aria-modal="true" aria-label="Ação comercial"
        onClick={e=>e.stopPropagation()}>
        <header><h2>{newLeadOpen?'Novo lead':qualifyLead?'Classificar lead':'Nova oportunidade'}</h2>
          <button className="icon-button" aria-label="Fechar" disabled={sending} onClick={resetForms}><X size={19}/></button>
        </header>
        {newLeadOpen&&<form onSubmit={e=>void submitLead(e)}>
          <label>Nome do contato<input name="contactName" required minLength={2} maxLength={120}/></label>
          <label>Empresa<input name="companyName" required minLength={2} maxLength={160}/></label>
          <label>E-mail<input name="contactEmail" type="email" maxLength={254}/></label>
          <label>Origem<select name="source" defaultValue="manual">
            <option value="manual">Cadastro manual</option><option value="referral">Indicação</option>
            <option value="web">Site</option><option value="event">Evento</option>
          </select></label>
          <footer><button type="button" className="secondary" onClick={resetForms}>Cancelar</button>
            <button className="primary" disabled={sending}>{sending?'Salvando…':'Registrar lead'}</button></footer>
        </form>}
        {qualifyLead&&<form onSubmit={e=>void submitQualification(e)}>
          <p>{qualifyLead.contactName} · {qualifyLead.companyName}</p>
          <label>Resultado<select name="outcome" defaultValue="qualified">
            <option value="qualified">Qualificado</option><option value="disqualified">Descartado</option>
          </select></label>
          <label>Vincular a cliente existente (opcional)<select value={qualifyClient} onChange={e=>setQualifyClient(e.target.value)}>
            <option value="">Ainda não vincular</option>
            {snapshot?.clients.map(c=><option key={c.id} value={c.id}>{c.legalName}</option>)}
          </select></label>
          <p className="muted">O vínculo é validado pelo servidor e não cria um cliente duplicado.</p>
          <footer><button type="button" className="secondary" onClick={resetForms}>Cancelar</button>
            <button className="primary" disabled={sending}>{sending?'Registrando…':'Confirmar'}</button></footer>
        </form>}
        {opportunityLead&&<form onSubmit={e=>void submitOpportunity(e)}>
          <p>Lead de origem: {opportunityLead.companyName}</p>
          <label>Oportunidade<input name="title" required minLength={3} maxLength={160}
            defaultValue={'Negociação · '+opportunityLead.companyName}/></label>
          <label>Valor estimado (R$)<input name="amount" inputMode="decimal"
            placeholder="1250,50" pattern="[0-9]{1,10}([,.][0-9]{1,2})?" required/></label>
          <footer><button type="button" className="secondary" onClick={resetForms}>Cancelar</button>
            <button className="primary" disabled={sending}>{sending?'Registrando…':'Criar oportunidade'}</button></footer>
        </form>}
      </section>
    </div>}
  </section>;
}
