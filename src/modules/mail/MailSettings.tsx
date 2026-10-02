import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../../core/api';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { bytes, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Chip, ErrorNote, Modal, Spinner, Switch, TextField, cx } from '../../components/ui';
import type { Preferences } from '@shared/types';
import { AddMailbox } from './AddMailbox';
import { mailKeys, useLocalStore, useMailPrefs, useMailboxes, useSyncStatus } from './api';
import { mailboxLetter } from './model';
import { AccountAvatar } from './parts';
import type { MailPrefs, Mailbox, SyncMailbox } from './types';

/**
 * Settings › Mail: the accounts and what this computer keeps (Accounts &
 * offline), how each mailbox syncs and what is stored where (Storage & sync),
 * and how the Mail screen is laid out (Layout & reading).
 */

type Tab = 'accounts' | 'storage' | 'layout';

const MAIL_DAYS: Array<{ value: Preferences['mailCacheDays']; label: string }> = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'Headers only' },
];

export function MailSettings() {
  const [tab, setTab] = useState<Tab>('accounts');
  return (
    <div>
      <div role="tablist" aria-label="Mail settings" className="mb-5 flex gap-1 border-b border-line">
        {(
          [
            ['accounts', 'Accounts & offline'],
            ['storage', 'Storage & sync'],
            ['layout', 'Layout & reading'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('-mb-px h-9 border-b-2 px-3 text-[13.5px] font-semibold', tab === id ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
            {text(label)}
          </button>
        ))}
      </div>
      {tab === 'accounts' ? <Accounts /> : tab === 'storage' ? <Storage /> : <Layout />}
    </div>
  );
}

/** How a mailbox gets its new mail, in words. */
export function syncWords(b: Mailbox, s: SyncMailbox | undefined): { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  if (b.auth_state === 'problem') return { label: text('Paused — sign in again'), tone: 'danger' };
  if (b.sync_paused) return { label: text('Paused'), tone: 'warning' };
  if (s?.pushed) return { label: text('Pushed instantly'), tone: 'success' };
  if (b.sync_every) return { label: text('Every {n} minutes', { n: b.sync_every }), tone: 'success' };
  return { label: text('When opened'), tone: 'muted' };
}

function kindOf(b: Mailbox): string {
  if (b.account_type === 'local_mailbox') return text('WorkSuite Local · managed by your administrator');
  if (b.shared) return text('Shared mailbox');
  return `${b.provider_label ?? b.provider ?? 'IMAP'}${b.auth_type === 'oauth' ? ' · OAuth' : ''}`;
}

function Accounts() {
  const boxes = useMailboxes();
  const sync = useSyncStatus(true);
  const prefs = useStore(app, (s) => s.prefs);
  const store = useLocalStore();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<Mailbox | null>(null);
  const [repairing, setRepairing] = useState<Mailbox | null>(null);
  const list = (boxes.data?.mailboxes ?? []).filter((b) => !b.archived);
  const repair = async (b: Mailbox) => {
    if (b.auth_type !== 'oauth' || !b.oauth_provider) return setRepairing(b);
    try {
      const r = await apiPost<{ url: string }>(`/api/mail/oauth/${b.oauth_provider}/start`);
      await call('app:openExternal', { url: r.url });
      toast('info', text('Sign in again in your browser. The mailbox picks up from where it stopped; nothing else changes.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (!prefs) return null;
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-ink">Accounts & offline</h2>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add a mailbox
        </Button>
      </div>
      {boxes.isLoading ? <Spinner /> : boxes.error ? <ErrorNote error={boxes.error} onRetry={() => void boxes.refetch()} /> : null}
      {list.length ? (
        <ul role="list" className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {list.map((b) => {
            const s = sync.data?.mailboxes.find((m) => m.mailbox === b.id);
            const problem = b.auth_state === 'problem';
            const words = syncWords(b, s);
            return (
              <li key={b.id} className={cx('flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0', problem && 'bg-danger-bg/40')}>
                <AccountAvatar letter={mailboxLetter(b)} colour={b.colour} size={32} className="rounded-[8px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold text-ink">{b.email}</span>
                  <span className="block truncate text-[12.5px] text-ink-3">{kindOf(b)}</span>
                </span>
                <Chip tone={problem ? 'danger' : b.sync_paused ? 'warning' : 'success'}>{problem ? text('Authentication problem') : b.sync_paused ? text('Paused') : text('Live')}</Chip>
                <span className="w-[170px] shrink-0 text-right text-[12px] text-ink-3">{problem && b.last_sync_at ? text('since {time} · settings unchanged', { time: timeLabel(b.last_sync_at) }) : words.label}</span>
                {problem ? (
                  <Button variant="danger" onClick={() => void repair(b)}>
                    Repair
                  </Button>
                ) : (
                  <Button onClick={() => setManaging(b)}>Manage</Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <section aria-label="Offline mail on this computer" className="rounded-[12px] border border-line bg-surface p-4">
          <h3 className="text-[15px] font-bold text-ink">Offline mail on this computer</h3>
          <div className="mt-3">
            <Select label="Keep messages from the last" value={prefs.mailCacheDays} options={MAIL_DAYS.map((d) => ({ ...d, label: text(d.label) }))} onValueChange={(v) => void updatePrefs({ mailCacheDays: v as Preferences['mailCacheDays'] })} />
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">{prefs.mailCacheDays === 0 ? text('Only the lists are kept; a message is read from the server.') : text('Lists and the messages you open are kept, encrypted, so they read offline.')}</p>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[13px] text-ink-2">
            <span>{text('Using {size} · encrypted on this device', { size: bytes(store.data ?? 0) })}</span>
            <Button
              size="sm"
              onClick={() =>
                void call('offline:clearModule', { module: 'mail' })
                  .then(() => {
                    void qc.invalidateQueries({ queryKey: mailKeys.localStore });
                    toast('success', text('Mail saved on this computer was removed.'));
                  })
                  .catch((e) => toast('error', errorMessage(e)))
              }
            >
              Clear
            </Button>
          </div>
        </section>
        <section aria-label="Notifications" className="rounded-[12px] border border-line bg-surface p-4">
          <h3 className="text-[15px] font-bold text-ink">Notifications</h3>
          <div className="mt-3 flex flex-col gap-3 text-[13.5px] text-ink">
            <label className="flex items-center gap-2.5">
              <Checkbox checked={prefs.moduleNotifications.mail !== false} onChange={(e) => void updatePrefs({ moduleNotifications: { ...prefs.moduleNotifications, mail: e.target.checked } })} />
              Desktop notifications for new mail
            </label>
            <label className="flex items-center gap-2.5">
              <Checkbox checked={prefs.badgeCount} onChange={(e) => void updatePrefs({ badgeCount: e.target.checked })} />
              Unread count on the dock / taskbar
            </label>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-3">Each mailbox can be left out of notifications in Manage.</p>
        </section>
      </div>
      {adding ? <AddMailbox onClose={() => setAdding(false)} /> : null}
      {managing ? <ManageMailbox box={managing} onClose={() => setManaging(null)} /> : null}
      {repairing ? <RepairPassword box={repairing} onClose={() => setRepairing(null)} /> : null}
    </>
  );
}

/** A switch with its label and a one-line hint beside it — the switch alone only names itself to screen readers. */
function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-semibold text-ink" aria-hidden>
          {label}
        </div>
        <p id={id} className="mt-0.5 text-[12.5px] text-ink-3">
          {hint}
        </p>
      </div>
      <div className="pt-0.5">
        <Switch label={label} describedBy={id} checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

function ManageMailbox({ box, onClose }: { box: Mailbox; onClose: () => void }) {
  const qc = useQueryClient();
  const [b, setB] = useState(box);
  const [confirm, setConfirm] = useState(false);
  const save = async (patch: Partial<Mailbox>) => {
    const before = b;
    setB({ ...b, ...patch });
    try {
      await apiPut(`/api/mail/mailboxes/${b.id}`, patch);
      void qc.invalidateQueries({ queryKey: ['mail'] });
    } catch (e) {
      setB(before);
      toast('error', errorMessage(e));
    }
  };
  const act = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      void qc.invalidateQueries({ queryKey: ['mail'] });
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <Modal title={b.email} labelledBy="mail-manage-title" width={480} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4 p-5 text-[13.5px]">
        <SwitchRow label={text('Show in the unified inbox')} hint={text('Mix its mail into Unified inbox with your other mailboxes.')} checked={b.in_unified !== false} onChange={(v) => void save({ in_unified: v })} />
        <SwitchRow label={text('Notify me about new mail')} hint={text('Desktop notifications for mail arriving in this mailbox.')} checked={(b as Mailbox & { notify?: boolean }).notify !== false} onChange={(v) => void save({ notify: v } as Partial<Mailbox>)} />
        {!b.shared ? <SwitchRow label={text('Pause syncing')} hint={text('Stop checking for new mail until you turn this off.')} checked={!!b.sync_paused} onChange={(v) => void save({ sync_paused: v })} /> : null}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {!b.is_default && !b.shared ? <Button onClick={() => void act(() => apiPost(`/api/mail/mailboxes/${b.id}/default`), text('Now your default mailbox.'))}>Make default</Button> : null}
          <Button icon="refresh" onClick={() => void act(() => apiPost(`/api/mail/mailboxes/${b.id}/sync`), text('Checking for new mail.'))}>
            Sync now
          </Button>
          {!b.shared ? (
            confirm ? (
              <Button variant="danger" onClick={() => void act(() => apiDelete(`/api/mail/mailboxes/${b.id}`), text('Removed from WorkSuite. The mail stays with the provider.')).then(onClose)}>
                Remove for good
              </Button>
            ) : (
              <Button variant="ghost" className="!text-danger hover:!bg-danger/10" onClick={() => setConfirm(true)}>
                Remove…
              </Button>
            )
          ) : null}
        </div>
        {confirm ? <p className="text-[12.5px] text-ink-3">Removing it takes it out of WorkSuite on every computer. Nothing is deleted at the provider.</p> : null}
      </div>
    </Modal>
  );
}

function RepairPassword({ box, onClose }: { box: Mailbox; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/api/mail/mailboxes/${box.id}`, { password });
      void qc.invalidateQueries({ queryKey: ['mail'] });
      toast('success', text('{email} signs in again.', { email: box.email }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Repair {email}', { email: box.email })}
      labelledBy="mail-repair-title"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!password} onClick={() => void save()}>
            Test and save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <p className="text-[13px] text-ink-2">{box.last_error ? box.last_error : text('The mail server refused the saved password.')} {text('Enter the current password; the server settings stay as they are.')}</p>
        <TextField type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error ? <ErrorNote error={error} /> : null}
      </div>
    </Modal>
  );
}

function Storage() {
  const boxes = useMailboxes();
  const sync = useSyncStatus(true);
  const store = useLocalStore();
  const prefs = useStore(app, (s) => s.prefs);
  const qc = useQueryClient();
  const list = (boxes.data?.mailboxes ?? []).filter((b) => !b.archived) as Array<Mailbox & { copy?: { copy_mode: string; stored_bytes: number } | null; download_attachments?: boolean }>;
  const copies = list.filter((b) => b.copy);
  const stored = copies.reduce((n, b) => n + (b.copy?.stored_bytes ?? 0), 0);
  const syncAll = async () => {
    const r = await Promise.allSettled(list.filter((b) => !b.shared).map((b) => apiPost(`/api/mail/mailboxes/${b.id}/sync`)));
    void qc.invalidateQueries({ queryKey: ['mail'] });
    const failed = r.filter((x) => x.status === 'rejected').length;
    toast(failed ? 'error' : 'success', failed ? text('{n} mailboxes could not be asked now.', { n: failed }) : text('Checking every mailbox for new mail.'));
  };
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-ink">Storage & sync</h2>
        <Button onClick={() => void syncAll()}>Sync all now</Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <section aria-label="On this computer" className="rounded-[12px] border border-line bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-bold text-ink">On this computer</h3>
            <span className="font-mono text-[13px] font-semibold text-ink">{bytes(store.data ?? 0)}</span>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">Encrypted with a key kept in your system keychain. Removed when you sign out.</p>
          <p className="mt-1 text-[12.5px] text-ink-3">{prefs?.mailCacheDays ? text('Keeps the last {n} days of every mailbox.', { n: prefs.mailCacheDays }) : text('Keeps the lists only.')}</p>
        </section>
        <section aria-label="In WorkSuite storage" className="rounded-[12px] border border-line bg-surface p-4">
          <h3 className="text-[15px] font-bold text-ink">In WorkSuite storage</h3>
          {copies.length ? (
            <>
              <p className="mt-2 text-[12.5px] text-ink-2">Your organization keeps a copy of your mail on the WorkSuite server, so it opens fast on every device and while a provider is down.</p>
              <p className="mt-2 text-[13px] text-ink-3">
                {text('Your mailboxes')} <span className="ml-1 font-mono font-semibold text-ink">{bytes(stored)}</span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-[12.5px] text-ink-3">Your organization does not keep a copy of this mail on the WorkSuite server.</p>
          )}
        </section>
      </div>
      {list.length ? (
        <table className="mt-5 w-full overflow-hidden rounded-[12px] border border-line bg-surface text-left text-[13px]">
          <thead className="text-[12px] text-ink-3">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-semibold">Mailbox</th>
              <th className="px-4 py-2 font-semibold">New mail</th>
              <th className="px-4 py-2 font-semibold">Attachments</th>
              <th className="px-4 py-2 text-right font-semibold">On the server</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => {
              const s = sync.data?.mailboxes.find((m) => m.mailbox === b.id);
              const w = syncWords(b, s);
              return (
                <tr key={b.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <AccountAvatar letter={mailboxLetter(b)} colour={b.colour} size={24} className="rounded-[6px]" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{b.email}</span>
                        <span className="block truncate text-[12px] text-ink-3">{b.account_type === 'local_mailbox' ? text('WorkSuite Local') : b.shared ? text('Shared mailbox') : (b.provider_label ?? '')}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className={cx('h-2 w-2 rounded-full', w.tone === 'success' ? 'bg-success' : w.tone === 'danger' || w.tone === 'warning' ? 'bg-warning' : 'bg-ink-3')} />
                      {w.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{b.download_attachments ? text('Downloaded with the message') : text('When opened')}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-2">{b.copy ? bytes(b.copy.stored_bytes) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

function Layout() {
  const { prefs, set } = useMailPrefs();
  const theme = useStore(app, (s) => s.prefs?.theme ?? 'system');
  const seg = <K extends keyof MailPrefs>(key: K, value: MailPrefs[K] | undefined, fallback: MailPrefs[K], options: Array<[NonNullable<MailPrefs[K]>, string]>, label: string) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-[13.5px] font-semibold text-ink">{text(label)}</span>
      <div role="radiogroup" aria-label={text(label)} className="flex rounded-[10px] bg-subtle p-0.5">
        {options.map(([v, l]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={(value ?? fallback) === v} onClick={() => set({ [key]: v } as Partial<MailPrefs>)} className={cx('h-8 rounded-[8px] px-3 text-[13px] font-semibold', (value ?? fallback) === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
            {text(l)}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <h2 className="mb-4 text-[20px] font-bold text-ink">Layout & reading</h2>
      <section aria-label="Theme" className="rounded-[12px] border border-line bg-surface p-4">
        <h3 className="text-[15px] font-bold text-ink">Theme</h3>
        <p className="text-[12.5px] text-ink-3">Applies to Mail and every WorkSuite app on this computer.</p>
        <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-3 gap-3">
          {(
            [
              ['light', 'Light', 'Bright surfaces, best in daylight'],
              ['dark', 'Dark', 'Low-glare surfaces for long sessions'],
              ['system', 'Match system', 'Follows Windows or macOS'],
            ] as const
          ).map(([id, label, hint]) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => void updatePrefs({ theme: id })} className={cx('rounded-[10px] border-2 p-3 text-left', theme === id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
              <span className="block text-[13.5px] font-semibold text-ink">{text(label)}</span>
              <span className="block text-[12px] text-ink-3">{text(hint)}</span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Mail layout" className="mt-4 rounded-[12px] border border-line bg-surface p-4">
        <h3 className="text-[15px] font-bold text-ink">Mail layout</h3>
        {seg('pane', prefs.pane, 'right', [['right', 'Right'], ['bottom', 'Bottom'], ['hidden', 'Off']], 'Reading pane')}
        {seg('view', prefs.view, 'compact', [['classic', 'Classic'], ['compact', 'Compact'], ['super', 'Super compact'], ['table', 'Full list']], 'Density')}
        {seg('zoom', prefs.zoom, 100, [[90, 'Small'], [100, 'Default'], [120, 'Large']], 'Text size')}
        {seg('toolbar', prefs.toolbar, 'docked', [['docked', 'Docked'], ['floating', 'Floating'], ['compact', 'Compact'], ['minimal', 'Minimal']], 'Action bar')}
        <p className="mt-2 text-[12px] text-ink-3">Kept with your WorkSuite account, so every computer you use shows Mail the same way. Emails designed with their own colours are shown on a light card so logos and tables stay readable.</p>
      </section>
    </>
  );
}
