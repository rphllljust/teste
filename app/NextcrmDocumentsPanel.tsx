'use client';

import { useEffect, useState } from 'react';
import { FileCheck2, RefreshCw } from 'lucide-react';

type DocumentLink = {
  id: string;
  kind: 'attachment' | 'contract' | 'photo' | 'service_report' | 'inspection' | 'invoice';
  version: number;
  sha256: string | null;
  linkedAt: string;
};
type ListResult = { items?: DocumentLink[]; hasMore?: boolean; error?: string };
type State = { loading: boolean; error: string; items: DocumentLink[]; hasMore: boolean };
const kinds: Record<DocumentLink['kind'], string> = {
  attachment: 'Anexo',
  contract: 'Contrato',
  photo: 'Fotografia',
  service_report: 'Relatório de serviço',
  inspection: 'Inspeção',
  invoice: 'Documento de cobrança',
};

export default function NextcrmDocumentsPanel({ serviceOrderId }: { serviceOrderId: string }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({
    loading: true, error: '', items: [], hasMore: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ loading: true, error: '', items: [], hasMore: false });
      try {
        const response = await fetch(
          '/api/orders/' + encodeURIComponent(serviceOrderId) + '/nextcrm-documents',
          { cache: 'no-store', credentials: 'same-origin', signal: controller.signal },
        );
        const data = await response.json() as ListResult;
        if (!response.ok || !Array.isArray(data.items)) {
          throw new Error(data.error || 'Não foi possível consultar os documentos vinculados.');
        }
        if (!controller.signal.aborted) {
          setState({
            loading: false, error: '', items: data.items,
            hasMore: data.hasMore === true,
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : 'Consulta indisponível.',
            items: [], hasMore: false,
          });
        }
      }
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [serviceOrderId, revision]);

  return (
    <section className="order-relation-context" aria-label="Documentos NextCRM da ordem">
      <header>
        <strong>Documentos NextCRM</strong>
        <button
          type="button" className="text-button"
          disabled={state.loading}
          onClick={() => setRevision(n => n + 1)}
        ><RefreshCw size={14} aria-hidden="true" /> Atualizar</button>
      </header>
      {state.loading ? <p role="status">Consultando vínculos autorizados…</p>
        : state.error ? <p role="alert" className="form-error">{state.error}</p>
        : state.items.length === 0
          ? <p className="muted">Nenhum documento NextCRM autorizado para esta ordem.</p>
          : <div aria-live="polite">
            {state.items.map(item => (
              <div className="event-row" key={item.id}>
                <span><FileCheck2 size={15} aria-hidden="true" /> {kinds[item.kind] || 'Documento'} · versão {item.version}</span>
                <small>Vinculado em {new Intl.DateTimeFormat('pt-BR', {
                  dateStyle: 'short', timeStyle: 'short',
                }).format(new Date(item.linkedAt))}
                {item.sha256 ? ' · SHA-256 ' + item.sha256.slice(0, 12) + '…' : ''}</small>
              </div>
            ))}
            {state.hasMore && <p className="muted">Exibindo os 50 vínculos mais recentes.</p>}
          </div>}
      <p className="muted">Somente metadados autorizados. Os arquivos permanecem protegidos no NextCRM; o download integrado depende de validação adicional.</p>
    </section>
  );
}
