import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../../../core/bridge';
import { toast } from '../../../../core/toasts';
import { Button, Modal } from '../../../../components/ui';
import { SK, socialApi, useInvalidate, type Account } from '../../api';
import { networkInfo } from '../../lib/networks';

/**
 * A01 helpers · the browser hand-off of WF-01 / WF-02 (SMM-ACC-001, ACC-003): WorkSuite asks the server for the
 * network's consent page, opens it in the person's own browser, and waits for them to say they are done. The
 * desktop never sees the password or the token (NFR-04); the server finishes the exchange on its callback.
 */

/** Opens a URL in the browser; says so when the desktop cannot. */
export async function openInBrowser(url: string): Promise<void> {
  try {
    await call('app:openExternal', { url });
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/** The link again, for when the browser did not come up. */
export function FallbackLink({ url }: { url: string }) {
  return (
    <p className="mt-3 text-[12px] text-ink-3">
      If your browser did not open, go to <span className="font-mono break-all text-ink-2 select-all">{url}</span>
    </p>
  );
}

type Reconnectable = Pick<Account, 'id' | 'display_name' | 'network'> & { held_posts?: number };

/**
 * Reconnect / renew access (WF-02). `onFinished` runs after the person says they finished in the browser — the
 * Publishing log retries the failed target there ("Reconnect & retry").
 */
export function useReconnect(onFinished?: (account: Reconnectable) => void, finishLabel = 'I’ve finished') {
  const invalidate = useInvalidate();
  const [waiting, setWaiting] = useState<{ account: Reconnectable; url: string } | null>(null);
  const m = useMutation({
    mutationFn: (a: Reconnectable) => socialApi.reconnect(a.id),
    onSuccess: async (r, a) => {
      setWaiting({ account: a, url: r.redirect_url });
      await openInBrowser(r.redirect_url);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const finish = () => {
    if (!waiting) return;
    invalidate(SK.accounts, SK.status);
    onFinished?.(waiting.account);
    setWaiting(null);
  };
  const net = waiting ? networkInfo(waiting.account.network).label : '';
  const modal = waiting ? (
    <Modal
      title="Finish in your browser"
      onClose={() => setWaiting(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setWaiting(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={finish}>
            {finishLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink">
        Sign in to {net} in your browser as an admin of <strong>{waiting.account.display_name}</strong> and allow what WorkSuite asks for. When you come back, held posts resume afterwards
        {waiting.account.held_posts ? ` (${waiting.account.held_posts} on hold now)` : ''}.
      </p>
      <FallbackLink url={waiting.url} />
    </Modal>
  ) : null;
  return { start: (a: Reconnectable) => m.mutate(a), pendingId: m.isPending ? (m.variables?.id ?? null) : null, modal };
}
