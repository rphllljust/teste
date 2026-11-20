'use client';
import { useCallback, useEffect, useState } from 'react';

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

  return <section className="worklist" aria-busy={loading}>
    <div className="list-title"><div><h2>Fiscal manual</h2><p>Documentos fiscais internos, tributos e períodos com origem auditável.</p></div><button className="primary" onClick={() => setNotice('O cadastro manual será habilitado após a publicação da migration 0014 no staging.')}>Registrar documento</button></div>
    <div className="linked-info">Documento fiscal registrado manualmente. Integração automática com SEFAZ e prefeitura ainda não habilitada.</div>
    <div className="filters"><label>Competência<input type="month" value={period} onChange={event => { setPage(1); setPeriod(event.target.value); }} /></label><label>Buscar<input placeholder="Número ou cliente" value={q} onChange={event => { setPage(1); setQ(event.target.value); }} /></label></div>
    {notice && <p role="status" className="linked-info">{notice}</p>}
    {error ? <div className="empty" role="alert">{error}</div> : loading ? <div className="empty" role="status">Consultando documentos fiscais…</div> : items.length ? <div className="table-wrap"><table><thead><tr><th>Documento</th><th>Emissão</th><th>Parte</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{item.documentType} {item.number}</strong><small>{item.integrationProvider === 'manual' ? 'Registro manual' : 'Adaptador externo'}</small></td><td>{item.issuedOn}</td><td>{item.clientName ?? item.supplier ?? 'Não informado'}</td><td className="amount">{money(item.grossAmountScaled)}</td><td><span className="badge">{item.status}</span></td></tr>)}</tbody></table></div> : <div className="empty"><h3>Nenhum documento fiscal registrado</h3><p>Registre entradas, saídas ou serviços manualmente.</p></div>}
    <footer className="table-footer"><span>{items.length} registros</span><div className="pagination"><button disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Anterior</button><button disabled={!more || loading} onClick={() => setPage(value => value + 1)}>Próxima</button></div></footer>
  </section>;
}
