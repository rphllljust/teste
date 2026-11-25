'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Tenant={id:string;slug:string;name:string;role:string;status:string};
type Company={id:string;code:string;name:string;status:string;taxId?:string|null};
type Member={actorId:string;role:string;status:string;createdAt:string};

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
 const current=tenants.find(t=>t.id===tenantId);
 const isOwner=current?.role==='owner';

 const loadTenants=useCallback(async()=>{
  try{
   const result=await read<{items:Tenant[]}>(await fetch(tenantUrl,{cache:'no-store'}));
   setTenants(result.items);
   setTenantId(previous=>previous&&result.items.some(t=>t.id===previous)?previous:(result.items[0]?.id??''));
  }catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível consultar empresas.');}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void loadTenants();},[loadTenants]);
 const loadDetail=useCallback(async(id:string)=>{
  if(!id){setCompanies([]);setMembers([]);return;}
  setLoadingDetail(true);
  try{
   const root=tenantUrl+'/'+encodeURIComponent(id);
   const [companiesResult,membersResult]=await Promise.all([
    read<{items:Company[]}>(await fetch(root+'/legal-entities',{cache:'no-store'})),
    read<{items:Member[]}>(await fetch(root+'/members',{cache:'no-store'})),
   ]);
   setCompanies(companiesResult.items);setMembers(membersResult.items);
  }catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível consultar as unidades e permissões.');}
  finally{setLoadingDetail(false);}
 },[]);
 useEffect(()=>{void loadDetail(tenantId);},[tenantId,loadDetail]);

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
   await loadDetail(tenantId);formElement.reset();setNotice('Empresa jurídica registrada.');
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
   await loadDetail(tenantId);formElement.reset();
   setNotice('Vínculo provisionado. A identidade deverá autenticar-se com seu próprio acesso.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Falha ao provisionar membro.');}
  finally{setSaving(false);}
 }
 async function deactivate(actorId:string){
  if(!tenantId)return;setSaving(true);setError('');setNotice('');
  try{
   await post(tenantUrl+'/'+tenantId+'/members',{commandKey:newId(),action:'deactivate',actorId});
   await loadDetail(tenantId);setNotice('Membro desativado com evento de auditoria.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Falha ao desativar vínculo.');}
  finally{setSaving(false);}
 }
 return <main className="app" style={{minHeight:'100vh',padding:'clamp(16px,3vw,40px)'}}>
  <div className="worklist" style={{maxWidth:1180,margin:'0 auto'}}>
   <header className="list-title">
    <div><p className="eyebrow">CISNE / GOVERNANÇA EMPRESARIAL</p><h1>Estrutura empresarial</h1>
    <p>Organizações, empresas jurídicas e acessos nativos com registro persistido e auditoria.</p></div>
    <Link className="secondary" href="/" prefetch={false}>Voltar ao ERP</Link>
   </header>
   <p className="linked-info">Esta área administra o cadastro empresarial nativo. O isolamento dos registros legados por tenant ainda está em migração controlada; a presença de uma empresa aqui não altera os dados existentes.</p>
   {error&&<p role="alert" className="form-error">{error}</p>}
   {notice&&<p role="status" className="linked-info">{notice}</p>}
   <section className="module-workspace">
    <h2>Organizações</h2>
    {loading?<p role="status">Carregando…</p>:<label>Organização ativa
      <select value={tenantId} onChange={e=>{setError('');setTenantId(e.target.value);}} aria-label="Selecionar organização">
       <option value="">Selecione uma organização</option>
       {tenants.map(t=><option value={t.id} key={t.id}>{t.name} · {t.role}</option>)}
      </select></label>}
    <form onSubmit={createTenant}>
     <h3>Registrar organização</h3>
     <div className="form-row">
      <label>Identificador (slug)<input name="slug" pattern="[a-z][a-z0-9-]{2,47}" minLength={3} maxLength={48} placeholder="grupo-exemplo" required/></label>
      <label>Razão de referência<input name="name" minLength={3} maxLength={160} required/></label>
     </div><button className="primary" disabled={saving}>Criar organização</button>
    </form>
   </section>
   {current&&<section className="module-workspace" aria-busy={loadingDetail}>
    <h2>Empresas jurídicas · {current.name}</h2>
    {loadingDetail?<p role="status">Consultando estrutura…</p>:companies.length?
      <div className="table-wrap"><table><thead><tr><th>Código</th><th>Nome</th><th>Status</th></tr></thead>
       <tbody>{companies.map(c=><tr key={c.id}><td>{c.code}</td><td>{c.name}</td><td>{c.status}</td></tr>)}</tbody>
      </table></div>:<p>Nenhuma empresa jurídica cadastrada.</p>}
    {isOwner||current.role==='admin'?<form onSubmit={createCompany}>
     <h3>Registrar empresa jurídica</h3>
     <div className="form-row"><label>Código<input name="code" pattern="[A-Za-z0-9_-]{2,20}" required maxLength={20}/></label>
      <label>Razão social<input name="name" minLength={3} maxLength={160} required/></label>
      <label>CNPJ (somente números, opcional)<input name="taxId" inputMode="numeric" pattern="[0-9]{14}"/></label></div>
     <button className="primary" disabled={saving}>Registrar empresa</button>
    </form>:null}
   </section>}
   {current&&(isOwner||current.role==='admin')&&<section className="module-workspace">
    <h2>Equipe e permissões</h2>
    <p>Perfis provisionados no contexto da organização; a autorização da API é independente da interface.</p>
    <div className="table-wrap"><table><thead><tr><th>Identidade autenticável</th><th>Papel</th><th>Situação</th><th>Ação</th></tr></thead>
    <tbody>{members.map(m=><tr key={m.actorId}><td>{m.actorId}</td><td>{m.role}</td><td>{m.status}</td>
     <td>{isOwner&&m.role!=='owner'&&m.status==='active'?<button className="secondary" type="button" disabled={saving} onClick={()=>void deactivate(m.actorId)}>Desativar</button>:'—'}</td>
    </tr>)}</tbody></table></div>
    {isOwner&&<form onSubmit={provision}>
     <h3>Provisionar identidade</h3>
     <div className="form-row">
      <label>ID de usuário autenticado<input name="actorId" minLength={8} maxLength={200} required pattern="[A-Za-z0-9_.:@-]+"/></label>
      <label>Papel<select name="role" defaultValue="operator"><option value="operator">Operador</option><option value="accountant">Contador</option><option value="auditor">Auditor</option><option value="admin">Administrador</option></select></label>
     </div><button className="primary" disabled={saving}>Provisionar membro</button>
     <p className="muted">O ID deve corresponder a uma identidade verificada no provedor. Este cadastro não cria contas ou credenciais.</p>
    </form>}
   </section>}
  </div>
 </main>;
}
