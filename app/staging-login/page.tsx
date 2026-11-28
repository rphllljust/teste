'use client';
import {useEffect,useState,type FormEvent} from 'react';

export default function StagingLogin(){
 const [mode,setMode]=useState<'shared'|'individual'>('shared');
 const [login,setLogin]=useState(''),[passphrase,setPassphrase]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let mounted=true;
  void fetch('/api/auth/staging-login',{cache:'no-store',credentials:'same-origin'})
   .then(r=>r.json())
   .then((x:{authenticated?:boolean;authMode?:string})=>{
    if(!mounted)return;
    setMode(x.authMode==='individual'?'individual':'shared');
    if(x.authenticated)window.location.replace('/');
   }).catch(()=>{if(mounted)setError('Autenticação de homologação indisponível.');});
  return()=>{mounted=false;};
 },[]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  setBusy(true);setError('');
  try{
   const payload=mode==='individual'?{login,passphrase}:{passphrase};
   const response=await fetch('/api/auth/staging-login',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
   });
   const data=await response.json() as {authenticated?:boolean;error?:string};
   if(!response.ok||!data.authenticated)throw Error(data.error??'Acesso não autorizado.');
   setPassphrase('');window.location.replace('/');
  }catch(ex){setError(ex instanceof Error?ex.message:'Falha no acesso.');}
  finally{setBusy(false);}
 }
 return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',background:'#f1f5f9',padding:20}}>
  <section style={{background:'#fff',maxWidth:450,width:'100%',padding:30,borderRadius:12,border:'1px solid #d3dfea'}} aria-label="Login homologação">
   <strong style={{letterSpacing:2,color:'#24526c'}}>CISNE ERP · HOMOLOGAÇÃO</strong>
   <h1>Acesso ao sistema</h1>
   <p>{mode==='individual'?'Entre com sua conta individual. Proprietários e empregados recebem apenas as permissões atribuídas.':'Acesso legado de homologação; modo individual depende de provisionamento administrativo.'}</p>
   <form onSubmit={e=>void submit(e)}>
    {mode==='individual'&&<label style={{display:'block',marginBottom:12}}>Identificador pessoal
     <input required autoComplete="username" value={login} onChange={e=>setLogin(e.target.value)} minLength={3} maxLength={80} style={{width:'100%'}}/>
    </label>}
    <label style={{display:'block',marginBottom:12}}>Credencial de acesso
     <input required autoComplete="current-password" type="password" value={passphrase} onChange={e=>setPassphrase(e.target.value)} minLength={mode==='individual'?32:24} maxLength={160} style={{width:'100%'}}/>
    </label>
    {error&&<p role="alert" style={{color:'#a32627'}}>{error}</p>}
    <button disabled={busy} type="submit">{busy?'Autenticando…':'Entrar'}</button>
   </form>
   <p style={{fontSize:12,color:'#6b7280'}}>As permissões são validadas no servidor. Acesso de homologação não equivale à produção.</p>
  </section>
 </main>;
}
