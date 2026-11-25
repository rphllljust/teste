'use client';

import { useCallback, useEffect, useState } from 'react';
import { EnterprisePageHeader } from './components/enterprise/EnterprisePrimitives';
import { moneyScaled } from '../lib/domain/orders';

type Close = { id: string; periodStart: string; periodEnd: string; status: string; closedAt: string; reference: string };
type Preflight = { periodStart:string;periodEnd:string;blockingInvoices:number;blockingAmountScaled:string;canClose:boolean;advisoryOnly:boolean };
const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const timestamp = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function CloseCenterWorkspace() {
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
      setNotice(body.canClose?'Conciliação aprovada na prévia. A validação será repetida sob lock ao fechar.':
        'Fechamento bloqueado: existem faturas sem contabilização válida.');
    }catch(cause){setNotice(cause instanceof Error?cause.message:'Falha na prévia de fechamento.');}
    finally{setChecking(false);}
  }

  async function execute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice('');
    const form = new FormData(event.currentTarget);
    if(!preflight?.canClose || preflight.periodStart!==form.get('periodStart') ||
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
    {running && <div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Fechar período"><header><h2>Fechar período</h2><button className="icon-button" onClick={() => setRunning(false)} aria-label="Fechar janela">Fechar</button></header><form onSubmit={execute}><div className="form-row"><label>Início<input type="date" name="periodStart" onChange={()=>setPreflight(null)} required /></label><label>Fim<input type="date" name="periodEnd" onChange={()=>setPreflight(null)} required /></label></div><label>Referência<input name="reference" minLength={1} maxLength={160} placeholder="Ex.: Fechamento novembro/2026" required /></label><p className="muted">A prévia compara cada fatura da competência com o lançamento de origem. Operações com data dentro da competência fechada permanecerão bloqueadas.</p>{preflight&&<p role="status" className="linked-info">{preflight.canClose?"Sem bloqueios de origem contábil.":`${preflight.blockingInvoices} fatura(s) bloqueadora(s), total ${moneyScaled(preflight.blockingAmountScaled)}. Corrija antes de fechar.`}</p>}{notice && <p role="alert" className="form-error">{notice}</p>}<footer><button type="button" className="secondary" onClick={() => setRunning(false)}>Cancelar</button><button type="button" className="secondary" disabled={checking||saving} onClick={e=>void checkReadiness(e)}>{checking?"Verificando…":"Verificar conciliação"}</button><button className="primary" disabled={saving||checking||!preflight?.canClose}>Confirmar fechamento</button></footer></form></section></div>}
  </section>;
}
