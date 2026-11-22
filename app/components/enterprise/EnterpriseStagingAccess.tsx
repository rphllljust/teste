'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Field, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { LockClosedRegular, LockOpenRegular } from '@fluentui/react-icons';
import { EnterpriseButton, EnterpriseInput } from './EnterprisePrimitives';

type AccessState = 'checking' | 'hidden' | 'signed-out' | 'signed-in';

/**
 * Authentication UI only. The staging API owns all credential validation,
 * session issuance and authorization; this component never stores a passphrase.
 * Production returns 404 for the probe and does not render this control.
 */
export function EnterpriseStagingAccess() {
  const [state, setState] = useState<AccessState>('checking');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    // Cancel effect replay before sending a duplicate public session probe.
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch('/api/auth/staging-login', {
            credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          });
          if (cancelled) return;
          if (!response.ok) { setState('hidden'); return; }
          const data: unknown = await response.json();
          if (cancelled) return;
          if (!data || typeof data !== 'object' || !('authenticated' in data) ||
              typeof data.authenticated !== 'boolean') {
            setState('hidden');
            return;
          }
          setState(data.authenticated ? 'signed-in' : 'signed-out');
        } catch {
          if (!cancelled) setState('hidden');
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || passphrase.length < 24 || passphrase.length > 160) return;
    const submitted = passphrase;
    setPassphrase(''); // Never keep the credential in React state after submission.
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/staging-login', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: submitted }),
      });
      if (!response.ok) {
        setError(response.status === 401 || response.status === 400
          ? 'Credencial não autorizada. Confira a frase de acesso.'
          : 'Não foi possível iniciar uma sessão autorizada de homologação.');
        return;
      }
      // The HTTP success alone does not prove the browser has a valid cookie.
      const confirmation = await fetch('/api/auth/staging-login', {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (!confirmation.ok) throw new Error('Session not confirmed');
      const session: unknown = await confirmation.json();
      if (!session || typeof session !== 'object' || !('authenticated' in session) ||
          session.authenticated !== true) throw new Error('Session not confirmed');
      window.location.reload(); // Re-query owner-scoped APIs without inventing data.
    } catch {
      setError('A sessão não pôde ser confirmada. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/staging-login', {
        method: 'DELETE', credentials: 'same-origin', cache: 'no-store',
      });
      if (!response.ok) throw new Error('Sign-out rejected');
      const confirmation = await fetch('/api/auth/staging-login', {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (!confirmation.ok) throw new Error('Sign-out not confirmed');
      const session: unknown = await confirmation.json();
      if (!session || typeof session !== 'object' || !('authenticated' in session) ||
          session.authenticated !== false) throw new Error('Sign-out not confirmed');
      window.location.reload();
    } catch {
      setError('Não foi possível encerrar a sessão. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'checking' || state === 'hidden') return null;
  return <section className="cisne-staging-access" aria-label="Autenticação de homologação">
    <div className="cisne-staging-access-copy">
      <span className="cisne-staging-access-kicker">
        {state === 'signed-in'
          ? <LockOpenRegular aria-hidden="true" fontSize={16} />
          : <LockClosedRegular aria-hidden="true" fontSize={16} />}
        HOMOLOGAÇÃO / ACESSO PROTEGIDO
      </span>
      <strong>{state === 'signed-in' ? 'Sessão empresarial autenticada' : 'Entre para consultar registros autorizados'}</strong>
      <p>{state === 'signed-in'
        ? 'As operações continuam limitadas às permissões efetivas do servidor.'
        : 'A navegação está disponível; indicadores e registros exigem uma sessão autorizada. Ausência de acesso não significa fila vazia.'}</p>
    </div>
    {state === 'signed-in' ? (
      <EnterpriseButton type="button" appearance="secondary" disabled={busy} onClick={() => void signOut()}>
        {busy ? 'Encerrando sessão…' : 'Encerrar sessão de homologação'}
      </EnterpriseButton>
    ) : (
      <form className="cisne-staging-access-form" autoComplete="off" onSubmit={(event) => void signIn(event)}>
        <Field label="Frase de acesso da homologação">
          <EnterpriseInput type="password" name="cisne-staging-passphrase"
            aria-label="Frase de acesso da homologação" autoComplete="off"
            required minLength={24} maxLength={160} value={passphrase}
            disabled={busy} onChange={event => setPassphrase(event.currentTarget.value)} />
        </Field>
        <EnterpriseButton type="submit" appearance="primary"
          disabled={busy || passphrase.length < 24 || passphrase.length > 160}>
          {busy ? 'Verificando acesso…' : 'Entrar na homologação'}
        </EnterpriseButton>
      </form>
    )}
    {error && <MessageBar intent="error" className="cisne-staging-access-error">
      <MessageBarBody><span role="alert">{error}</span></MessageBarBody>
    </MessageBar>}
  </section>;
}
