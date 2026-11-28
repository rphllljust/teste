'use client';
import {useEffect,useState} from 'react';
type Owner={ownerKey:string;displayName:string;declaredRole:'owner';identityState:'unlinked'|'verified'};

/** Ownership declaration is not permission to impersonate a named person. */
export default function EnterpriseOwnerDeclarations(){
 const [owners,setOwners]=useState<Owner[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  const timer=window.setTimeout(async()=>{
   try{
    const response=await fetch('/api/enterprise/owners',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
    const data=await response.json() as {items?:Owner[];error?:string};
    if(!response.ok)throw new Error(data.error??'Cadastro de proprietários indisponível.');
    if(!controller.signal.aborted)setOwners(data.items??[]);
   }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Falha ao consultar proprietários.');}
   finally{if(!controller.signal.aborted)setLoading(false);}
  },0);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[]);
 return <section id="governance-owners" className="enterprise-governance-panel" aria-labelledby="governance-owners-heading" aria-busy={loading}>
  <div className="enterprise-governance-panel-heading"><div>
   <span className="eyebrow">PROPRIEDADE / GOVERNANÇA</span>
   <h2 id="governance-owners-heading">Proprietários declarados do CISNE ERP</h2>
   <p>Registro permanente no PostgreSQL, independente de qualquer organização.</p>
  </div><span className="enterprise-governance-count">{loading?'Consultando…':owners.length+' proprietários'}</span></div>
  {loading&&<p role="status">Consultando proprietários no PostgreSQL…</p>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {!loading&&!error&&<>
   <div className="enterprise-owners-list">{owners.map(person=><div className="enterprise-owner-item" key={person.ownerKey}>
    <strong>{person.displayName}</strong><span>Papel declarado: {person.declaredRole}</span>
    <small>{person.identityState==='verified'?'Identidade vinculada':'Aguardando identificação da conta de acesso'}</small>
   </div>)}</div>
   <p className="enterprise-governance-hint">Abrahim e Rafael são declarados proprietários com a mesma autoridade. Este cadastro não concede acesso automaticamente: a função owner em uma organização exige identidade autenticada e vínculo autorizado.</p>
  </>}
 </section>;
}
