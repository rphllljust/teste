'use client';
import {useCallback,useEffect,useState} from 'react';
import {moneyScaled} from '../lib/domain/orders';
import {EnterprisePageHeader} from './components/enterprise/EnterprisePrimitives';
type Account={id:string;code:string;name:string;type:string;active:number};
type PostingRule={id:string;sourceType:string;debitAccountId:string;creditAccountId:string;active:number;rowVersion:number};
type Reconciliation={accountingLinkage:{status:string;reason:string};summary:{invoiceCount:number;verifiedPostingCount:number;withoutVerifiedPostingCount:number;withoutVerifiedPostingAmountScaled:string;missingReceivableCount:number;standaloneJournalCount:number;automaticPostingCount:number;manualVerifiedCount:number};items:Array<{invoiceId:string;amountScaled:string;verifiedPosting:boolean;journalId:string|null}>};
type Entry={id:string;effectiveDate:string;sourceReference:string;description:string;status:string;debitScaled:string;creditScaled:string;reversalOf?:string|null;reversalId?:string|null};
type JournalLine={id:string;code:string;name:string;debitScaled:string;creditScaled:string};
type Row={id:string;accountId:string;side:'debit'|'credit';amount:string};
const date=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'));
async function readAccountingJson<T>(response:Response):Promise<T>{
 const body=await response.text();
 try{return JSON.parse(body) as T;}catch{throw new Error(response.status===404?'Contrato da API contábil indisponível no ambiente.':'Resposta inválida da API contábil.');}
}
export default function AccountingWorkspace(){
 const [postingRule,setPostingRule]=useState<PostingRule|null>(null),[ruleLoading,setRuleLoading]=useState(true),[ruleError,setRuleError]=useState('');
 const [reconciliation,setReconciliation]=useState<Reconciliation|null>(null),[reconciliationError,setReconciliationError]=useState(''),[linking,setLinking]=useState<{key:string;id:string;journalId:string}|null>(null);
 const [accounts,setAccounts]=useState<Account[]>([]),[entries,setEntries]=useState<Entry[]>([]),[page,setPage]=useState(1),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[creatingAccount,setCreatingAccount]=useState(false),[creatingEntry,setCreatingEntry]=useState(false),[saving,setSaving]=useState(false),[accountKey,setAccountKey]=useState(''),[entryKey,setEntryKey]=useState(''),[lines,setLines]=useState<Row[]>([]),[detail,setDetail]=useState<{entry:Entry;lines:JournalLine[]}|null>(null),[reversing,setReversing]=useState<{key:string;originalId:string}|null>(null);
 const load=useCallback(async()=>{setLoading(true);setError('');try{const [ar,jr]=await Promise.all([fetch('/api/accounting/accounts'),fetch('/api/accounting/journals?page='+page)]);const a=await readAccountingJson<{items:Account[];error?:string}>(ar),j=await readAccountingJson<{items:Entry[];pageInfo:{hasMore:boolean};error?:string}>(jr);if(!ar.ok||!jr.ok)throw new Error(a.error??j.error);setAccounts(a.items);setEntries(j.items);setHasMore(j.pageInfo.hasMore);}catch(e){setError(e instanceof Error?e.message:'Contabilidade indisponível.');}finally{setLoading(false);}},[page]);
 useEffect(()=>{const t=setTimeout(()=>void load(),0);return()=>clearTimeout(t);},[load]);
 useEffect(()=>{
   const controller=new AbortController();
   fetch('/api/accounting/reconciliation',{signal:controller.signal}).then(async response=>{
     const result=await readAccountingJson<Reconciliation&{error?:string}>(response);
     if(!response.ok)throw new Error(result.error??'Conciliação não disponível.');
     if(!controller.signal.aborted)setReconciliation(result);
   }).catch(error=>{if(!controller.signal.aborted)setReconciliationError(error instanceof Error?error.message:'Conciliação não disponível.');});
   return()=>controller.abort();
 },[]);
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/accounting/posting-rules',{signal:controller.signal}).then(async response=>{
    const body=await readAccountingJson<{rule:PostingRule|null;error?:string}>(response);
    if(!response.ok)throw new Error(body.error??'Configuração contábil indisponível.');
    if(!controller.signal.aborted)setPostingRule(body.rule);
  }).catch(error=>{
    if(!controller.signal.aborted)setRuleError(error instanceof Error?error.message:'Falha na configuração contábil.');
  }).finally(()=>{if(!controller.signal.aborted)setRuleLoading(false);});
  return()=>controller.abort();
 },[]);
 async function savePostingRule(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setSaving(true);setRuleError('');setNotice('');
  const form=new FormData(e.currentTarget);
  try{
    const response=await fetch('/api/accounting/posting-rules',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        commandKey:crypto.randomUUID(),expectedVersion:postingRule?.rowVersion??0,
        debitAccountId:form.get('debitAccountId'),creditAccountId:form.get('creditAccountId'),
        active:form.get('active')==='on',
      }),
    });
    const result=await readAccountingJson<PostingRule&{error?:string}>(response);
    if(!response.ok)throw new Error(result.error??'Não foi possível salvar a regra.');
    setPostingRule({...result,active:result.active?1:0});
    setNotice(result.active?'Contabilização automática habilitada para novos faturamentos.':'Contabilização automática desabilitada para novos faturamentos.');
  }catch(error){setRuleError(error instanceof Error?error.message:'Não foi possível configurar contabilização.');}
  finally{setSaving(false);}
 }
 async function saveLink(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(!linking)return;setSaving(true);setNotice('');
  const form=new FormData(e.currentTarget);
  try{
   const response=await fetch('/api/accounting/invoice-links',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:linking.id,commandKey:linking.key,invoiceId:form.get('invoiceId'),journalId:linking.journalId}),
   });
   const result=await response.json() as {error?:string};
   if(!response.ok)throw new Error(result.error??'Não foi possível validar a origem da fatura.');
   const refresh=await fetch('/api/accounting/reconciliation');
   const data=await readAccountingJson<Reconciliation&{error?:string}>(refresh);
   if(!refresh.ok)throw new Error(data.error??'Vínculo registrado; a conciliação não pôde ser atualizada.');
   setReconciliation(data);setLinking(null);setDetail(null);
   setNotice('Vínculo de origem validado. Isto não cria lançamento contábil automático.');
  }catch(error){setNotice(error instanceof Error?error.message:'Não foi possível vincular a fatura.');}
  finally{setSaving(false);}
 }
 async function open(id:string){try{const r=await fetch('/api/accounting/journals/'+encodeURIComponent(id));const d=await r.json() as {entry:Entry;lines:JournalLine[];error?:string};if(!r.ok)throw new Error(d.error);setDetail(d);}catch(e){setNotice(e instanceof Error?e.message:'Lançamento indisponível.');}}
 async function saveAccount(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setNotice('');const f=new FormData(e.currentTarget);try{const r=await fetch('/api/accounting/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:accountKey,code:f.get('code'),name:f.get('name'),type:f.get('type')})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);setCreatingAccount(false);await load();setNotice('Conta registrada.');}catch(e){setNotice(e instanceof Error?e.message:'Falha ao registrar conta.');}finally{setSaving(false);}}
 async function saveEntry(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setNotice('');const f=new FormData(e.currentTarget);try{const r=await fetch('/api/accounting/journals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entryKey,effectiveDate:f.get('effectiveDate'),sourceReference:f.get('sourceReference'),description:f.get('description'),lines:lines.map(line=>({id:line.id,accountId:line.accountId,debit:line.side==='debit'?line.amount:'0',credit:line.side==='credit'?line.amount:'0'}))})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);setCreatingEntry(false);await load();setNotice('Lançamento postado com partidas equilibradas.');}catch(e){setNotice(e instanceof Error?e.message:'Falha ao postar lançamento.');}finally{setSaving(false);}}
 async function reverseEntry(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(!reversing)return;setSaving(true);setNotice('');const f=new FormData(e.currentTarget);try{const r=await fetch('/api/accounting/journals/'+encodeURIComponent(reversing.originalId)+'/reverse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commandKey:reversing.key,effectiveDate:f.get('effectiveDate'),sourceReference:f.get('sourceReference'),description:f.get('description')})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);setReversing(null);setDetail(null);await load();try{const r=await fetch('/api/accounting/reconciliation');if(r.ok)setReconciliation(await r.json() as Reconciliation);}catch{/* journal reversal remains posted */}setNotice('Estorno postado como lançamento inverso.');}catch(e){setNotice(e instanceof Error?e.message:'Falha no estorno.');}finally{setSaving(false);}}
 const updateLine=(id:string,key:keyof Row,value:string)=>setLines(prev=>prev.map(l=>l.id===id?{...l,[key]:value}:l));
 return <section className="worklist" aria-busy={loading}><EnterprisePageHeader eyebrow="FINANCEIRO / OPERAÇÕES" title="Workspace financeiro" description="Dados transacionais, indicadores e pendências com origem persistida."/><div className="list-title"><div><h2>Diário contábil</h2><p>Plano de contas e partidas dobradas com origem documentada e histórico imutável.</p></div><div className="worklist-tools"><button className="secondary" onClick={()=>{setAccountKey(crypto.randomUUID());setCreatingAccount(true);setNotice('');}}>Nova conta</button><button className="primary" disabled={accounts.filter(a=>a.active).length<2} onClick={()=>{setEntryKey(crypto.randomUUID());setLines([{id:crypto.randomUUID(),accountId:'',side:'debit',amount:''},{id:crypto.randomUUID(),accountId:'',side:'credit',amount:''}]);setCreatingEntry(true);setNotice('');}}>Novo lançamento</button></div></div>
 <div className="linked-info">{accounts.length} contas registradas. A contabilização automática só ocorre para novas faturas quando a regra abaixo estiver ativa e válida; pagamentos e tributos não são contabilizados automaticamente.</div>
 <section className="linked-info" aria-label="Regra de contabilização automática de faturas">
  <strong>Reconhecimento automático de receita</strong>
  <p>Configuração explícita por proprietário. Ao faturar uma medição aprovada, o ERP registra débito em ativo a receber e crédito em receita na mesma transação da fatura. Nenhuma regra ou conta é presumida.</p>
  {ruleLoading?<p role="status">Consultando regra contábil…</p>:<form onSubmit={savePostingRule} key={postingRule?.rowVersion??0}>
    <div className="form-row">
      <label>Conta de débito · ativo a receber
        <select name="debitAccountId" defaultValue={postingRule?.debitAccountId??''} required>
          <option value="" disabled>Selecione a conta</option>
          {accounts.filter(a=>a.active===1&&a.type==='asset').map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
      </label>
      <label>Conta de crédito · receita
        <select name="creditAccountId" defaultValue={postingRule?.creditAccountId??''} required>
          <option value="" disabled>Selecione a conta</option>
          {accounts.filter(a=>a.active===1&&a.type==='revenue').map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
      </label>
    </div>
    <label><input type="checkbox" name="active" defaultChecked={postingRule?.active===1}/> Habilitar publicação contábil automática nos próximos faturamentos</label>
    <p>Estado: {postingRule?.active===1?'Ativa':'Inativa'} · Versão {postingRule?.rowVersion??0}. O histórico anterior não é contabilizado retroativamente. Regras de impostos, custos e recebimentos ainda precisam de integração específica.</p>
    {ruleError&&<p role="alert">{ruleError}</p>}
    <button className="secondary" disabled={saving||!accounts.some(a=>a.active===1&&a.type==='asset')||!accounts.some(a=>a.active===1&&a.type==='revenue')} type="submit">Salvar política contábil</button>
  </form>}
 </section>
 <section className="linked-info" aria-label="Conciliação contábil de faturamento">
   <strong>Conciliação de origem</strong>
   {reconciliation?<p>{reconciliation.summary.automaticPostingCount} fatura(s) contabilizada(s) automaticamente; {reconciliation.summary.manualVerifiedCount} vinculada(s) manualmente. Total de {reconciliation.summary.verifiedPostingCount} fatura(s) com vínculo válido; {reconciliation.summary.withoutVerifiedPostingCount} ainda sem vínculo válido, total de {moneyScaled(reconciliation.summary.withoutVerifiedPostingAmountScaled)}. {reconciliation.summary.missingReceivableCount} sem título a receber. Regras ativas geram partidas somente em novos faturamentos; estornos voltam a aparecer como pendência.</p>:reconciliationError?<p role="alert">Conciliação indisponível: {reconciliationError}</p>:<p role="status">Conferindo vínculos de faturamento…</p>}
 </section>
 {error?<div className="empty" role="alert">{error}<button onClick={()=>void load()} className="secondary">Tentar novamente</button></div>:loading?<div className="empty" role="status">Consultando diário…</div>:entries.length?<div className="table-wrap"><table><thead><tr><th>Data / origem</th><th>Descrição</th><th>Débitos</th><th>Créditos</th><th>Situação</th></tr></thead><tbody>{entries.map(e=><tr key={e.id}><td><button className="row-link" onClick={()=>void open(e.id)}>{date(e.effectiveDate)}</button><small>{e.sourceReference}</small></td><td>{e.description}</td><td className="amount">{moneyScaled(e.debitScaled)}</td><td className="amount">{moneyScaled(e.creditScaled)}</td><td><span className="badge">Postado</span></td></tr>)}</tbody></table></div>:<div className="empty"><h3>Nenhum lançamento postado</h3><p>Cadastre pelo menos duas contas e informe uma origem para lançar partidas equilibradas.</p></div>}
 <footer className="table-footer"><span>Página {page}</span><div className="pagination"><button disabled={page===1} onClick={()=>setPage(v=>v-1)}>Anterior</button><button disabled={!hasMore} onClick={()=>setPage(v=>v+1)}>Próxima</button></div></footer>
 {notice&&!creatingAccount&&!creatingEntry&&<p role="status" className="linked-info">{notice}</p>}
 {detail&&<div className="overlay" onClick={()=>setDetail(null)}><aside className="drawer" role="dialog" aria-modal="true" aria-label="Partidas do lançamento" onClick={e=>e.stopPropagation()}><header><span className="eyebrow">OBJECT PAGE · DIÁRIO POSTADO</span><button className="icon-button" onClick={()=>setDetail(null)} aria-label="Fechar lançamento">Fechar</button></header><nav className="object-anchors" aria-label="Seções do lançamento"><a href="#ledger-detail">Identificação</a><a href="#ledger-lines">Partidas</a></nav><h2 id="ledger-detail">{detail.entry.sourceReference}</h2><p>{detail.entry.description} · {date(detail.entry.effectiveDate)}</p><h3 id="ledger-lines">Partidas</h3>{detail.entry.reversalOf&&<p className="linked-info">Estorno de {detail.entry.reversalOf.slice(0,8).toUpperCase()}</p>}{detail.entry.reversalId&&<p className="linked-info">Estornado por {detail.entry.reversalId.slice(0,8).toUpperCase()}</p>}{detail.lines.map(l=><div className="event-row" key={l.id}><span>{l.code} · {l.name}</span><small>Débito {moneyScaled(l.debitScaled)} · Crédito {moneyScaled(l.creditScaled)}</small></div>)}{!detail.entry.reversalOf&&!detail.entry.reversalId&&<button className="secondary" onClick={()=>{setReversing({key:crypto.randomUUID(),originalId:detail.entry.id});setNotice('');}}>Estornar lançamento</button>}{!detail.entry.reversalOf&&!detail.entry.reversalId&&reconciliation?.items.some(x=>!x.verifiedPosting&&!x.journalId)&&<button className="secondary" onClick={()=>{setLinking({id:crypto.randomUUID(),key:crypto.randomUUID(),journalId:detail.entry.id});setNotice('');}}>Vincular origem da fatura</button>}</aside></div>}

 {linking&&<div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Vincular lançamento a uma fatura"><header><h2>Vínculo contábil verificado</h2><button className="icon-button" onClick={()=>setLinking(null)} aria-label="Fechar vínculo">Fechar</button></header><form onSubmit={saveLink}><p className="muted">Associe um diário já publicado a uma fatura de mesmo valor. A API confere o proprietário, as partidas, o período e os estornos. Não gera novo lançamento.</p><label>Fatura sem vínculo verificado<select name="invoiceId" required defaultValue=""><option value="" disabled>Selecione uma fatura</option>{reconciliation?.items.filter(x=>!x.verifiedPosting&&!x.journalId).map(x=><option value={x.invoiceId} key={x.invoiceId}>{x.invoiceId.slice(0,8).toUpperCase()} · {moneyScaled(x.amountScaled)}</option>)}</select></label>{notice&&<p role="alert" className="form-error">{notice}</p>}<footer><button type="button" className="secondary" onClick={()=>setLinking(null)}>Cancelar</button><button className="primary" disabled={saving||!reconciliation?.items.some(x=>!x.verifiedPosting&&!x.journalId)}>Validar vínculo</button></footer></form></section></div>}
 {reversing&&<div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Estornar lançamento contábil"><header><h2>Estornar lançamento</h2><button className="icon-button" onClick={()=>setReversing(null)} aria-label="Fechar estorno">Fechar</button></header><p className="muted">O estorno cria partidas inversas e mantém o original no diário.</p><form onSubmit={reverseEntry}><label>Data do estorno<input type="date" name="effectiveDate" required/></label><label>Referência de origem<input name="sourceReference" minLength={3} maxLength={160} required/></label><label>Justificativa<textarea name="description" minLength={3} maxLength={500} required/></label>{notice&&<p role="alert" className="form-error">{notice}</p>}<footer><button type="button" className="secondary" onClick={()=>setReversing(null)}>Cancelar</button><button className="primary" disabled={saving}>Postar estorno</button></footer></form></section></div>}
 {creatingAccount&&<div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Cadastrar conta contábil"><header><h2>Nova conta contábil</h2><button className="icon-button" onClick={()=>setCreatingAccount(false)} aria-label="Fechar cadastro">Fechar</button></header><form onSubmit={saveAccount}><label>Código<input autoFocus name="code" minLength={2} maxLength={32} pattern="[A-Za-z0-9._-]+" required/></label><label>Nome<input name="name" minLength={3} maxLength={160} required/></label><label>Natureza<select name="type"><option value="asset">Ativo</option><option value="liability">Passivo</option><option value="equity">Patrimônio líquido</option><option value="revenue">Receita</option><option value="expense">Despesa</option></select></label>{notice&&<p role="alert" className="form-error">{notice}</p>}<footer><button type="button" className="secondary" onClick={()=>setCreatingAccount(false)}>Cancelar</button><button className="primary" disabled={saving}>Registrar conta</button></footer></form></section></div>}
 {creatingEntry&&<div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Postar lançamento"><header><h2>Novo lançamento</h2><button className="icon-button" onClick={()=>setCreatingEntry(false)} aria-label="Fechar lançamento">Fechar</button></header><p className="muted">O servidor e o banco conferem as partidas antes de postar. Registro postado não é editado.</p><form onSubmit={saveEntry}><label>Data do fato<input type="date" name="effectiveDate" required/></label><label>Referência de origem<input name="sourceReference" minLength={3} maxLength={160} required/></label><label>Descrição<textarea name="description" minLength={3} maxLength={500} required/></label><h3>Partidas</h3>{lines.map((l,index)=><div className="form-row" key={l.id}><label>Conta {index+1}<select required value={l.accountId} onChange={e=>updateLine(l.id,'accountId',e.target.value)}><option value="">Selecione</option>{accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Natureza<select value={l.side} onChange={e=>updateLine(l.id,'side',e.target.value)}><option value="debit">Débito</option><option value="credit">Crédito</option></select></label><label>Valor (R$)<input required inputMode="decimal" pattern="[0-9]+(,[0-9]{1,4})?" value={l.amount} onChange={e=>updateLine(l.id,'amount',e.target.value)}/></label>{lines.length>2&&<button type="button" className="text-button" onClick={()=>setLines(prev=>prev.filter(x=>x.id!==l.id))}>Remover</button>}</div>)}<button type="button" className="secondary" disabled={lines.length>=100} onClick={()=>setLines(prev=>[...prev,{id:crypto.randomUUID(),accountId:'',side:'debit',amount:''}])}>Adicionar partida</button>{notice&&<p role="alert" className="form-error">{notice}</p>}<footer><button type="button" className="secondary" onClick={()=>setCreatingEntry(false)}>Cancelar</button><button className="primary" disabled={saving}>Postar lançamento</button></footer></form></section></div>}</section>;
}
