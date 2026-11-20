'use client';

import { EnterpriseDropdown } from './components/enterprise/EnterprisePrimitives';
import { EnterpriseButton, EnterpriseInput, EnterpriseTextarea,} from './components/enterprise/EnterprisePrimitives';
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
  proposalId:string|null;proposalStatus:string|null;
};
type Client = {id:string;legalName:string};
type Snapshot = {
  leads:Lead[]; opportunities:Opportunity[]; clients:Client[];
  totals:{leads:number;opportunities:number}; limits:{leads:number;opportunities:number};
  error?:string;code?:string;
};
type Notice = {message:string;error:boolean};
type OpportunityProjection = {
  id:string; leadId:string; title:string; amountCents:string; stage:string;
  rowVersion:number; createdAt:string; updatedAt:string;
  lead:{contactName:string;companyName:string;contactEmail:string|null;status:string};
  client:{id:string;legalName:string}|null;
  proposal:{id:string;status:string;total:string;validUntil:string}|null;
  history:{action:string;createdAt:string;result:string}[];
};
const stages:Opportunity['stage'][]=['discovery','proposal','negotiation','won','lost'];
const stageLabel:Record<Opportunity['stage'],string>={
  discovery:'Diagnóstico',proposal:'Proposta',negotiation:'Negociação',won:'Ganha',lost:'Perdida',
};
const sourceLabel:Record<string,string>={manual:'Manual',referral:'Indicação',web:'Site',event:'Evento'};
const nextStage:Record<Opportunity['stage'],Opportunity['stage']|null>={
  discovery:'proposal',proposal:'negotiation',negotiation:'won',won:null,lost:null,
};
function money(cents:string){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents)/100);}
function moneyScaled4(value:string){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)/10000);}
function parseMoney(input:string):number{
  if(!/^\d{1,10}(?:[,.]\d{1,2})?$/.test(input.trim()))throw new Error('Informe o valor em reais (ex.: 1250,50).');
  const cents=Math.round(Number(input.replace(',','.'))*100);
  if(!Number.isSafeInteger(cents)||cents<0)throw new Error('Valor monetário inválido.');
  return cents;
}

export default function CRMWorkspace({onClients,onProposals}:{onClients:()=>void;onProposals:(proposalId?:string)=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [loading,setLoading]=useState(true),[sending,setSending]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState<Notice|null>(null);
  const [needsAuth,setNeedsAuth]=useState(false),[loginBusy,setLoginBusy]=useState(false);
  const [tab,setTab]=useState<'leads'|'opportunities'>('leads');
  const [query,setQuery]=useState('');
  const [newLeadOpen,setNewLeadOpen]=useState(false);
  const [qualifyLead,setQualifyLead]=useState<Lead|null>(null);
  const [opportunityLead,setOpportunityLead]=useState<Lead|null>(null);
  const [proposalOpportunity,setProposalOpportunity]=useState<Opportunity|null>(null);
  const [selectedOpportunity,setSelectedOpportunity]=useState<OpportunityProjection|null>(null);
  const [opportunityLoading,setOpportunityLoading]=useState(false);
  const [qualifyClient,setQualifyClient]=useState('');
  const [attempt,setAttempt]=useState<{key:string;encoded:string}|null>(null);
  const busy=useRef(false);
  async function openOpportunity(id:string){
    setOpportunityLoading(true);setNotice(null);
    try{
      const response=await fetch('/api/crm/opportunities/'+id,{cache:'no-store'});
      const body=await response.json() as {projection?:OpportunityProjection;error?:string};
      if(!response.ok||!body.projection)throw new Error(body.error||'Ficha da oportunidade indisponível.');
      setSelectedOpportunity(body.projection);
    }catch(e){setNotice({message:e instanceof Error?e.message:'Ficha da oportunidade indisponível.',error:true});}
    finally{setOpportunityLoading(false);}
  }
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
    setNewLeadOpen(false);setQualifyLead(null);setOpportunityLead(null);setProposalOpportunity(null);setQualifyClient('');
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
  async function submitDraftProposal(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!proposalOpportunity)return;
    const fields=new FormData(e.currentTarget);
    const command={
      action:'createDraftProposal',key:attempt?.key??crypto.randomUUID(),
      opportunityId:proposalOpportunity.id,proposalId:crypto.randomUUID(),
      expectedVersion:proposalOpportunity.rowVersion,
      scope:String(fields.get('scope')||'').trim(),
      validUntil:String(fields.get('validUntil')||''),
    };
    if(await send(attempt?JSON.parse(attempt.encoded) as Record<string,unknown>:command)){
      resetForms();setTab('opportunities');
    }
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
        <EnterpriseButton type="button" className="secondary" onClick={()=>void load()} disabled={loading||sending}><RefreshCw size={16}/> Atualizar</EnterpriseButton>
        <EnterpriseButton type="button" className="primary" onClick={()=>{resetForms();setNewLeadOpen(true);}} disabled={sending}><Plus size={17}/> Novo lead</EnterpriseButton>
      </div>
    </header>

    {error&&<div role="alert" className="cisne-crm-alert">
      <CircleAlert size={19}/><span><strong>Dados do CRM não disponíveis.</strong> {error}
      <small>Os registros só são exibidos após autenticação válida. Nenhum dado é inventado durante a falha de acesso.</small>
      {needsAuth&&<form onSubmit={e=>void login(e)} className="cisne-crm-login">
        <label>Credencial de homologação <EnterpriseInput name="passphrase" type="password" autoComplete="off"
          minLength={24} maxLength={160} placeholder="Credencial de acesso ao CISNE HML" required/></label>
        <EnterpriseButton type="submit" className="primary" disabled={loginBusy}>{loginBusy?'Autenticando…':'Entrar no CISNE'}</EnterpriseButton>
        <small>Uma sessão segura de até 8 horas libera o CRM e os módulos operacionais no mesmo Field.</small>
      </form>}</span>
    </div>}
    {notice&&<div className={'cisne-crm-notice '+(notice.error?'is-error':'is-success')} role={notice.error?'alert':'status'}>
      {notice.error?<CircleAlert size={17}/>:<CheckCircle2 size={17}/>}<span>{notice.message}</span>
      <EnterpriseButton type="button" aria-label="Dispensar aviso" onClick={()=>setNotice(null)}><X size={16}/></EnterpriseButton>
    </div>}

    <div className="cisne-crm-metrics">
      <div><span>Leads registrados</span><strong>{snapshot?snapshot.totals.leads:'—'}</strong><small>Cadastro comercial</small></div>
      <div><span>Leads qualificados</span><strong>{snapshot?snapshot.leads.filter(l=>l.status==='qualified').length:'—'}</strong><small>Prontos para oportunidades</small></div>
      <div><span>Oportunidades abertas</span><strong>{snapshot?active:'—'}</strong><small>Funil comercial</small></div>
      <div><span>Oportunidades ganhas</span><strong>{snapshot?snapshot.opportunities.filter(o=>o.stage==='won').length:'—'}</strong><small>Concluídas</small></div>
    </div>

    <div className="cisne-crm-toolbar">
      <div className="cisne-crm-tabs" role="tablist" aria-label="Áreas comerciais">
        <EnterpriseButton type="button" role="tab" aria-selected={tab==='leads'} className={tab==='leads'?'selected':''}
          onClick={()=>setTab('leads')}>Leads</EnterpriseButton>
        <EnterpriseButton type="button" role="tab" aria-selected={tab==='opportunities'} className={tab==='opportunities'?'selected':''}
          onClick={()=>setTab('opportunities')}>Oportunidades</EnterpriseButton>
      </div>
      <label className="cisne-crm-search"><Search size={16}/><EnterpriseInput aria-label="Buscar registros comerciais"
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
            {l.status==='new'&&<EnterpriseButton type="button" className="secondary" disabled={sending}
              onClick={()=>{resetForms();setQualifyLead(l);}}>Classificar</EnterpriseButton>}
            {l.status==='qualified'&&<EnterpriseButton type="button" className="secondary" disabled={sending}
              onClick={()=>{resetForms();setOpportunityLead(l);}}>Nova oportunidade <ArrowRight size={14}/></EnterpriseButton>}
            {l.clientId&&<span className="cisne-crm-owner">Cliente vinculado</span>}
          </div>
        </div>):<div className="cisne-crm-state">Nenhum lead para o filtro atual.</div>}
        {snapshot.totals.leads>snapshot.limits.leads&&<p className="cisne-crm-footnote">Exibindo os 100 leads mais recentes. O histórico completo permanece no banco.</p>}
      </div>:
      snapshot&&<div role="tabpanel" aria-label="Funil de oportunidades" className="cisne-crm-pipeline">
        {stages.map(stage=><div className="cisne-crm-column" key={stage}>
          <header><strong>{stageLabel[stage]}</strong><span>{opportunities.filter(o=>o.stage===stage).length}</span></header>
          {opportunities.filter(o=>o.stage===stage).map(o=><article className="cisne-crm-deal" key={o.id}>
            <EnterpriseButton type="button" className="cisne-crm-deal-title" onClick={()=>void openOpportunity(o.id)} disabled={opportunityLoading}>{o.title}</EnterpriseButton>
            <small>{snapshot.leads.find(l=>l.id===o.leadId)?.companyName??'Lead de origem'}</small>
            <b>{money(o.amountCents)}</b>
            {o.proposalId&&<small className="cisne-crm-proposal-linked">
              Proposta ERP: {o.proposalId.slice(0,8)} · {o.proposalStatus==='draft'?'Rascunho':o.proposalStatus??'Vinculada'}
              <EnterpriseButton type="button" className="text-button" onClick={()=>onProposals(o.proposalId!)}>Abrir proposta no CISNE <ArrowRight size={12}/></EnterpriseButton>
            </small>}
            {stage==='proposal'&&!o.proposalId&&!o.clientId&&<small className="cisne-crm-proposal-warning">
              Vincule um cliente ativo do ERP ao lead antes de gerar a proposta
            </small>}
            <div className="cisne-crm-deal-actions">
              <EnterpriseButton type="button" className="text-button" disabled={opportunityLoading} onClick={()=>void openOpportunity(o.id)}>Abrir ficha</EnterpriseButton>
              {stage==='proposal'&&!o.proposalId&&o.clientId&&
                <EnterpriseButton type="button" className="secondary" disabled={sending}
                  onClick={()=>{resetForms();setProposalOpportunity(o);}}>
                  Gerar proposta <ArrowRight size={13}/>
                </EnterpriseButton>}
              {nextStage[stage]&&<EnterpriseButton type="button" className="secondary" disabled={sending}
                onClick={()=>void moveOpportunity(o,nextStage[stage]!)}>
                {nextStage[stage]==='won'?'Marcar ganha':'Avançar'} <ArrowRight size={13}/>
              </EnterpriseButton>}
              {stage!=='won'&&stage!=='lost'&&<EnterpriseButton type="button" className="text-button" disabled={sending}
                onClick={()=>void moveOpportunity(o,'lost')}>Perdida</EnterpriseButton>}
            </div>
          </article>)}
          {!opportunities.some(o=>o.stage===stage)&&<p className="cisne-crm-empty">Sem oportunidades</p>}
        </div>)}
      </div>}

    <footer className="cisne-crm-footer">
      <span><Users size={15}/> O CRM utiliza o mesmo proprietário e o PostgreSQL do Field.</span>
      <div><EnterpriseButton type="button" className="text-button" onClick={onClients}>Clientes do ERP <ArrowRight size={14}/></EnterpriseButton>
      <EnterpriseButton type="button" className="text-button" onClick={()=>onProposals()}>Propostas e pedidos <ArrowRight size={14}/></EnterpriseButton></div>
    </footer>

    {selectedOpportunity&&<div className="overlay" onClick={()=>setSelectedOpportunity(null)}>
      <aside className="drawer cisne-crm-opportunity-drawer" role="dialog" aria-modal="true" aria-label="Ficha da oportunidade"
        onClick={e=>e.stopPropagation()}>
        <header><div><span className="eyebrow">OBJECT PAGE · OPORTUNIDADE</span><h2>{selectedOpportunity.title}</h2></div>
          <EnterpriseButton type="button" className="icon-button" aria-label="Fechar ficha da oportunidade" onClick={()=>setSelectedOpportunity(null)}><X size={19}/></EnterpriseButton>
        </header>
        <div className="cisne-crm-object-status"><span className={'cisne-crm-status '+selectedOpportunity.stage}>{stageLabel[selectedOpportunity.stage as Opportunity['stage']]??selectedOpportunity.stage}</span>
          <strong>{money(selectedOpportunity.amountCents)}</strong></div>
        <section><h3>Relacionamentos</h3><dl className="cisne-crm-object-grid">
          <div><dt>Lead de origem</dt><dd>{selectedOpportunity.lead.companyName}<small>{selectedOpportunity.lead.contactName}{selectedOpportunity.lead.contactEmail?' · '+selectedOpportunity.lead.contactEmail:''}</small></dd></div>
          <div><dt>Cliente ERP</dt><dd>{selectedOpportunity.client?.legalName??'Sem cliente vinculado'}<small>{selectedOpportunity.client?'Vínculo ativo no Field':'Necessário para gerar proposta'}</small></dd></div>
        </dl></section>
        <section><h3>Proposta</h3>{selectedOpportunity.proposal?<div className="cisne-crm-linked-object"><strong>{selectedOpportunity.proposal.status==='draft'?'Rascunho':selectedOpportunity.proposal.status}</strong><small>{moneyScaled4(selectedOpportunity.proposal.total)} · validade {selectedOpportunity.proposal.validUntil}</small><EnterpriseButton type="button" className="text-button" onClick={()=>onProposals(selectedOpportunity.proposal!.id)}>Abrir proposta no CISNE <ArrowRight size={12}/></EnterpriseButton></div>:<p className="muted">Nenhuma proposta vinculada. Avance a oportunidade para “Proposta” e use a ação de geração.</p>}</section>
        <section><h3>Histórico de comandos</h3>{selectedOpportunity.history.length?selectedOpportunity.history.map((event,index)=><div className="cisne-crm-history-row" key={event.createdAt+'-'+index}><strong>{event.action}</strong><small>{new Date(event.createdAt).toLocaleString('pt-BR')}</small></div>):<p className="muted">Nenhum comando registrado.</p>}</section>
      </aside>
    </div>}

    {(newLeadOpen||qualifyLead||opportunityLead||proposalOpportunity)&&<div className="overlay modal-overlay" onClick={resetForms}>
      <section className="modal cisne-crm-modal" role="dialog" aria-modal="true" aria-label="Ação comercial"
        onClick={e=>e.stopPropagation()}>
        <header><h2>{newLeadOpen?'Novo lead':qualifyLead?'Classificar lead':opportunityLead?'Nova oportunidade':'Rascunho de proposta'}</h2>
          <EnterpriseButton type="button" className="icon-button" aria-label="Fechar" disabled={sending} onClick={resetForms}><X size={19}/></EnterpriseButton>
        </header>
        {newLeadOpen&&<form onSubmit={e=>void submitLead(e)}>
          <label>Nome do contato<EnterpriseInput name="contactName" required minLength={2} maxLength={120}/></label>
          <label>Empresa<EnterpriseInput name="companyName" required minLength={2} maxLength={160}/></label>
          <label>E-mail<EnterpriseInput name="contactEmail" type="email" maxLength={254}/></label>
          <label>Origem<EnterpriseDropdown name="source" defaultValue="manual">
            <option value="manual">Cadastro manual</option><option value="referral">Indicação</option>
            <option value="web">Site</option><option value="event">Evento</option>
          </EnterpriseDropdown></label>
          <footer><EnterpriseButton type="button" className="secondary" onClick={resetForms}>Cancelar</EnterpriseButton>
            <EnterpriseButton type="submit" className="primary" disabled={sending}>{sending?'Salvando…':'Registrar lead'}</EnterpriseButton></footer>
        </form>}
        {qualifyLead&&<form onSubmit={e=>void submitQualification(e)}>
          <p>{qualifyLead.contactName} · {qualifyLead.companyName}</p>
          <label>Resultado<EnterpriseDropdown name="outcome" defaultValue="qualified">
            <option value="qualified">Qualificado</option><option value="disqualified">Descartado</option>
          </EnterpriseDropdown></label>
          <label>Vincular a cliente existente (opcional)<EnterpriseDropdown value={qualifyClient} onValueChange={value =>setQualifyClient(value)}>
            <option value="">Ainda não vincular</option>
            {snapshot?.clients.map(c=><option key={c.id} value={c.id}>{c.legalName}</option>)}
          </EnterpriseDropdown></label>
          <p className="muted">O vínculo é validado pelo servidor e não cria um cliente duplicado.</p>
          <footer><EnterpriseButton type="button" className="secondary" onClick={resetForms}>Cancelar</EnterpriseButton>
            <EnterpriseButton type="submit" className="primary" disabled={sending}>{sending?'Registrando…':'Confirmar'}</EnterpriseButton></footer>
        </form>}
        {proposalOpportunity&&<form onSubmit={e=>void submitDraftProposal(e)}>
          <p><strong>{proposalOpportunity.title}</strong></p>
          <p className="muted">Valor estimado: {money(proposalOpportunity.amountCents)}. A conversão cria somente um rascunho; não registra aceite nem cria ordem de serviço.</p>
          <label>Escopo dos serviços<EnterpriseTextarea name="scope" required minLength={3} maxLength={4000}
            rows={5} placeholder="Descreva os serviços da proposta a revisar."/></label>
          <label>Validade da proposta<EnterpriseInput name="validUntil" type="date" required/></label>
          <p className="muted">Requer cliente ativo vinculado. Cada oportunidade admite uma proposta nesta etapa.</p>
          <footer><EnterpriseButton type="button" className="secondary" disabled={sending} onClick={resetForms}>Cancelar</EnterpriseButton>
            <EnterpriseButton type="submit" className="primary" disabled={sending}>{sending?'Registrando…':'Criar rascunho'}</EnterpriseButton></footer>
        </form>}
        {opportunityLead&&<form onSubmit={e=>void submitOpportunity(e)}>
          <p>Lead de origem: {opportunityLead.companyName}</p>
          <label>Oportunidade<EnterpriseInput name="title" required minLength={3} maxLength={160}
            defaultValue={'Negociação · '+opportunityLead.companyName}/></label>
          <label>Valor estimado (R$)<EnterpriseInput name="amount" inputMode="decimal"
            placeholder="1250,50" pattern="[0-9]{1,10}([,.][0-9]{1,2})?" required/></label>
          <footer><EnterpriseButton type="button" className="secondary" onClick={resetForms}>Cancelar</EnterpriseButton>
            <EnterpriseButton type="submit" className="primary" disabled={sending}>{sending?'Registrando…':'Criar oportunidade'}</EnterpriseButton></footer>
        </form>}
      </section>
    </div>}
  </section>;
}
