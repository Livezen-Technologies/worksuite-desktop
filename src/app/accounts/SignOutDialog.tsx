import { useEffect, useId, useRef, useState } from 'react';
import type { AccountView, UnsyncedItem, UnsyncedSummary } from '@shared/accounts';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Button, cx } from '../../components/ui';
import { accountName, changes } from './labels';

export interface SignOutDialogProps {
  account: AccountView;
  onClose: () => void;
}

/** How many changes the list holds: an item may stand for several ("2 queued messages"). */
export function unsyncedCount(items: UnsyncedItem[]): number {
  return items.reduce((n, i) => n + Math.max(1, i.count ?? 1), 0);
}

const MODULE_TAG: Record<string, string> = { office: 'DOC', docs: 'DOC', projects: 'Projects', desk: 'Desk' };
function tagOf(item: UnsyncedItem): string {
  const m = item.module?.trim();
  if (!m) return MODULE_TAG[item.source] ?? item.source;
  return MODULE_TAG[m.toLowerCase()] ?? m.charAt(0).toUpperCase() + m.slice(1);
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/**
 * Screen 14 — signing out of one account. What has not reached the server yet is listed first (offline queue, Office
 * copies, queued uploads, outboxes) with Sync Now and Export unsynced…, and is kept, never discarded silently. Then the
 * choices: remove the account's cached data from this computer, keep offline files. Signing out never deletes data on
 * the server, and the other accounts stay signed in. Removing the account from this computer and deleting the
 * WorkSuite account are different actions, in different places — the footer says where.
 */
export function SignOutDialog({ account, onClose }: SignOutDialogProps) {
  const titleId = useId();
  const listTitleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<UnsyncedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [removeCached, setRemoveCached] = useState(true);
  const [keepOffline, setKeepOffline] = useState(false);
  const [busy, setBusy] = useState<'sync' | 'export' | 'signout' | 'discard' | null>(null);
  // Discard this change: the item waiting for "Discard" to be confirmed.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = accountName(account);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    let live = true;
    call('accounts:unsynced', { accountId: account.id })
      .then((s) => live && setSummary(s))
      // A desktop that cannot list them still keeps them: the dialog goes on without the list.
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [account.id]);

  // The first action once the list is known: Sync Now with changes waiting, Sign out without.
  useEffect(() => {
    if (!loading) dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [loading]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (prev?.isConnected) prev.focus?.();
    };
  }, []);

  const items = summary?.items ?? [];
  const count = unsyncedCount(items);
  const syncNow = async () => {
    setBusy('sync');
    setError(null);
    try {
      const next = await call('accounts:syncNow', { accountId: account.id });
      setSummary(next);
      if (next.items.length === 0) toast('success', 'Everything is on the server now.');
      else {
        const left = unsyncedCount(next.items);
        setError(`${left} ${left === 1 ? 'change' : 'changes'} could not sync. The reason is under each one; you can export or discard it.`);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const exportUnsynced = async () => {
    setBusy('export');
    setError(null);
    try {
      const { path } = await call('accounts:exportUnsynced', { accountId: account.id });
      if (path) toast('success', `Unsynced changes saved to ${path}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const signOut = async () => {
    setBusy('signout');
    setError(null);
    try {
      const next = await call('accounts:signOut', { accountId: account.id, removeCachedData: removeCached, keepOfflineFiles: keepOffline, discardUnsynced: false });
      app.set({ accounts: next });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };
  const discard = async (itemId: string) => {
    setBusy('discard');
    setError(null);
    try {
      const next = await call('accounts:discardUnsynced', { accountId: account.id, itemId });
      setSummary(next);
      setConfirming(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const goRemove = () => {
    onClose();
    navigate('/settings/accounts');
  };

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-scrim p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={count > 0 ? listTitleId : titleId} className="flex max-h-full flex-wrap items-start justify-center gap-6 outline-none">
        {count > 0 ? (
          <section aria-labelledby={listTitleId} className="flex w-[520px] max-w-full flex-col gap-3 rounded-[18px] border border-line bg-surface p-[30px] shadow-2xl">
            <h2 id={listTitleId} className="m-0 text-[22px] font-extrabold text-ink">
              You have {count} unsynced {count === 1 ? 'change' : 'changes'}
            </h2>
            <p className="m-0 text-[14px] text-ink-3">
              Signing out of <b className="text-ink">{name}</b> may discard these local changes. Sync them first, or review and export what you need.
            </p>
            <ul className="m-0 max-h-[230px] list-none overflow-y-auto p-0 scroll-thin" aria-label="Unsynced changes">
              {items.map((i) => (
                <li key={i.id} className="flex flex-col gap-1 border-b border-line py-2.5 text-[13.5px] text-ink last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 rounded-[6px] bg-selection px-2 py-0.5 text-[11.5px] font-bold text-primary">{tagOf(i)}</span>
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    <span className="shrink-0 text-ink-3">{timeOf(i.at)}</span>
                    {i.discardable && confirming !== i.id ? (
                      <button type="button" className="shrink-0 text-[12.5px] font-semibold text-danger hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => setConfirming(i.id)} aria-label={`Discard this change: ${i.label}`}>
                        Discard
                      </button>
                    ) : null}
                  </div>
                  {i.error ? <p className="m-0 pl-1 text-[12.5px] text-danger">{i.error}</p> : null}
                  {confirming === i.id ? (
                    <div role="alertdialog" aria-label="Discard this change?" className="flex flex-wrap items-center gap-2 rounded-[8px] bg-subtle p-2 text-[12.5px] text-ink-2">
                      <span className="min-w-0 flex-1">
                        Discard this change? It will not be sent to the server.{i.source === 'office' || i.source === 'upload' ? ' The file stays on this computer.' : ''}
                      </span>
                      <Button size="sm" variant="danger" loading={busy === 'discard'} onClick={() => void discard(i.id)}>
                        Discard this change
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === 'discard'} onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex flex-wrap gap-2.5">
              <Button data-autofocus variant="primary" size="lg" className="h-11 flex-1 rounded-[10px]" loading={busy === 'sync'} disabled={busy !== null && busy !== 'sync'} onClick={() => void syncNow()}>
                Sync Now
              </Button>
              <Button size="lg" className="h-11 rounded-[10px]" loading={busy === 'export'} disabled={busy !== null && busy !== 'export'} onClick={() => void exportUnsynced()}>
                Export unsynced…
              </Button>
              <Button variant="ghost" size="lg" className="h-11 rounded-[10px]" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </section>
        ) : null}
        <section aria-labelledby={titleId} className="flex w-[400px] max-w-full flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-7 shadow-2xl">
          <h2 id={titleId} className="m-0 text-[18px] font-extrabold text-ink">
            Sign out of {name}
          </h2>
          {loading ? <p className="m-0 text-[13px] text-ink-3" role="status">Checking for changes not on the server yet…</p> : null}
          <label className="flex cursor-pointer items-start gap-2.5 text-[14px] text-ink">
            <Checkbox checked={removeCached} onChange={(e) => setRemoveCached(e.target.checked)} className="mt-0.5" />
            Remove cached account data from this device
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-[14px] text-ink">
            <Checkbox checked={keepOffline} onChange={(e) => setKeepOffline(e.target.checked)} className="mt-0.5" />
            Keep offline files
          </label>
          <div className="rounded-[10px] bg-subtle p-3 text-[12.5px] leading-normal text-ink-3">
            Your data on the server is never deleted by signing out. Your other accounts stay signed in.
            {count > 0 ? ` The ${changes(count)} not on the server yet stay on this computer and sync when you sign in again.` : ''}
          </div>
          {error ? (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2.5">
            {count > 0 ? null : (
              <Button variant="ghost" size="lg" className="h-11 rounded-[10px]" onClick={onClose}>
                Cancel
              </Button>
            )}
            {/* A primary Button: the default (secondary) variant's own background could win over a bg-navy override and leave the label unreadable. */}
            <Button
              data-autofocus={count > 0 ? undefined : true}
              variant="primary"
              size="lg"
              loading={busy === 'signout'}
              disabled={loading || (busy !== null && busy !== 'signout')}
              className={cx('h-11 rounded-[10px] px-5', count > 0 && 'flex-1')}
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
          <hr className="m-0 h-px border-0 bg-line" />
          <div className="text-[13px] text-ink-3">Different actions, different places:</div>
          <div className="text-[13px] text-ink">
            <button type="button" className="font-bold text-ink hover:underline" onClick={goRemove}>
              Remove from this device
            </button>{' '}
            — Settings › Accounts &amp; Servers
          </div>
          {account.kind === 'personal' ? (
            <div className="text-[13px] text-danger">
              <button type="button" className="font-bold text-danger hover:underline" onClick={() => void call('cloud:openWeb', { page: 'privacy' }).catch((e) => toast('error', errorMessage(e)))}>
                Delete WorkSuite account
              </button>{' '}
              — Account › Privacy (cloud, after 30-day grace)
            </div>
          ) : (
            <div className="text-[13px] text-ink-3">
              <b className="text-ink">Delete WorkSuite account</b> — your organization manages {name} accounts.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
