'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Row = { id: string; documentType: string; number: string; issuedOn: string; clientName?: string; supplier?: string; grossAmountScaled: string; status: string; integrationProvider: string };
type Payload = { items: Row[]; pageInfo: { hasMore: boolean }; error?: string; notice?: string };

export default function FiscalWorkspace() {
  const [items, setItems] = useState<Row[]>([]);
  const [period, setPeriod] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/fiscal/documents?' + new URLSearchParams({ period, q, page: String(page) }));
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error ?? 'Fiscal indisponível.');
      setItems(data.items); setMore(data.pageInfo.hasMore);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Fiscal indisponível.'); }
    finally { setLoading(false); }
  }, [period, q, page]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const money = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) / 10000);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    const issuedOn = String(form.get('issuedOn'));
    const payload = {
      id: crypto.randomUUID(), direction: String(form.get('direction')), documentType: String(form.get('documentType')),
      number: String(form.get('number')), series: String(form.get('series') || ''), issuedOn, period: issuedOn.slice(0, 7),
      clientName: String(form.get('clientName') || ''), supplier: String(form.get('supplier') || ''), grossAmount: String(form.get('grossAmount')),
      taxBase: String(form.get('taxBase') || '0'), issAmount: String(form.get('issAmount') || '0'), icmsAmount: String(form.get('icmsAmount') || '0'),
      ipiAmount: String(form.get('ipiAmount') || '0'), pisAmount: String(form.get('pisAmount') || '0'), cofinsAmount: String(form.get('cofinsAmount') || '0'),
      withheldAmount: String(form.get('withheldAmount') || '0'), cfop: String(form.get('cfop') || ''), nature: String(form.get('nature') || ''),
      municipality: String(form.get('municipality') || ''), taxRegime: String(form.get('taxRegime') || ''), notes: String(form.get('notes') || ''),
    };
    try {
      const response = await fetch('/api/fiscal/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível registrar o documento fiscal.');
      setFormOpen(false); setNotice(data.notice ?? 'Documento fiscal registrado manualmente.'); setPage(1); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar o documento fiscal.'); }
    finally { setSaving(false); }
  };

  return <section className="worklist" aria-busy={loading}>
    <div className="list-title"><div><h2>Fiscal manual</h2><p>Documentos fiscais internos, tributos e períodos com origem auditável.</p></div><button className="primary" onClick={() => { setNotice(''); setError(''); setFormOpen(true); }}>Registrar documento</button></div>
    <div className="linked-info">Documento fiscal registrado manualmente. Integração automática com SEFAZ e prefeitura ainda não habilitada.</div>
    <div className="filters"><label>Competência<input type="month" value={period} onChange={event => { setPage(1); setPeriod(event.target.value); }} /></label><label>Buscar<input placeholder="Número ou cliente" value={q} onChange={event => { setPage(1); setQ(event.target.value); }} /></label></div>
    {notice && <p role="status" className="linked-info">{notice}</p>}
    {error ? <div className="empty" role="alert">{error}</div> : loading ? <div className="empty" role="status">Consultando documentos fiscais…</div> : items.length ? <div className="table-wrap"><table><thead><tr><th>Documento</th><th>Emissão</th><th>Parte</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{item.documentType} {item.number}</strong><small>{item.integrationProvider === 'manual' ? 'Registro manual' : 'Adaptador externo'}</small></td><td>{item.issuedOn}</td><td>{item.clientName ?? item.supplier ?? 'Não informado'}</td><td className="amount">{money(item.grossAmountScaled)}</td><td><span className="badge">{item.status}</span></td></tr>)}</tbody></table></div> : <div className="empty"><h3>Nenhum documento fiscal registrado</h3><p>Registre entradas, saídas ou serviços manualmente.</p></div>}
    <footer className="table-footer"><span>{items.length} registros</span><div className="pagination"><button disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Anterior</button><button disabled={!more || loading} onClick={() => setPage(value => value + 1)}>Próxima</button></div></footer>
    {formOpen && <div className="overlay modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Registrar documento fiscal manual"><header><div><span className="eyebrow">DOCUMENTO FISCAL MANUAL</span><h2>Registrar documento</h2></div><button type="button" className="icon-button" aria-label="Fechar" onClick={() => { if (!saving) setFormOpen(false); }}>Fechar</button></header><p className="muted">O registro será persistido com auditoria. Nenhuma transmissão para SEFAZ ou prefeitura será realizada.</p><form onSubmit={submit}><div className="form-row"><label>Direção<select name="direction" defaultValue="service"><option value="inbound">Entrada</option><option value="outbound">Saída</option><option value="service">Serviço</option></select></label><label>Tipo<select name="documentType" defaultValue="service_invoice"><option value="invoice">Nota fiscal</option><option value="service_invoice">Nota de serviço</option><option value="receipt">Recibo</option><option value="other">Outro</option></select></label></div><div className="form-row"><label>Número<input name="number" required maxLength={40}/></label><label>Série<input name="series" maxLength={20}/></label></div><div className="form-row"><label>Emissão<input type="date" name="issuedOn" required defaultValue={new Date().toISOString().slice(0, 10)}/></label><label>Valor bruto (R$)<input name="grossAmount" required inputMode="decimal" placeholder="0,00"/></label></div><div className="form-row"><label>Cliente<input name="clientName" maxLength={200}/></label><label>Fornecedor<input name="supplier" maxLength={200}/></label></div><div className="form-row"><label>CFOP<input name="cfop" maxLength={20}/></label><label>Natureza<input name="nature" maxLength={160}/></label></div><div className="form-row"><label>Base de cálculo (R$)<input name="taxBase" inputMode="decimal" defaultValue="0"/></label><label>Retenções (R$)<input name="withheldAmount" inputMode="decimal" defaultValue="0"/></label></div><div className="form-row"><label>ISS (R$)<input name="issAmount" inputMode="decimal" defaultValue="0"/></label><label>ICMS (R$)<input name="icmsAmount" inputMode="decimal" defaultValue="0"/></label></div><div className="form-row"><label>IPI (R$)<input name="ipiAmount" inputMode="decimal" defaultValue="0"/></label><label>PIS (R$)<input name="pisAmount" inputMode="decimal" defaultValue="0"/></label><label>COFINS (R$)<input name="cofinsAmount" inputMode="decimal" defaultValue="0"/></label></div><label>Município<input name="municipality" maxLength={120}/></label><label>Observações<textarea name="notes" rows={3} maxLength={4000}/></label>{error && <p className="form-error" role="alert">{error}</p>}<footer><button type="button" className="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Registrando…' : 'Registrar documento'}</button></footer></form></section></div>}
  </section>;
}
