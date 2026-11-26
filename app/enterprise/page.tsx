'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Tenant={id:string;slug:string;name:string;role:string;status:string};
type Company={id:string;code:string;name:string;status:string;taxId?:string|null};
type Member={actorId:string;role:string;status:string;createdAt:string};
type PermissionEvent={id:string;actorId:string;action:string;resourceId:string;correlationId:string;createdAt:string};
type PermissionCursor={cursorAt:string;cursorId:string};
type AuditResponse={items:PermissionEvent[];pageInfo:{pageSize:number;hasMore:boolean;nextCursor:PermissionCursor|null}};

async function read<T>(response:Response):Promise<T>{
 const result=await response.json() as T&{error?:string};
 if(!response.ok)throw new Error(result.error??'Operação empresarial indisponível.');
 return result;
}
async function post<T>(url:string,payload:unknown){
 return read<T>(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));
}
const tenantUrl='/api/enterprise/tenants';
const newId=()=>crypto.randomUUID();

export default function EnterpriseStructurePage(){
 const [tenants,setTenants]=useState<Tenant[]>([]);
 const [tenantId,setTenantId]=useState('');
 const [companies,setCompanies]=useState<Company[]>([]);
 const [members,setMembers]=useState<Member[]>([]);
 const [loading,setLoading]=useState(true);
 const [loadingDetail,setLoadingDetail]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [memberQuery,setMemberQuery]=useState('');
 const [roleFilter,setRoleFilter]=useState('all');
 const [auditEvents,setAuditEvents]=useState<PermissionEvent[]>([]);
 const [auditCursor,setAuditCursor]=useState<PermissionCursor|null>(null);
 const [auditTenant,setAuditTenant]=useState('');
 const [auditLoading,setAuditLoading]=useState(false);
 const [auditError,setAuditError]=useState('');
 const auditRequest=useRef(0);
 const detailRequest=useRef(0);
 const current=tenants.find(t=>t.id===tenantId);
 const isOwner=current?.role==='owner';
 const canManage=isOwner||current?.role==='admin';
 const canAudit=['owner','admin','auditor'].includes(current?.role??'');
 const filteredMembers=members.filter(member=>
  (roleFilter==='all'||member.role===roleFilter)&&
  (member.actorId.toLocaleLowerCase('pt-BR').includes(memberQuery.trim().toLocaleLowerCase('pt-BR')))
 );
 const activeMembers=members.filter(member=>member.status==='active').length;
 const activeCompanies=companies.filter(company=>company.status==='active').length;

 const loadTenants=useCallback(async()=>{
  try{
   const result=await read<{items:Tenant[]}>(await fetch(tenantUrl,{cache:'no-store'}));
   setTenants(result.items);
   setTenantId(previous=>previous&&result.items.some(t=>t.id===previous)?previous:(result.items[0]?.id??''));
  }catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível consultar empresas.');}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{const timer=setTimeout(()=>void loadTenants(),0);return()=>clearTimeout(timer);},[loadTenants]);
 const loadDetail=useCallback(async(id:string,role:string)=>{
  const request=++detailRequest.current;
  if(!id){setCompanies([]);setMembers([]);setLoadingDetail(false);return;}
  setLoadingDetail(true);
  try{
   const root=tenantUrl+'/'+encodeURIComponent(id);
   const [companiesResult,membersResult]=await Promise.all([
    read<{items:Company[]}>(await fetch(root+'/legal-entities',{cache:'no-store'})),
    ['owner','admin'].includes(role)
     ?read<{items:Member[]}>(await fetch(root+'/members',{cache:'no-store'}))
     :Promise.resolve({items:[] as Member[]}),
   ]);
   if(request!==detailRequest.current)return;
   setCompanies(companiesResult.items);setMembers(membersResult.items);
  }catch(cause){
   if(request===detailRequest.current)setError(cause instanceof Error?cause.message:'Não foi possível consultar as unidades e permissões.');
  }finally{
   if(request===detailRequest.current)setLoadingDetail(false);
  }
 },[]);
 useEffect(()=>{const timer=setTimeout(()=>void loadDetail(tenantId,current?.role??''),0);return()=>clearTimeout(timer);},[tenantId,current?.role,loadDetail]);

 async function loadAudit(id:string,cursor:PermissionCursor|null=null){
  const request=++auditRequest.current;
  setAuditLoading(true);setAuditError('');
  if(!cursor){setAuditEvents([]);setAuditCursor(null);}
  try{
   const params=new URLSearchParams({pageSize:'25'});
   if(cursor){params.set('cursorAt',cursor.cursorAt);params.set('cursorId',cursor.cursorId);}
   const result=await read<AuditResponse>(await fetch(
    tenantUrl+'/'+encodeURIComponent(id)+'/audit?'+params.toString(),{cache:'no-store',
    credentials:'same-origin'},
   ));
   if(request!==auditRequest.current)return;
   setAuditTenant(id);
   setAuditEvents(previous=>cursor&&auditTenant===id?
    [...previous,...result.items.filter(item=>!previous.some(old=>old.id===item.id))]:result.items);
   setAuditCursor(result.pageInfo.nextCursor);
  }catch(cause){
   if(request===auditRequest.current)setAuditError(cause instanceof Error?cause.message:'Auditoria indisponível.');
  }finally{
   if(request===auditRequest.current)setAuditLoading(false);
  }
 }
 async function createTenant(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();const formElement=event.currentTarget;setSaving(true);setError('');setNotice('');
  const form=new FormData(event.currentTarget);
  try{
   const result=await post<Tenant>(tenantUrl,{id:newId(),commandKey:newId(),
    slug:String(form.get('slug')??'').trim(),name:String(form.get('name')??'').trim()});
   await loadTenants();setTenantId(result.id);formElement.reset();
   setNotice('Organização registrada com trilha de auditoria.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Falha no cadastro de organização.');}
  finally{setSaving(false);}
 }
 async function createCompany(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();const formElement=event.currentTarget;if(!tenantId)return;
  setSaving(true);setError('');setNotice('');
  const form=new FormData(event.currentTarget);
  try{
   await post(tenantUrl+'/'+tenantId+'/legal-entities',{id:newId(),commandKey:newId(),
    code:String(form.get('code')??'').trim().toUpperCase(),
    name:String(form.get('name')??'').trim(),...(form.get('taxId')?{taxId:String(form.get('taxId'))}:{})});
   await loadDetail(tenantId,current?.role??'');formElement.reset();setNotice('Empresa jurídica registrada.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Falha ao registrar empresa jurídica.');}
  finally{setSaving(false);}
 }
 async function provision(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();const formElement=event.currentTarget;if(!tenantId)return;
  setSaving(true);setError('');setNotice('');
  const form=new FormData(event.currentTarget);
  try{
   await post(tenantUrl+'/'+tenantId+'/members',{commandKey:newId(),action:'provision',
    actorId:String(form.get('actorId')??'').trim(),role:String(form.get('role')??'operator')});
   await loadDetail(tenantId,current?.role??'');formElement.reset();
   setNotice('Vínculo provisionado. A identidade deverá autenticar-se com seu próprio acesso.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Falha ao provisionar membro.');}
  finally{setSaving(false);}
 }
 async function deactivate(actorId:string){
  if(!tenantId||!window.confirm('Desativar este vínculo empresarial? O usuário perderá o acesso concedido por esta organização.'))return;
  setSaving(true);setError('');setNotice('');
  try{
   await post(tenantUrl+'/'+tenantId+'/members',{commandKey:newId(),action:'deactivate',actorId});
   await loadDetail(tenantId,current?.role??'');setNotice('Membro desativado com evento de auditoria.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Falha ao desativar vínculo.');}
  finally{setSaving(false);}
 }
 return <main className="app enterprise-governance">
  <div className="enterprise-governance-layout">
   <header className="enterprise-governance-header">
    <div className="enterprise-governance-heading">
     <span className="eyebrow">CISNE / ESTRUTURA ORGANIZACIONAL</span>
     <h1>Governança empresarial</h1>
     <p>Organizações, empresas jurídicas, vínculos e permissões com registros persistidos e auditoria.</p>
    </div>
    <div className="enterprise-governance-actions">
     {current&&<button type="button" className="secondary" disabled={loadingDetail||saving}
      onClick={()=>void loadDetail(tenantId,current?.role??'')}>Atualizar organização</button>}
     <Link className="secondary" href="/" prefetch={false}>Voltar ao ERP</Link>
    </div>
   </header>

   <nav className="enterprise-governance-anchors" aria-label="Seções de governança">
    <a href="#governance-organizations">Organizações</a>
    {current&&<a href="#governance-companies">Empresas jurídicas</a>}
    {current&&canManage&&<a href="#governance-access">Pessoas e acessos</a>}
    {current&&canAudit&&<a href="#governance-audit">Auditoria de permissões</a>}
   </nav>

   <aside className="enterprise-governance-warning" role="note">
    <strong>Escopo de implantação controlado</strong>
    <p>O isolamento dos registros legados por tenant ainda está em migração controlada.
     Criar uma organização ou empresa jurídica aqui não altera nem transfere dados históricos.</p>
   </aside>
   {error&&<p role="alert" className="form-error">{error}</p>}
   {notice&&<p role="status" className="linked-info">{notice}</p>}

   <section id="governance-organizations" className="enterprise-governance-panel" aria-labelledby="governance-organizations-title">
    <div className="enterprise-governance-panel-heading">
     <div><span className="eyebrow">01 / CONTEXTO EMPRESARIAL</span>
      <h2 id="governance-organizations-title">Organizações e contexto ativo</h2>
      <p>A seleção define o escopo de consulta desta página; as permissões são verificadas pelo servidor.</p>
     </div>
    </div>
    {loading?<p role="status">Carregando organizações…</p>:<label className="enterprise-governance-select">Organização ativa
     <select value={tenantId} onChange={e=>{
      setError('');setNotice('');setMemberQuery('');setRoleFilter('all');
      // Invalidate in-flight responses before React commits the new organization.
      detailRequest.current += 1;
      auditRequest.current += 1;
      setAuditEvents([]);setAuditCursor(null);setAuditTenant('');setAuditError('');
      setCompanies([]);setMembers([]);setTenantId(e.target.value);
     }} aria-label="Selecionar organização">
      <option value="">Selecione uma organização</option>
      {tenants.map(t=><option value={t.id} key={t.id}>{t.name} · {t.role}</option>)}
     </select>
    </label>}
    {current&&<div className="enterprise-governance-facts" aria-label="Contexto persistido da organização">
     <div><span>Organização</span><strong>{current.name}</strong><small>{current.slug}</small></div>
     <div><span>Seu papel</span><strong>{current.role}</strong><small>Permissão da sessão</small></div>
     <div><span>Situação</span><strong>{current.status}</strong><small>Estado registrado</small></div>
     <div><span>Empresas ativas</span><strong>{loadingDetail?'—':activeCompanies}</strong><small>Registros da organização</small></div>
     {canManage&&<div><span>Membros ativos</span><strong>{loadingDetail?'—':activeMembers}</strong><small>Vínculos provisionados</small></div>}
    </div>}
    <details className="enterprise-governance-disclosure">
     <summary>Registrar nova organização</summary>
     <form onSubmit={createTenant}>
      <p className="enterprise-governance-hint">A criação é transacional, com identificador exclusivo e comando auditável.</p>
      <div className="form-row">
       <label>Identificador (slug)<input name="slug" pattern="[a-z][a-z0-9-]{2,47}" minLength={3} maxLength={48} placeholder="grupo-exemplo" required/></label>
       <label>Razão de referência<input name="name" minLength={3} maxLength={160} required/></label>
      </div>
      <button className="primary" disabled={saving}>Criar organização</button>
     </form>
    </details>
   </section>

   {current&&<section id="governance-companies" className="enterprise-governance-panel" aria-labelledby="governance-companies-title" aria-busy={loadingDetail}>
    <div className="enterprise-governance-panel-heading">
     <div><span className="eyebrow">02 / ESTRUTURA LEGAL</span>
      <h2 id="governance-companies-title">Empresas jurídicas · {current.name}</h2>
      <p>Entidades vinculadas à organização selecionada, sem reclassificar registros legados.</p>
     </div>
     <span className="enterprise-governance-count">{loadingDetail?'Atualizando…':companies.length+' registro(s)'}</span>
    </div>
    {loadingDetail?<p role="status">Consultando estrutura…</p>:companies.length?
     <div className="table-wrap enterprise-governance-table"><table>
      <caption className="sr-only">Empresas jurídicas da organização ativa</caption>
      <thead><tr><th scope="col">Código</th><th scope="col">Nome</th><th scope="col">Situação</th></tr></thead>
      <tbody>{companies.map(company=><tr key={company.id}>
       <td><strong>{company.code}</strong></td><td>{company.name}</td>
       <td><span className="enterprise-governance-state">{company.status}</span></td>
      </tr>)}</tbody>
     </table></div>:<p className="enterprise-governance-empty">Nenhuma empresa jurídica registrada nesta organização.</p>}
    {canManage&&<details className="enterprise-governance-disclosure">
     <summary>Registrar empresa jurídica</summary>
     <form onSubmit={createCompany}>
      <div className="form-row">
       <label>Código<input name="code" pattern="[A-Za-z0-9_-]{2,20}" required maxLength={20}/></label>
       <label>Razão social<input name="name" minLength={3} maxLength={160} required/></label>
       <label>CNPJ (somente números, opcional)<input name="taxId" inputMode="numeric" pattern="[0-9]{14}"/></label>
      </div><button className="primary" disabled={saving}>Registrar empresa</button>
     </form>
    </details>}
   </section>}

   {current&&canManage&&<section id="governance-access" className="enterprise-governance-panel" aria-labelledby="governance-access-title" aria-busy={loadingDetail}>
    <div className="enterprise-governance-panel-heading">
     <div><span className="eyebrow">03 / SEGREGAÇÃO DE FUNÇÕES</span>
      <h2 id="governance-access-title">Pessoas, papéis e acesso</h2>
      <p>Provisionamento e desativação de vínculos por organização; autorização da API é independente da interface.</p>
     </div>
     <span className="enterprise-governance-count">{loadingDetail?'Atualizando…':members.length+' vínculo(s)'}</span>
    </div>
    <div className="enterprise-governance-filters">
     <label>Buscar identidade<input type="search" value={memberQuery}
      onChange={event=>setMemberQuery(event.target.value)} placeholder="Identidade autenticável" aria-label="Filtrar membros"/></label>
     <label>Papel<select value={roleFilter} onChange={event=>setRoleFilter(event.target.value)} aria-label="Filtrar por papel">
      <option value="all">Todos os papéis</option>
      {['owner','admin','operator','accountant','auditor'].map(role=><option key={role} value={role}>{role}</option>)}
     </select></label>
    </div>
    {loadingDetail?<p role="status">Consultando vínculos…</p>:
     filteredMembers.length?<div className="table-wrap enterprise-governance-table"><table>
      <caption className="sr-only">Membros e permissões da organização ativa</caption>
      <thead><tr><th scope="col">Identidade autenticável</th><th scope="col">Papel</th><th scope="col">Situação</th><th scope="col">Ação permitida</th></tr></thead>
      <tbody>{filteredMembers.map(m=><tr key={m.actorId}>
       <td><strong>{m.actorId}</strong></td><td>{m.role}</td><td><span className="enterprise-governance-state">{m.status}</span></td>
       <td>{isOwner&&m.role!=='owner'&&m.status==='active'?
        <button className="secondary" type="button" disabled={saving} onClick={()=>void deactivate(m.actorId)}>Desativar vínculo</button>:'—'}</td>
      </tr>)}</tbody>
     </table></div>:<p className="enterprise-governance-empty">Nenhum vínculo corresponde à consulta e ao filtro atual.</p>}
    <p className="enterprise-governance-hint" role="status">{filteredMembers.length} de {members.length} vínculo(s) exibido(s).</p>
    {isOwner&&<details className="enterprise-governance-disclosure">
     <summary>Provisionar identidade autenticável</summary>
     <form onSubmit={provision}>
      <div className="form-row">
       <label>ID de usuário autenticado<input name="actorId" minLength={8} maxLength={200} required pattern="[A-Za-z0-9_.:@-]+"/></label>
       <label>Papel<select name="role" defaultValue="operator">
        <option value="operator">Operador</option><option value="accountant">Contador</option>
        <option value="auditor">Auditor</option><option value="admin">Administrador</option>
       </select></label>
      </div>
      <button className="primary" disabled={saving}>Provisionar membro</button>
      <p className="enterprise-governance-hint">O ID deve corresponder a uma identidade verificada no provedor. O provisionamento não cria credenciais.</p>
     </form>
    </details>}
   </section>}
   {current&&canAudit&&<section id="governance-audit" className="enterprise-governance-panel" aria-labelledby="governance-audit-title">
    <div className="enterprise-governance-panel-heading">
     <div><span className="eyebrow">04 / TRILHA DE PERMISSÕES</span>
      <h2 id="governance-audit-title">Auditoria de acessos · {current.name}</h2>
      <p>Eventos persistidos de criação de organização, provisionamento, desativação e estrutura empresarial.
       Esta trilha não representa o diário financeiro nem todos os acessos aos módulos.</p>
     </div>
     <button type="button" className="secondary" disabled={auditLoading}
      onClick={()=>void loadAudit(tenantId)}>Consultar eventos</button>
    </div>
    {auditError&&<p role="alert" className="form-error">{auditError}</p>}
    {auditLoading&&<p role="status">Consultando eventos autorizados…</p>}
    {auditTenant===tenantId&&auditEvents.length>0&&<div className="table-wrap enterprise-governance-table">
     <table>
      <caption className="sr-only">Eventos de permissões da organização selecionada</caption>
      <thead><tr><th scope="col">Data e hora</th><th scope="col">Evento</th><th scope="col">Ator</th>
       <th scope="col">Recurso</th><th scope="col">Correlação</th></tr></thead>
      <tbody>{auditEvents.map(event=><tr key={event.id}>
       <td>{new Date(event.createdAt).toLocaleString('pt-BR')}</td>
       <td><strong>{event.action}</strong></td>
       <td><code>{event.actorId}</code></td>
       <td><code>{event.resourceId}</code></td>
       <td><code>{event.correlationId}</code></td>
      </tr>)}</tbody>
     </table>
    </div>}
    {auditTenant===tenantId&&auditEvents.length===0&&!auditLoading&&!auditError&&
     <p className="enterprise-governance-empty">Nenhum evento de permissão localizado nesta organização.</p>}
    {auditTenant!==tenantId&&!auditLoading&&
     <p className="enterprise-governance-hint">Consulta por demanda, com autorização no servidor e paginação por evento.</p>}
    {auditTenant===tenantId&&auditCursor&&<button type="button" className="secondary"
     disabled={auditLoading} onClick={()=>void loadAudit(tenantId,auditCursor)}>Carregar eventos anteriores</button>}
   </section>}
  </div>
 </main>;
}
