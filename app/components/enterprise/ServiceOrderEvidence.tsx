'use client';

import { useEffect, useId, useState } from 'react';
import { ChevronDownRegular } from '@fluentui/react-icons';
import { EnterpriseButton } from './EnterprisePrimitives';

type HistoryEvent = {
  id: string;
  command: string;
  label: string;
  created_at: string;
};
type VerifiedDetail = {
  relations: {
    measurements: number;
    invoices: number;
    receivables: number;
    clientId?: string | null;
    contractId?: string | null;
  };
  sublists: {
    history: {
      items: HistoryEvent[];
      pageInfo: { total: number; hasMore: boolean };
    };
  };
};
type DetailResponse = { order?: VerifiedDetail; error?: string };

function formatEventDate(value: string) {
  const when = new Date(value);
  return Number.isNaN(when.valueOf())
    ? 'Data não informada'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(when);
}

/**
 * Full Object Page evidence is fetched only when requested. The parent queue
 * is a list projection; it must not be treated as authoritative history.
 * This API checks owner_id server-side. Never derive a zero from HTTP failure.
 */
export function ServiceOrderEvidence({ orderId }: { orderId: string }) {
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [detail, setDetail] = useState<VerifiedDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setState('loading');
      setDetail(null);
      setError('');
      try {
        const response = await fetch('/api/orders/' + encodeURIComponent(orderId), {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = (await response.json()) as DetailResponse;
        if (!response.ok) throw new Error(data.error || 'Sem autorização para consultar o objeto.');
        const order = data.order;
        if (!order || !order.relations ||
            !order.sublists?.history || !Array.isArray(order.sublists.history.items)) {
          throw new Error('O servidor não retornou uma projeção de histórico verificável.');
        }
        if (!controller.signal.aborted) {
          setDetail(order);
          setState('ready');
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Consulta indisponível.');
          setState('error');
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [open, orderId, revision]);

  return (
    <section className="service-evidence" aria-label="Histórico e vínculos da ordem">
      <div className="service-evidence-action">
        <EnterpriseButton
          type="button"
          appearance="subtle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(value => !value)}
        >
          {open ? 'Recolher histórico e vínculos' : 'Consultar histórico e vínculos'}
          <ChevronDownRegular aria-hidden="true" />
        </EnterpriseButton>
        <span>Dados consultados sob autorização</span>
      </div>
      {open && (
        <div id={contentId} className="service-evidence-content">
          {state === 'loading' && (
            <p role="status" aria-live="polite">Consultando histórico autorizado da OS…</p>
          )}
          {state === 'error' && (
            <div role="alert" className="service-evidence-error">
              <p>{error}</p>
              <EnterpriseButton type="button" appearance="subtle" onClick={() => setRevision(v => v + 1)}>
                Tentar novamente
              </EnterpriseButton>
            </div>
          )}
          {state === 'ready' && detail && (
            <>
              <section aria-label="Vínculos confirmados" className="service-evidence-relations">
                <h4>Vínculos confirmados</h4>
                <dl>
                  <div><dt>Medições</dt><dd>{detail.relations.measurements}</dd></div>
                  <div><dt>Faturas</dt><dd>{detail.relations.invoices}</dd></div>
                  <div><dt>Recebíveis</dt><dd>{detail.relations.receivables}</dd></div>
                </dl>
              </section>
              <section aria-label="Linha do tempo autorizada" className="service-evidence-timeline">
                <h4>Linha do tempo da OS</h4>
                {detail.sublists.history.items.length > 0 ? (
                  <ol>
                    {detail.sublists.history.items.map(event => (
                      <li key={event.id}>
                        <strong>{event.label || event.command}</strong>
                        <time dateTime={event.created_at}>{formatEventDate(event.created_at)}</time>
                      </li>
                    ))}
                  </ol>
                ) : <p>Nenhum evento registrado para esta ordem.</p>}
                {detail.sublists.history.pageInfo.hasMore && (
                  <p>Exibindo os eventos mais recentes. Consulte o objeto completo para continuar o histórico.</p>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </section>
  );
}
