import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Avatar, Button, Modal, Spinner, cx } from '../../../components/ui';
import { PLATFORM_ICON, PLATFORM_LABEL, pollMetaConnect, selectMetaConnect, startMetaConnect, type MetaAccount, type MetaPlatform } from './meta';

/**
 * Connecting a Facebook Page (Messenger) or an Instagram professional account (worksuite-desktop#36), in three steps:
 * what will happen; signing in to Facebook in the browser and allowing access, while this waits; then choosing which
 * Pages or Instagram accounts to connect from the ones Facebook allowed. Reconnecting an account is the same walk,
 * with that account chosen already. The server checks each step again; nothing secret ever reaches this app.
 */
export function MetaConnect({ platform, reconnect, onClose, onConnected }: {
  platform: MetaPlatform;
  /** Reconnecting this account rather than connecting a new one. */
  reconnect?: MetaAccount | null;
  onClose: () => void;
  onConnected: (accounts: MetaAccount[]) => void;
}) {
  const qc = useQueryClient();
  const label = PLATFORM_LABEL[platform];
  const [session, setSession] = useState<{ state: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);

  const poll = useQuery({
    queryKey: ['meta', 'connect', session?.state],
    queryFn: () => pollMetaConnect(session!.state),
    enabled: !!session,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' ? false : 2_000),
    gcTime: 0,
  });
  const state = poll.data;
  const candidates = state?.status === 'ready' ? state.candidates : [];
  // Chosen to begin with: what can be connected and is not yet — or, reconnecting, that account.
  const picked = chosen ?? new Set(candidates.filter((c) => c.usable && (reconnect ? c.account_id === reconnect.id : !c.connected)).map((c) => c.id));

  const openSignIn = (url: string) => void call('app:openExternal', { url }).catch((e: unknown) => setProblem(errorMessage(e)));

  const begin = async () => {
    setBusy(true);
    setProblem(null);
    setChosen(null);
    try {
      const r = await startMetaConnect(platform, reconnect?.id);
      setSession({ state: r.state, url: r.url });
      openSignIn(r.url);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!session || !picked.size) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await selectMetaConnect(session.state, [...picked]);
      void qc.invalidateQueries({ queryKey: ['meta'] });
      onConnected(r.accounts);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const title = reconnect ? text('Reconnect {name}', { name: reconnect.name }) : platform === 'messenger' ? text('Connect a Facebook Page') : text('Connect an Instagram account');
  const failed = state && (state.status === 'failed' || state.status === 'expired' || state.status === 'used');

  let content;
  let footer;
  if (!session || failed) {
    content = (
      <div className="flex flex-col gap-3 text-[12.5px] text-ink-2">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-ink-2"><Icon name={PLATFORM_ICON[platform]} size={19} /></span>
          <p className="min-w-0 flex-1">
            {platform === 'messenger'
              ? text('Answer the messages people send your Facebook Page, from Chat.')
              : text('Answer the direct messages people send your Instagram professional account, from Chat. It must be linked to a Facebook Page.')}
          </p>
        </div>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>{text('Your browser opens Facebook. Sign in as someone who manages the Page, and allow everything WorkSuite asks for.')}</li>
          <li>{text('Come back here and choose which to connect.')}</li>
        </ol>
        <p className="text-ink-3">{text('People write first on {platform}: a business can reply within 24 hours of their last message.', { platform: label })}</p>
        {failed ? <p role="alert" className="rounded-[8px] bg-danger-bg p-2.5 text-danger">{state?.error ?? text('The sign-in did not finish. Try again.')}</p> : null}
        {problem ? <p role="alert" className="rounded-[8px] bg-danger-bg p-2.5 text-danger">{problem}</p> : null}
      </div>
    );
    footer = (
      <>
        <Button onClick={onClose}>{text('Cancel')}</Button>
        <Button variant="primary" icon="external" loading={busy} onClick={() => void begin()}>{failed ? text('Try again') : text('Continue with Facebook')}</Button>
      </>
    );
  } else if (!state || state.status === 'pending') {
    content = (
      <div className="flex flex-col items-center gap-3 py-4 text-center text-[12.5px] text-ink-2">
        <Spinner />
        <p>{text('Finish signing in to Facebook in your browser. This continues by itself when you have.')}</p>
        <button type="button" className="font-semibold text-primary underline" onClick={() => openSignIn(session.url)}>{text('Open the sign-in again')}</button>
        {problem ? <p role="alert" className="rounded-[8px] bg-danger-bg p-2.5 text-danger">{problem}</p> : null}
      </div>
    );
    footer = <Button onClick={onClose}>{text('Cancel')}</Button>;
  } else {
    content = (
      <div className="flex flex-col gap-2.5 text-[12.5px]">
        {candidates.length ? (
          <>
            <p className="text-ink-2">{platform === 'messenger' ? text('Choose the Pages to answer from Chat.') : text('Choose the Instagram accounts to answer from Chat.')}</p>
            <ul aria-label={text('Accounts you can connect')} className="flex flex-col gap-1.5">
              {candidates.map((c) => {
                const on = picked.has(c.id);
                return (
                  <li key={c.id}>
                    <label className={cx('flex items-center gap-3 rounded-[10px] border border-line p-2.5', c.usable ? 'cursor-pointer hover:bg-subtle' : 'opacity-70')}>
                      <Checkbox
                        checked={on}
                        disabled={!c.usable}
                        onChange={() => {
                          const next = new Set(picked);
                          if (on) next.delete(c.id);
                          else next.add(c.id);
                          setChosen(next);
                        }}
                      />
                      <Avatar name={c.name} size={30} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[13px] text-ink">{platform === 'instagram' && c.username ? `@${c.username}` : c.name}</b>
                        <span className="block truncate text-ink-3">
                          {c.note ?? (platform === 'instagram' ? text('Linked to {page}', { page: c.page_name }) : c.connected ? text('Already connected') : text('Facebook Page'))}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="rounded-[10px] border border-dashed border-line p-3 text-ink-3">
            {platform === 'messenger'
              ? text('Facebook did not give access to any Page. Sign in as someone who manages the Page, and choose it when Facebook asks.')
              : text('None of the Pages Facebook gave access to has an Instagram professional account linked. Link one in the Page’s settings, then try again.')}
          </p>
        )}
        {problem ? <p role="alert" className="rounded-[8px] bg-danger-bg p-2.5 text-danger">{problem}</p> : null}
      </div>
    );
    footer = (
      <>
        <Button onClick={onClose}>{text('Cancel')}</Button>
        <Button variant="primary" disabled={!picked.size} loading={busy} onClick={() => void connect()}>{picked.size > 1 ? text('Connect {n}', { n: picked.size }) : text('Connect')}</Button>
      </>
    );
  }

  return (
    <Modal title={title} onClose={onClose} width={480} footer={footer}>
      {content}
    </Modal>
  );
}
