'use client';

import { useCallback, useEffect, useState } from 'react';
import { EnterprisePageHeader } from './components/enterprise/EnterprisePrimitives';
import { moneyScaled } from '../lib/domain/orders';

type Close = { id: string; periodStart: string; periodEnd: string; status: string; closedAt: string; reference: string };
type Preflight = { tier1Readiness?:{ready:boolean;status:'ready'|'blocked';blockers:Array<{code:string;count:number}>}; periodStart:string;periodEnd:string;blockingInvoices:number;blockingAmountScaled:string;invalidCashLinks:number;unpostedCashEvents:number;unpostedCashAmountScaled:string;invalidPayableLinks:number;invalidPayablePaymentLinks:number;unpostedPayables:number;unpostedPayablesAmountScaled:string;unpostedPayablePayments:number;unpostedPayablePaymentsAmountScaled:string;canClose:boolean;advisoryOnly:boolean };
const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const timestamp = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

const blockerDestinations:Record<string,{label:string;module:string}>={
  invoicesWithoutVerifiedPosting:{label:'Faturas sem diário comprovado',module:'Contabilidade'},
  invalidCashLinks:{label:'Baixas com vínculo inconsistente',module:'Caixa e conciliação'},
  invalidPayableLinks:{label:'Obrigações com diário inconsistente',module:'Contabilidade'},
  invalidPayablePaymentLinks:{label:'Pagamentos com diário inconsistente',module:'Contabilidade'},
  unpostedCashEvents:{label:'Baixas legadas sem diário',module:'Caixa e conciliação'},
  unpostedPayables:{label:'Obrigações legadas sem diário',module:'Contas a pagar'},
  unpostedPayablePayments:{label:'Pagamentos legados sem diário',module:'Contas a pagar'},
};
export default function CloseCenterWorkspace({onNavigate}:{onNavigate:(module:string)=>void}) {
  const [items, setItems] = useState<Close[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState('');
  const [preflight, setPreflight] = useState<Preflight|null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/finance/periods/close');
      const body = await response.json() as { items: Close[]; error?: string };
      if (!response.ok) throw new Error(body.error);
      setItems(body.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Centro indisponível.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function checkReadiness(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form || !form.reportValidity()) return;
    const values = new FormData(form);
    const periodStart = String(values.get('periodStart')??'');
    const periodEnd = String(values.get('periodEnd')??'');
    setChecking(true);setNotice('');setPreflight(null);
    try{
      const query = new URLSearchParams({periodStart,periodEnd});
      const response=await fetch('/api/finance/periods/preflight?'+query.toString(),{cache:'no-store'});
      const body=await response.json() as Preflight&{error?:string};
      if(!response.ok)throw new Error(body.error??'Pré-fechamento indisponível.');
      setPreflight(body);
      setNotice(!body.tier1Readiness?'Prontidão estrita indisponível. Não atestar encerramento contábil Tier 1.':
        !body.canClose?'Fechamento Tier 1 bloqueado: existem origens sem escrituração ou vínculos contábeis inconsistentes.': 
        !body.tier1Readiness.ready?'A certificação contábil Tier 1 não está pronta. Verifique os fatos sem diário.':
        'Prévia sem bloqueios detectados. A autorização financeira será revalidada no servidor sob lock; isso não constitui certificação por si só.');
    }catch(cause){setNotice(cause instanceof Error?cause.message:'Falha na prévia de fechamento.');}
    finally{setChecking(false);}
  }

  async function execute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice('');
    const form = new FormData(event.currentTarget);
    if(!preflight?.canClose || !preflight?.tier1Readiness?.ready ||
       preflight.periodStart!==form.get('periodStart') ||
       preflight.periodEnd!==form.get('periodEnd')){
      setSaving(false);setNotice('Execute a prévia de conciliação desta competência antes de fechar.');return;
    }
    try {
      const response = await fetch('/api/finance/periods/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: key, periodStart: form.get('periodStart'), periodEnd: form.get('periodEnd'), reference: form.get('reference') }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error);
      setRunning(false); await load(); setNotice('Período fechado com auditoria e bloqueio transacional ativo.');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Falha ao fechar o período.'); }
    finally { setSaving(false); }
  }

  return <section className="worklist" aria-busy={loading}><EnterprisePageHeader eyebrow="CONTABILIDADE / FECHAMENTO" title="Fechamento financeiro" description="Períodos, auditoria e bloqueios transacionais persistidos." />
    <div className="list-title"><div><h2>Fechamento financeiro</h2><p>Períodos fechados com auditoria. Baixas, pagamentos, transferências e importações retroativas são bloqueados.</p></div><button className="primary" onClick={() => { setKey(crypto.randomUUID()); setRunning(true); setNotice('');setPreflight(null); }}>Fechar período</button></div>
    <div className="linked-info">O fechamento é idempotente, por proprietário e não permite sobreposição de períodos. Exige faturas com lançamentos conciliados, publicados, não estornados e da mesma competência. A prévia não substitui a validação transacional final.</div>
    {error ? <div className="empty" role="alert">{error}<button className="secondary" onClick={() => void load()}>Tentar novamente</button></div> : loading ? <div className="empty" role="status">Consultando períodos fechados…</div> : items.length ? <div className="table-wrap"><table><thead><tr><th>Período</th><th>Referência</th><th>Fechado em</th><th>Status</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{date(item.periodStart)} a {date(item.periodEnd)}</td><td>{item.reference || '—'}</td><td>{timestamp(item.closedAt)}</td><td><span className="badge">{item.status === 'closed' ? 'Fechado' : item.status}</span></td></tr>)}</tbody></table></div> : <div className="empty"><h3>Nenhum período fechado</h3><p>Feche o primeiro período depois de conferir os lançamentos e a conciliação.</p></div>}
    {notice && !running && <p role="status" className="linked-info">{notice}</p>}
    {running && <div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Fechar período"><header><h2>Fechar período</h2><button className="icon-button" onClick={() => setRunning(false)} aria-label="Fechar janela">Fechar</button></header><form onSubmit={execute}><div className="form-row"><label>Início<input type="date" name="periodStart" onChange={()=>setPreflight(null)} required /></label><label>Fim<input type="date" name="periodEnd" onChange={()=>setPreflight(null)} required /></label></div><label>Referência<input name="reference" minLength={1} maxLength={160} placeholder="Ex.: Fechamento novembro/2026" required /></label><p className="muted">A prévia verifica faturas, recebimentos, obrigações e pagamentos vinculados aos respectivos diários. Fatos financeiros sem contabilização comprovada bloqueiam novos fechamentos. Operações retroativas serão bloqueadas.</p>{preflight&&<div className="linked-info" role="status"><p>{preflight.canClose?"Sem bloqueios de origem contábil persistida.":`${preflight.blockingInvoices} fatura(s) bloqueadora(s), total ${moneyScaled(preflight.blockingAmountScaled)}. ${preflight.invalidCashLinks} vínculo(s) de baixa inconsistentes; ${preflight.invalidPayableLinks} obrigação(ões) e ${preflight.invalidPayablePaymentLinks} pagamento(s) com vínculo contábil inválido. Corrija antes de fechar.`}</p><p>{preflight.unpostedCashEvents} baixa(s) legada(s) sem diário, valor bruto ${moneyScaled(preflight.unpostedCashAmountScaled)}. {preflight.unpostedPayables} obrigação(ões) sem diário, total ${moneyScaled(preflight.unpostedPayablesAmountScaled)}; {preflight.unpostedPayablePayments} pagamento(s)/estorno(s) sem diário, total bruto ${moneyScaled(preflight.unpostedPayablePaymentsAmountScaled)}. Essas pendências bloqueiam o encerramento Tier 1; não é permitido presumir contabilização.</p></div>}{preflight&&<section className="finance-tier1-close-assurance" aria-label="Prontidão contábil Tier 1" data-state={preflight.tier1Readiness?.ready?'ready':'blocked'}>
 <header><strong>Certificação contábil Tier 1</strong><span>{preflight.tier1Readiness?.ready?'Sem bloqueadores detectados':'Não certificada'}</span></header>
 <p>O comando de fechamento exige também escrituração comprovada de fatos legados. A prévia nunca substitui a revalidação transacional.</p>
 {!preflight.tier1Readiness&&<p role="alert">O servidor não retornou a prontidão contábil estrita.</p>}
 {!!preflight.tier1Readiness?.blockers.length&&<ul>{preflight.tier1Readiness.blockers.map(block=>{
  const item=blockerDestinations[block.code]??{label:block.code,module:'Contabilidade'};
  return <li key={block.code}><span><strong>{block.count}</strong> {item.label}</span>
   <button type="button" onClick={()=>{setRunning(false);onNavigate(item.module);}}>Regularizar no módulo</button></li>;
 })}</ul>}
 </section>}{notice && <p role="alert" className="form-error">{notice}</p>}<footer><button type="button" className="secondary" onClick={() => setRunning(false)}>Cancelar</button><button type="button" className="secondary" disabled={checking||saving} onClick={e=>void checkReadiness(e)}>{checking?"Verificando…":"Verificar conciliação"}</button><button className="primary" disabled={saving||checking||!preflight?.canClose||!preflight?.tier1Readiness?.ready}>Confirmar fechamento</button></footer></form></section></div>}
  </section>;
}
