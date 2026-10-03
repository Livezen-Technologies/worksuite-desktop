import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { SyncPreview, SyncProvider } from '@shared/contact-sync';
import { apiDelete, apiGet, apiPost, apiPut } from '../../../core/api';
import { call, errorMessage, hasDesktop, isMac } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { relative } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Chip, ErrorNote, Modal, Spinner, TextField, cx } from '../../../components/ui';
import { TYPES, type ContactType } from '../api';
import { previewLine, providerLabel, statusLine, type SyncAccount, type SyncLogRow, type SyncProviders, type SyncSettings } from './api';
import { SourceIcon } from './SourceIcon';

export const ACCOUNTS_KEY = ['contacts', 'sync', 'accounts'] as const;

export function useSyncAccounts(poll = false) {
  return useQuery({ queryKey: ACCOUNTS_KEY, queryFn: ({ signal }) => apiGet<SyncAccount[]>('/api/contacts/sync/accounts', undefined, signal), refetchInterval: poll ? 4000 : 60_000 });
}

function useDeviceStatus() {
  return useQuery({ queryKey: ['contacts', 'sync', 'device'], queryFn: () => call('contactSync:status'), enabled: hasDesktop(), staleTime: 30_000 });
}

/** Sync now: WorkSuite runs Google and Outlook; this computer runs iCloud, CardDAV and Mac Contacts. */
export async function syncNow(a: Pick<SyncAccount, 'id' | 'mode'>): Promise<void> {
  if (a.mode === 'server') await apiPost(`/api/contacts/sync/accounts/${a.id}/sync`);
  else await call('contactSync:run', { accountId: a.id });
}

/**
 * Settings › Contacts › Accounts & sync: each connected address book with its provider, address, status, when it
 * last synced, how many contacts and any error; Sync now, its settings, its log, and Disconnect.
 */
export function AccountsSettings() {
  const qc = useQueryClient();
  const { go } = useTab();
  const [adding, setAdding] = useState(false);
  // While the browser sign-in is open: the accounts there were before it, so the new one is recognised.
  const [waiting, setWaiting] = useState<Set<number> | null>(null);
  const [previewing, setPreviewing] = useState<SyncAccount | null>(null);
  const accounts = useSyncAccounts(!!waiting);
  const device = useDeviceStatus();
  const list = accounts.data ?? [];
  const conflicts = list.reduce((n, a) => n + a.open_conflicts, 0);
  // A new account from the browser sign-in: offer its preview.
  const arrived = waiting ? list.find((a) => a.mode === 'server' && a.status === 'new' && !waiting.has(a.id)) : undefined;
  const preview = previewing ?? arrived ?? null;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['contacts'] });

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-[22px] font-bold text-ink">Accounts &amp; sync</h2>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
          Add account
        </Button>
      </div>
      <p className="mb-5 text-[13.5px] text-ink-3">Contacts from Google, Outlook and iCloud stay in step with WorkSuite both ways. Somebody in two places is one contact here, linked to each.</p>
      {conflicts ? (
        <button type="button" onClick={() => go('/contacts?view=tidy&tab=conflicts')} className="mb-4 flex w-full items-center gap-2 rounded-[10px] bg-warning-bg px-3 py-2 text-left text-[13px] text-warning">
          <Icon name="warning" size={15} /> {conflicts === 1 ? '1 field changed in both places' : `${conflicts} fields changed in both places`} — review the sync conflicts
          <Icon name="chevron-right" size={14} className="ml-auto" />
        </button>
      ) : null}
      {accounts.isLoading ? <Spinner /> : null}
      {accounts.error ? <ErrorNote error={accounts.error} onRetry={() => void accounts.refetch()} /> : null}
      {accounts.isSuccess && !list.length ? (
        <div className="rounded-[12px] border border-dashed border-line px-5 py-8 text-center text-[13px] text-ink-3">No accounts yet. Add Google, Outlook or iCloud to bring their contacts in.</div>
      ) : null}
      {list.length ? (
        <ul role="list" aria-label="Connected accounts" className="flex flex-col gap-2.5">
          {list.map((a) => (
            <AccountRow key={a.id} a={a} hereSecret={a.mode === 'server' || a.provider === 'macos' || !!device.data?.accounts.find((x) => x.accountId === a.id)?.hasSecret} onPreview={() => setPreviewing(a)} onChanged={refresh} />
          ))}
        </ul>
      ) : null}
      {device.data && !device.data.persistent ? <p className="mt-3 text-[12px] text-warning">This computer has no secure keystore, so iCloud and CardDAV passwords are kept only until WorkSuite quits.</p> : null}
      {adding ? (
        <ConnectDialog
          onClose={() => setAdding(false)}
          onBrowser={() => {
            setAdding(false);
            setWaiting(new Set(list.map((a) => a.id)));
          }}
          onConnected={async (id) => {
            setAdding(false);
            const fresh = (await accounts.refetch()).data?.find((x) => x.id === id);
            if (fresh) setPreviewing(fresh);
          }}
        />
      ) : null}
      {waiting && !arrived ? <p className="mt-3 text-[12.5px] text-ink-3">Finish signing in in your browser. The account appears here when you are done.</p> : null}
      {preview ? <PreviewDialog a={preview} onClose={() => (setPreviewing(null), setWaiting(null), refresh())} /> : null}
    </div>
  );
}

function AccountRow({ a, hereSecret, onPreview, onChanged }: { a: SyncAccount; hereSecret: boolean; onPreview: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'settings' | 'log' | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const s = statusLine(a);
  const sync = async () => {
    if (a.status === 'new') return onPreview();
    setBusy(true);
    try {
      await syncNow(a);
      toast('success', `${a.provider_label} is up to date`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const elsewhere = a.mode === 'device' && !hereSecret;
  return (
    <li className="rounded-[12px] border border-line bg-surface">
      <div className="flex items-center gap-3 px-4 py-3">
        <SourceIcon provider={a.provider} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <b className="truncate text-[14px] text-ink">{a.email ?? a.label ?? a.provider_label}</b>
            <Chip tone={s.tone}>{a.status === 'syncing' || busy ? 'Syncing…' : s.tone === 'danger' ? 'Error' : s.text}</Chip>
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">
            {a.provider_label}
            {a.mode === 'device' ? ' · synced by this computer' : ''} · {a.contact_count.toLocaleString()} contact{a.contact_count === 1 ? '' : 's'}
            {a.last_synced_at ? ` · last synced ${relative(a.last_synced_at)}` : ' · not synced yet'}
          </div>
          {a.status === 'error' && a.error ? <div className="mt-1 text-[12.5px] text-danger">{a.error}</div> : null}
          {a.status === 'backoff' ? <div className="mt-1 text-[12.5px] text-warning">{s.text}</div> : null}
          {elsewhere ? <div className="mt-1 text-[12.5px] text-ink-3">Connected on another computer, which keeps its password. Sync it from there, or connect it here again.</div> : null}
        </div>
        <Button size="sm" disabled={busy || elsewhere} onClick={() => void sync()} aria-label={`Sync ${a.provider_label} now`}>
          <Icon name="refresh" size={14} className={cx(busy || a.status === 'syncing' ? 'motion-safe:animate-spin' : '')} /> {a.status === 'new' ? 'Start' : 'Sync now'}
        </Button>
        <Button size="sm" variant="ghost" aria-expanded={open === 'settings'} onClick={() => setOpen(open === 'settings' ? null : 'settings')}>
          Settings
        </Button>
        <Button size="sm" variant="ghost" aria-expanded={open === 'log'} onClick={() => setOpen(open === 'log' ? null : 'log')}>
          Log
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDisconnecting(true)}>
          Disconnect
        </Button>
      </div>
      {open === 'settings' ? <AccountSettings a={a} onSaved={onChanged} /> : null}
      {open === 'log' ? <AccountLog a={a} /> : null}
      {disconnecting ? <DisconnectDialog a={a} onClose={() => setDisconnecting(false)} onDone={onChanged} /> : null}
    </li>
  );
}

const TYPE_OPTIONS = TYPES.map((t) => ({ value: t.id, label: t.id === 'personal' ? 'Contact (no type)' : t.label }));

function AccountSettings({ a, onSaved }: { a: SyncAccount; onSaved: () => void }) {
  const [s, setS] = useState<SyncSettings>(a.settings);
  const [busy, setBusy] = useState(false);
  const label = providerLabel(a.provider);
  const save = async () => {
    setBusy(true);
    try {
      await apiPut(`/api/contacts/sync/accounts/${a.id}`, s);
      toast('success', 'Saved');
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const row = (title: string, hint: string, control: React.ReactNode) => (
    <div className="flex items-center gap-4 border-t border-line/70 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ink">{title}</div>
        <div className="text-[12px] text-ink-3">{hint}</div>
      </div>
      <div className="w-[260px] shrink-0">{control}</div>
    </div>
  );
  return (
    <div className="border-t border-line px-4 pb-3">
      {row('New contacts are filed as', `What a contact that arrives from ${label} becomes in WorkSuite. Its type, CRM links and IDs are never changed by a sync.`, <Select aria-label="Type for new contacts" value={s.default_type} onValueChange={(v) => setS({ ...s, default_type: v as ContactType })} options={TYPE_OPTIONS} />)}
      {row('Changed in both places', 'The most recent change wins. You can also keep a list to review.', (
        <Select
          aria-label="Conflicts"
          value={s.conflicts}
          onValueChange={(v) => setS({ ...s, conflicts: v })}
          options={[
            { value: 'recent', label: 'Most recent wins' },
            { value: 'review', label: 'Most recent wins, list them to review' },
          ]}
        />
      ))}
      {row(`Deleted in WorkSuite`, `Whether to delete it in ${label} too.`, (
        <Select
          aria-label="Deleted in WorkSuite"
          value={s.on_local_delete}
          onValueChange={(v) => setS({ ...s, on_local_delete: v })}
          options={[
            { value: 'ask', label: 'Ask each time' },
            { value: 'always', label: `Delete in ${label} too` },
            { value: 'never', label: `Keep it in ${label}` },
          ]}
        />
      ))}
      {row(`Send to ${label}`, `Which WorkSuite contacts ${label} gets.`, (
        <Select
          aria-label={`Send to ${label}`}
          value={s.export}
          onValueChange={(v) => setS({ ...s, export: v })}
          options={[
            { value: 'all', label: 'All my contacts' },
            { value: 'linked', label: `Only those also in ${label}` },
          ]}
        />
      ))}
      {a.mode === 'server'
        ? row('Sync every', 'How often WorkSuite checks for changes.', (
            <Select
              aria-label="Sync every"
              value={String(s.interval)}
              onValueChange={(v) => setS({ ...s, interval: Number(v) })}
              options={['5', '15', '30', '60', '240'].map((m) => ({ value: m, label: Number(m) < 60 ? `${m} minutes` : `${Number(m) / 60} hour${m === '60' ? '' : 's'}` }))}
            />
          ))
        : null}
      <div className="flex justify-end pt-2">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

const LOG_ICON: Record<string, string> = { created: 'user-plus', updated: 'pen', deleted: 'trash', archived: 'archive', linked: 'link', unlinked: 'unlink', conflict: 'warning', pushed: 'upload', error: 'alert', sync: 'refresh' };

function AccountLog({ a }: { a: SyncAccount }) {
  const log = useQuery({ queryKey: ['contacts', 'sync', 'log', a.id], queryFn: ({ signal }) => apiGet<SyncLogRow[]>(`/api/contacts/sync/accounts/${a.id}/log`, undefined, signal) });
  return (
    <div className="max-h-[280px] overflow-y-auto border-t border-line px-4 py-2 scroll-thin">
      {log.isLoading ? <Spinner /> : null}
      {log.data && !log.data.length ? <p className="py-2 text-[12.5px] text-ink-3">Nothing has happened yet.</p> : null}
      <ul role="list" aria-label={`${a.provider_label} sync log`}>
        {(log.data ?? []).map((r) => (
          <li key={r.id} className="flex items-start gap-2 py-1 text-[12.5px]">
            <Icon name={LOG_ICON[r.action] ?? 'info'} size={13} className={cx('mt-0.5 shrink-0', r.action === 'error' || r.action === 'conflict' ? 'text-warning' : 'text-ink-3')} />
            <span className="min-w-0 flex-1 text-ink-2">
              {r.contact_name ? <b className="text-ink">{r.contact_name}: </b> : null}
              {r.detail}
            </span>
            <span className="shrink-0 text-ink-3">{relative(r.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DisconnectDialog({ a, onClose, onDone }: { a: SyncAccount; onClose: () => void; onDone: () => void }) {
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await apiDelete<{ removed: number; archived: number; kept: number }>(`/api/contacts/sync/accounts/${a.id}${remove ? '?remove=1' : ''}`);
      if (a.mode === 'device' && hasDesktop()) await call('contactSync:forget', { accountId: a.id }).catch(() => undefined);
      toast('success', remove ? `Disconnected · ${r.removed} removed${r.archived ? `, ${r.archived} archived (CRM links)` : ''}` : 'Disconnected · contacts kept');
      onDone();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Disconnect ${a.provider_label}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={() => void go()}>
            Disconnect
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-ink-2">{a.email ?? a.provider_label} stops syncing. Nothing is deleted in {a.provider_label}.</p>
      <fieldset className="flex flex-col gap-2 text-[13px] text-ink">
        <label className="flex items-start gap-2">
          <input type="radio" name="disconnect" checked={!remove} onChange={() => setRemove(false)} className="mt-0.5 accent-[var(--color-primary)]" />
          <span>
            <b>Keep contacts in WorkSuite</b>
            <span className="block text-[12px] text-ink-3">They stay as ordinary contacts.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="disconnect" checked={remove} onChange={() => setRemove(true)} className="mt-0.5 accent-[var(--color-primary)]" />
          <span>
            <b>Remove contacts that only came from this account</b>
            <span className="block text-[12px] text-ink-3">Contacts another account also has are kept; any with CRM links are archived instead.</span>
          </span>
        </label>
      </fieldset>
    </Modal>
  );
}

/** The first sync, counted before anything is written. */
export function PreviewDialog({ a, onClose }: { a: SyncAccount; onClose: () => void }) {
  const [p, setP] = useState<SyncPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const label = providerLabel(a.provider);
  useEffect(() => {
    let live = true;
    (a.mode === 'server' ? apiPost<SyncPreview>(`/api/contacts/sync/accounts/${a.id}/preview`) : call('contactSync:run', { accountId: a.id, preview: true }).then((r) => r.preview!))
      .then((r) => live && setP(r))
      .catch((e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [a.id, a.mode]);
  const start = async () => {
    setBusy(true);
    try {
      await syncNow(a);
      toast('success', `${label} is syncing with WorkSuite`);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Sync ${label}`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <Button onClick={onClose}>Not now</Button>
          <Button variant="primary" disabled={!p} loading={busy} onClick={() => void start()}>
            Start syncing
          </Button>
        </>
      }
    >
      {!p && !error ? <Spinner label={`Reading ${label}…`} /> : null}
      {error ? <ErrorNote error={error} /> : null}
      {p ? (
        <div className="flex flex-col gap-3 text-[13px] text-ink-2">
          <p className="text-[15px] font-semibold text-ink">{previewLine(p)}</p>
          <ul className="flex flex-col gap-1.5">
            <li>
              <b className="text-ink">{p.new.toLocaleString()}</b> new contacts will be added, as {TYPE_OPTIONS.find((t) => t.value === a.settings.default_type)?.label ?? 'contacts'}.
            </li>
            <li>
              <b className="text-ink">{p.matched.toLocaleString()}</b> are already here (same email or phone): they are linked, not copied. Their WorkSuite type and CRM links stay.
            </li>
            {p.duplicates ? (
              <li>
                <b className="text-ink">{p.duplicates.toLocaleString()}</b> have the same name and company as a contact here. They are added and listed under Tidy up → Possible duplicates to merge.
              </li>
            ) : null}
            {p.to_provider ? (
              <li>
                <b className="text-ink">{p.to_provider.toLocaleString()}</b> WorkSuite contacts will be added to {label}.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}

const CHOICES: Array<{ id: SyncProvider; label: string; hint: string }> = [
  { id: 'google', label: 'Google', hint: 'Gmail and Google Workspace contacts' },
  { id: 'microsoft', label: 'Outlook / Microsoft 365', hint: 'Outlook.com and work or school accounts' },
  { id: 'icloud', label: 'iCloud', hint: 'Apple contacts, with an app-specific password' },
  { id: 'carddav', label: 'Other CardDAV', hint: 'Nextcloud, Zoho, Fastmail and others' },
  { id: 'macos', label: 'Contacts on this Mac', hint: '“On My Mac” contacts, read on this computer' },
];

function ConnectDialog({ onClose, onBrowser, onConnected }: { onClose: () => void; onBrowser: () => void; onConnected: (accountId: number) => void }) {
  const providers = useQuery({ queryKey: ['contacts', 'sync', 'providers'], queryFn: ({ signal }) => apiGet<SyncProviders>('/api/contacts/sync/providers', undefined, signal), staleTime: 5 * 60_000 });
  const orgs = useQuery({ queryKey: ['contacts', 'organizations'], queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string }> }>('/api/contacts/organizations', undefined, signal), staleTime: 5 * 60_000 });
  const [pick, setPick] = useState<SyncProvider | null>(null);
  const [form, setForm] = useState({ username: '', password: '', serverUrl: '', type: 'personal' as ContactType, org: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const shown = CHOICES.filter((c) => (c.id === 'macos' ? isMac && hasDesktop() : c.id === 'icloud' || c.id === 'carddav' ? hasDesktop() : true));
  const orgId = form.org ? Number(form.org) : null;

  const start = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      if (pick === 'google' || pick === 'microsoft') {
        const r = await apiPost<{ url: string }>(`/api/contacts/sync/oauth/${pick}/start`, { org_id: orgId });
        await call('app:openExternal', { url: r.url });
        onBrowser();
        return;
      }
      const r = await call('contactSync:connect', { provider: pick, username: form.username || undefined, password: form.password || undefined, serverUrl: pick === 'carddav' ? form.serverUrl : undefined, orgId, settings: { default_type: form.type } });
      onConnected(r.accountId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const oauthReady = (p: SyncProvider) => (p === 'google' || p === 'microsoft' ? (providers.data?.server ?? []).includes(p) : true);

  return (
    <Modal
      title={pick ? `Add ${CHOICES.find((c) => c.id === pick)!.label}` : 'Add an account'}
      onClose={onClose}
      width={520}
      footer={
        pick ? (
          <>
            <Button onClick={() => (setPick(null), setError(null))}>Back</Button>
            <Button variant="primary" loading={busy} disabled={!oauthReady(pick) || ((pick === 'icloud' || pick === 'carddav') && (!form.username || !form.password)) || (pick === 'carddav' && !form.serverUrl)} onClick={() => void start()}>
              {pick === 'google' || pick === 'microsoft' ? 'Sign in in the browser' : 'Connect'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )
      }
    >
      {!pick ? (
        <ul role="list" className="flex flex-col gap-2">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setPick(c.id)} className="flex w-full items-center gap-3 rounded-[10px] border border-line px-3 py-2.5 text-left hover:bg-subtle">
                <SourceIcon provider={c.id} size={26} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[13.5px] text-ink">{c.label}</b>
                  <span className="text-[12px] text-ink-3">{c.hint}</span>
                </span>
                <Icon name="chevron-right" size={15} className="text-ink-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          {(pick === 'google' || pick === 'microsoft') && providers.data && !oauthReady(pick) ? (
            <p className="rounded-[10px] bg-warning-bg px-3 py-2 text-[13px] text-warning">Your administrator has not set up signing in with {providerLabel(pick)} yet (Settings › Mail › Sign-in apps, with the contacts permission).</p>
          ) : null}
          {pick === 'google' || pick === 'microsoft' ? <p className="text-[13px] text-ink-2">Sign in with {providerLabel(pick)} in your browser. WorkSuite never sees your password; it keeps a token you can revoke from your {providerLabel(pick)} account.</p> : null}
          {pick === 'icloud' ? (
            <p className="text-[13px] text-ink-2">
              Use your Apple ID and an <b>app-specific password</b> (appleid.apple.com › Sign-In and Security › App-Specific Passwords). It is kept in this computer&apos;s keychain and never sent to WorkSuite.
            </p>
          ) : null}
          {pick === 'carddav' ? <TextField label="CardDAV address" placeholder="https://cloud.example.com/remote.php/dav" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} /> : null}
          {pick === 'icloud' || pick === 'carddav' ? (
            <>
              <TextField label={pick === 'icloud' ? 'Apple ID' : 'User name'} autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <TextField label={pick === 'icloud' ? 'App-specific password' : 'Password'} type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
                New contacts are filed as
                <Select aria-label="Type for new contacts" value={form.type} onValueChange={(v) => setForm({ ...form, type: v })} options={TYPE_OPTIONS} />
              </label>
            </>
          ) : null}
          {pick === 'macos' ? <MacNote /> : null}
          {pick !== 'macos' && (orgs.data?.items ?? []).length ? (
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Sync into
              <Select aria-label="Sync into" value={form.org} onValueChange={(v) => setForm({ ...form, org: v })} options={[{ value: '', label: 'My contacts' }, ...(orgs.data?.items ?? []).map((o) => ({ value: String(o.id), label: `${o.name} (company contacts)` }))]} />
            </label>
          ) : null}
          {error ? <ErrorNote error={error} /> : null}
        </div>
      )}
    </Modal>
  );
}

function MacNote() {
  const s = useQuery({ queryKey: ['contacts', 'sync', 'mac'], queryFn: () => call('contactSync:macAccess') });
  if (s.isLoading) return <Spinner />;
  const d = s.data;
  return (
    <div className="flex flex-col gap-2 text-[13px] text-ink-2">
      <p>Only the contacts kept “On My Mac” are synced here, so iCloud contacts are never synced twice — connect iCloud for those.</p>
      {d?.reason ? <p className="rounded-[10px] bg-warning-bg px-3 py-2 text-warning">{d.reason}</p> : null}
    </div>
  );
}
