'use client';
import {useEffect,useState,type FormEvent} from 'react';
export default function ProductionLogin(){
 const [passphrase,setPassphrase]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  fetch('/api/auth/production-login',{cache:'no-store'}).then(r=>r.json()).then((d:unknown)=>{
   if(active&&typeof d==='object'&&d!==null&&'authenticated' in d&&d.authenticated===true)window.location.replace('/');
  }).catch(()=>{});
  return()=>{active=false};
 },[]);
 async function login(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  setBusy(true);setError('');
  try{
   const r=await fetch('/api/auth/production-login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    credentials:'same-origin',body:JSON.stringify({passphrase}),
   });
   if(!r.ok)throw Error(r.status===401?'Credencial não autorizada.':'Falha ao autenticar.');
   setPassphrase('');window.location.replace('/');
  }catch(ex){setError(ex instanceof Error?ex.message:'Não foi possível entrar.');}
  finally{setBusy(false)}
 }
 return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',background:'#f1f5f9',padding:'20px'}}>
  <section aria-labelledby="cisne-login-title" style={{width:'100%',maxWidth:430,background:'#fff',padding:32,border:'1px solid #dce4ed',borderRadius:14,boxShadow:'0 12px 36px rgba(15,39,66,0.08)'}}>
   <p style={{fontSize:12,fontWeight:700,letterSpacing:2,color:'#48748a'}}>CISNE · ERP EMPRESARIAL</p>
   <h1 id="cisne-login-title" style={{fontSize:26,fontWeight:750,margin:'10px 0'}}>Acesso à produção</h1>
   <p style={{color:'#556979',lineHeight:1.55,marginBottom:20}}>Entre com a credencial empresarial autorizada. Este acesso é distinto da homologação.</p>
   <form onSubmit={login}>
    <label htmlFor="cisne-production-passphrase" style={{display:'block',fontWeight:650,marginBottom:8}}>Credencial de acesso</label>
    <input id="cisne-production-passphrase" type="password" autoComplete="current-password" required minLength={32} maxLength={160} value={passphrase} onChange={e=>setPassphrase(e.target.value)}
     style={{display:'block',width:'100%',padding:'13px 14px',border:'1px solid #aabecb',borderRadius:7,marginBottom:14}}/>
    {error&&<p role="alert" style={{color:'#a32627',marginBottom:12}}>{error}</p>}
    <button type="submit" disabled={busy} style={{width:'100%',padding:13,borderRadius:7,background:'#075681',color:'white',fontWeight:700,cursor:'pointer'}}>{busy?'Autenticando…':'Entrar no CISNE'}</button>
   </form>
   <p style={{fontSize:12,color:'#657783',lineHeight:1.5,marginTop:18}}>Sessão protegida com cookie HttpOnly, Secure e validade de oito horas. Comandos continuam sujeitos às regras do servidor.</p>
  </section>
 </main>;
}
