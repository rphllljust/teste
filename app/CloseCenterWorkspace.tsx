'use client';

import { useCallback, useEffect, useState } from 'react';
import { EnterprisePageHeader } from './components/enterprise/EnterprisePrimitives';

type Close = { id: string; periodStart: string; periodEnd: string; status: string; closedAt: string; reference: string };
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

  async function execute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/finance/periods/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: key, periodStart: form.get('periodStart'), periodEnd: form.get('periodEnd'), reference: form.get('reference') }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error);
      setRunning(false); await load(); setNotice('Período fechado com auditoria e bloqueio transacional ativo.');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Falha ao fechar o período.'); }
    finally { setSaving(false); }
  }

  return <section className="worklist" aria-busy={loading}><EnterprisePageHeader eyebrow="CONTABILIDADE / FECHAMENTO" title="Fechamento financeiro" description="Períodos, auditoria e bloqueios transacionais persistidos." />
    <div className="list-title"><div><h2>Fechamento financeiro</h2><p>Períodos fechados com auditoria. Baixas, pagamentos, transferências e importações retroativas são bloqueados.</p></div><button className="primary" onClick={() => { setKey(crypto.randomUUID()); setRunning(true); setNotice(''); }}>Fechar período</button></div>
    <div className="linked-info">O fechamento é idempotente, por proprietário e não permite sobreposição de períodos.</div>
    {error ? <div className="empty" role="alert">{error}<button className="secondary" onClick={() => void load()}>Tentar novamente</button></div> : loading ? <div className="empty" role="status">Consultando períodos fechados…</div> : items.length ? <div className="table-wrap"><table><thead><tr><th>Período</th><th>Referência</th><th>Fechado em</th><th>Status</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{date(item.periodStart)} a {date(item.periodEnd)}</td><td>{item.reference || '—'}</td><td>{timestamp(item.closedAt)}</td><td><span className="badge">{item.status === 'closed' ? 'Fechado' : item.status}</span></td></tr>)}</tbody></table></div> : <div className="empty"><h3>Nenhum período fechado</h3><p>Feche o primeiro período depois de conferir os lançamentos e a conciliação.</p></div>}
    {notice && !running && <p role="status" className="linked-info">{notice}</p>}
    {running && <div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Fechar período"><header><h2>Fechar período</h2><button className="icon-button" onClick={() => setRunning(false)} aria-label="Fechar janela">Fechar</button></header><form onSubmit={execute}><div className="form-row"><label>Início<input type="date" name="periodStart" required /></label><label>Fim<input type="date" name="periodEnd" required /></label></div><label>Referência<input name="reference" minLength={1} maxLength={160} placeholder="Ex.: Fechamento novembro/2026" required /></label><p className="muted">Após confirmar, operações com data dentro do período serão recusadas com conflito e permanecerão auditadas.</p>{notice && <p role="alert" className="form-error">{notice}</p>}<footer><button type="button" className="secondary" onClick={() => setRunning(false)}>Cancelar</button><button className="primary" disabled={saving}>Confirmar fechamento</button></footer></form></section></div>}
  </section>;
}
