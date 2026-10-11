import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { accessRequest, closeAccessRequest, type AccessAsk } from '../../core/access-request';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { relative } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, Spinner } from '../../components/ui';

/** What the server says about the refusal (`GET /api/access/context`). */
interface AccessContext {
  app: { slug: string; name: string };
  email: string;
  roles: string[];
  company: string | null;
  pending: { reference: string; created_at: string } | null;
}

/**
 * "You don't have access to this" with a way forward (the web's Access denied screen; the server's
 * AccessRequestController): who they are signed in as, their role and company, and a request to their
 * administrators with an optional reason. A request already waiting is shown instead of sending another.
 */
export function AccessRequestDialog() {
  const ask = useStore(accessRequest, (s) => s.ask);
  if (!ask) return null;
  return <AccessRequestBody key={ask.slug} ask={ask} />;
}

function AccessRequestBody({ ask }: { ask: AccessAsk }) {
  const q = useQuery({
    queryKey: ['access', 'context', ask.slug],
    queryFn: ({ signal }) => apiGet<AccessContext>('/api/access/context', { app: ask.slug }, signal),
    staleTime: 0,
    retry: false,
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; again: boolean } | null>(null);
  const name = q.data?.app.name || ask.label;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ reference: string; again: boolean }>('/api/access/requests', { app: ask.slug, reason: reason.trim() || undefined, path: ask.path });
      setDone({ reference: r.reference, again: !!r.again });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pending = done ?? (q.data?.pending ? { reference: q.data.pending.reference, again: true } : null);
  return (
    <Modal
      title={`You don't have access to ${name}`}
      labelledBy="access-request"
      width={460}
      onClose={closeAccessRequest}
      footer={
        pending || q.error ? (
          <Button variant="primary" onClick={closeAccessRequest} autoFocus>
            OK
          </Button>
        ) : (
          <>
            <Button onClick={closeAccessRequest}>Cancel</Button>
            <Button variant="primary" icon="send" loading={busy} disabled={q.isLoading} onClick={() => void send()}>
              Ask for access
            </Button>
          </>
        )
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[10px] bg-subtle px-3.5 py-3 text-[12.5px]">
            <dt className="text-ink-3">Signed in as</dt>
            <dd className="font-semibold text-ink">{q.data?.email || '—'}</dd>
            {q.data?.roles.length ? (
              <>
                <dt className="text-ink-3">Role</dt>
                <dd className="font-semibold text-ink">{q.data.roles.join(', ')}</dd>
              </>
            ) : null}
            {q.data?.company ? (
              <>
                <dt className="text-ink-3">Company</dt>
                <dd className="font-semibold text-ink">{q.data.company}</dd>
              </>
            ) : null}
          </dl>
          {pending ? (
            <p role="status" className="flex items-start gap-2 rounded-[10px] bg-success-bg px-3.5 py-2.5 text-[13px] text-success">
              <Icon name="check-circle" size={16} className="mt-0.5 shrink-0" />
              <span>
                {done && !done.again ? 'Request sent to your administrators.' : 'Your request is already with your administrators.'} Reference <b>{pending.reference}</b>
                {!done && q.data?.pending ? ` · asked ${relative(q.data.pending.created_at)}` : ''}.
              </span>
            </p>
          ) : (
            <>
              <p className="text-[13px] text-ink-2">Your administrators decide who gets {name}. Ask them for it — they are notified and can give it to you from your profile.</p>
              <label className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-ink-2">Why you need it (optional)</span>
                <textarea className="min-h-[72px] rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
