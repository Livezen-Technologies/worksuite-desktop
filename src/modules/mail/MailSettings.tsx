import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../../core/api';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { bytes, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { FormattingSettings } from './ReadingSettings';
import { AccountTagSettings } from './AccountTagSettings';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Chip, ErrorNote, Modal, Spinner, Switch, cx } from '../../components/ui';
import { AutocompleteSettings } from './AutocompleteSettings';
import type { Preferences } from '@shared/types';
import { AddMailbox } from './AddMailbox';
import { AccountsSync } from './AccountsSync';
import { QuickStepsSettings } from './QuickStepsUi';
import { includedIds, runSync } from './sync';
import { AppPasswords } from './AppPasswords';
import { ImportMail } from './Import';
import { DataFileImport } from './DataFiles';
import { Rules } from './MailRules';
import { Signatures } from './signatures/SignaturesSettings';
import { SpellingSettings } from './SpellingSettings';
import { MediaSettings } from './MediaSettings';
import { mailKeys, useLocalStore, useMailPrefs, useMailStats, useMailboxes, useSyncStatus } from './api';
import { mailboxLetter } from './model';
import { AccountAvatar } from './parts';
import type { MailPrefs, Mailbox, SyncMailbox } from './types';
import type { MailStoreStats } from '@shared/types';
import { SyncButton } from '../../components/SyncButton';
import { pullPrefs, setPullEnabled } from '../../components/listRefresh';
import { forgetMailbox } from './localFirst';
import { SpamSecurity } from './protection/SpamSecurity';
import { RepairPassword, oauthProviderOf, signInAgain } from './AccountAttention';
import { RepairLocalMailButton } from './RepairLocalMail';
import { MailAlertSettings } from './alerts/MailAlertSettings';

/**
 * Settings › Mail: the accounts and what this computer keeps (Accounts &
 * offline), how each mailbox syncs and what is stored where (Storage & sync),
 * pictures from the web and attachments kept ahead (Images & media, #163),
 * spam and virus protection (Spam & security, ENH-MAIL-04 D19),
 * and how the Mail screen is laid out (Layout & reading).
 */

type Tab = 'accounts' | 'storage' | 'media' | 'import' | 'signatures' | 'rules' | 'security' | 'quicksteps' | 'layout';

const TABS: Array<[Tab, string]> = [
  ['accounts', 'Accounts & offline'],
  ['storage', 'Storage & sync'],
  ['media', 'Images & media'],
  ['import', 'Import mail'],
  ['signatures', 'Signatures'],
  ['rules', 'Rules'],
  // Mail protection (ENH-MAIL-04 D19, P-UI-14): accounts' protection, spam level, digest, own safe and blocked senders.
  ['security', 'Spam & security'],
  ['quicksteps', 'Quick Steps'],
  ['layout', 'Appearance & reading'],
];

const MAIL_DAYS: Array<{ value: Preferences['mailCacheDays']; label: string }> = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'Headers only' },
];

/** The tab a link names (`/settings/mail?tab=import&id=4`, an import's notification), else Accounts. */
export function mailSettingsTab(q: string | null): Tab {
  return TABS.some(([id]) => id === q) ? (q as Tab) : 'accounts';
}

/** `query`: the Settings tab's route query (`?tab=import&id=4`), when there is one. */
export function MailSettings({ query = new URLSearchParams() }: { query?: URLSearchParams } = {}) {
  const asked = query.get('tab');
  const [tab, setTab] = useState<Tab>(() => mailSettingsTab(asked));
  // A new link (an import's notification) chooses its tab again.
  const [linked, setLinked] = useState(asked);
  if (asked !== linked) {
    setLinked(asked);
    if (asked) setTab(mailSettingsTab(asked));
  }
  const id = query.get('id');
  const importId = id && /^\d+$/.test(id) ? Number(id) : null;
  const boxes = useMailboxes();
  const defaultBox = (boxes.data?.mailboxes ?? []).find((b) => b.is_default) ?? null;
  return (
    <div>
      <div role="tablist" aria-label="Mail settings" className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('-mb-px h-9 border-b-2 px-3 text-[13.5px] font-semibold', tab === t ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
            {text(label)}
          </button>
        ))}
      </div>
      {tab === 'accounts' ? <Accounts /> : tab === 'storage' ? <Storage /> : tab === 'media' ? <MediaSettings /> : tab === 'import' ? (
        <>
          <DataFileImport />
          <ImportMail openId={importId} />
          <AutocompleteSettings />
        </>
      ) : tab === 'signatures' ? (
        <>
          <Signatures />
          <SpellingSettings />
        </>
      ) : tab === 'rules' ? <Rules mailbox={defaultBox ? String(defaultBox.id) : null} /> : tab === 'security' ? <SpamSecurity /> : tab === 'quicksteps' ? <QuickStepsSettings /> : <Layout />}
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

/** "Pushed instantly · 1,284 offline": how it syncs, and how many of its messages read offline here. */
export function offlineWords(sync: string, messages: number | null): string {
  return messages ? `${sync} · ${text('{n} offline', { n: messages.toLocaleString() })}` : sync;
}

/** What the organization keeps of a mailbox on the WorkSuite server, in words (D09). */
export function copyWords(mode: string, months: number | undefined): string {
  if (mode === 'headers') return text('Headers only — messages open from the provider');
  if (mode === 'everything') return text('Everything');
  if (mode === 'archive') return text('Everything, kept after it is deleted at the provider');
  return text('Recent mail · last {n} months', { n: months ?? 12 });
}

/** The bar's parts on this computer (D09), each a share of the limit. */
export function storeParts(s: MailStoreStats): Array<{ key: 'messages' | 'lists' | 'search' | 'other'; label: string; bytes: number; percent: number }> {
  const limit = s.limitBytes && s.limitBytes > 0 ? s.limitBytes : Math.max(1, s.total);
  return (
    [
      ['messages', 'Messages'],
      ['lists', 'Lists & folders'],
      ['search', 'Search'],
      ['other', 'Other'],
    ] as const
  ).map(([key, label]) => ({ key, label: text(label), bytes: s[key], percent: Math.min(100, (s[key] / limit) * 100) }));
}

function kindOf(b: Mailbox): string {
  if (b.account_type === 'local_mailbox') return text('WorkSuite Local · managed by your administrator');
  if (b.shared) return text('Shared mailbox');
  const via = b.transport?.driver ? ` · ${b.transport.incoming_only ? text('POP3, incoming only') : text('via {api}', { api: b.transport.label })}` : '';
  return `${b.provider_label ?? b.provider ?? 'IMAP'}${b.auth_type === 'oauth' ? ' · OAuth' : ''}${via}`;
}

function Accounts() {
  const boxes = useMailboxes();
  const sync = useSyncStatus(true);
  const prefs = useStore(app, (s) => s.prefs);
  const store = useLocalStore(true);
  const stats = useMailStats(true, true);
  const qc = useQueryClient();
  const mailPrefs = useMailPrefs();
  const [adding, setAdding] = useState(false);
  const [passwords, setPasswords] = useState(false);
  const [managing, setManaging] = useState<Mailbox | null>(null);
  const [repairing, setRepairing] = useState<Mailbox | null>(null);
  const list = (boxes.data?.mailboxes ?? []).filter((b) => !b.archived);
  const repair = async (b: Mailbox) => {
    const provider = b.auth_type === 'oauth' ? oauthProviderOf(b) : null;
    if (!provider) return setRepairing(b);
    await signInAgain(b, provider, qc);
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
      {list.length && sync.data?.accounts ? <AccountsSync boxes={list} prefs={mailPrefs.prefs} onPrefs={mailPrefs.set} onRepair={(b) => void repair(b)} onManage={setManaging} /> : null}
      {list.length && sync.data && !sync.data.accounts ? (
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
                <span className="w-[190px] shrink-0 text-right text-[12px] text-ink-3">{problem && b.last_sync_at ? text('since {time} · settings unchanged', { time: timeLabel(b.last_sync_at) }) : offlineWords(words.label, stats.data?.byMailbox[String(b.id)]?.messages ?? null)}</span>
                {problem ? (
                  <Button variant="danger" onClick={() => void repair(b)}>
                    {b.auth_type === 'oauth' ? text('Sign in again') : text('Repair')}
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
          <p className="mt-2 text-[12.5px] text-ink-3">{prefs.mailCacheDays === 0 ? text('Only the lists are kept; a message is read from the server.') : text('Messages from this period in Inbox, Sent and Drafts are downloaded in the background, newest and unread first, and kept encrypted so they read offline.')}</p>
          <label className="mt-3 flex items-center gap-2.5 text-[13.5px] text-ink">
            <Checkbox checked={prefs.mailCacheDays !== 0} onChange={(e) => void updatePrefs({ mailCacheDays: e.target.checked ? 30 : 0 })} />
            Download message bodies
          </label>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-[13px] text-ink-2">
            <span className="min-w-0 flex-1">{text('Using {size} · encrypted on this device', { size: bytes(store.data ?? 0) })}</span>
            {/* Repair local mail data (#338): checked, cleared and downloaded again; the outbox and settings kept. */}
            <RepairLocalMailButton size="sm" onDone={() => void qc.invalidateQueries({ queryKey: mailKeys.localStore })} />
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
        <section aria-label="Notifications and other apps" className="rounded-[12px] border border-line bg-surface p-4">
          <h3 className="text-[15px] font-bold text-ink">Notifications & other apps</h3>
          <div className="mt-3 flex flex-col gap-3 text-[13.5px] text-ink">
            <label className="flex items-center gap-2.5">
              <Checkbox checked={prefs.moduleNotifications.mail !== false} onChange={(e) => void updatePrefs({ moduleNotifications: { ...prefs.moduleNotifications, mail: e.target.checked } })} />
              Desktop notifications for new mail
            </label>
            {prefs.moduleNotifications.mail !== false ? (
              <div className="flex flex-col gap-2 pl-[26px]">
                <div className="flex items-center justify-between gap-4">
                  <span>{text('Alert me for')}</span>
                  <Select
                    aria-label={text('Alert me for')}
                    value={prefs.mailAlerts ?? 'all'}
                    options={[
                      { value: 'all', label: text('Every new message') },
                      { value: 'focused', label: text('Focused Inbox only') },
                      { value: 'vip', label: text('VIPs only') },
                      { value: 'none', label: text('No banners (count only)') },
                    ]}
                    onValueChange={(v) => void updatePrefs({ mailAlerts: v as NonNullable<Preferences['mailAlerts']> })}
                    className="h-8 w-[220px]"
                  />
                </div>
                <label className="flex items-center gap-2.5">
                  <Checkbox checked={prefs.mailVipBreakthrough === true} onChange={(e) => void updatePrefs({ mailVipBreakthrough: e.target.checked })} />
                  {text('VIPs can break through quiet hours')}
                </label>
                <p className="text-[12px] text-ink-3">{text('Quiet hours are set under Settings › Notifications. Rules that run on this computer can also show an alert or play a sound.')}</p>
                {/* New-mail alerts (ENH-MAIL-05): preview level, Mail sound and the pause. */}
                <MailAlertSettings />
              </div>
            ) : null}
            <label className="flex items-center gap-2.5">
              <Checkbox checked={prefs.badgeCount} onChange={(e) => void updatePrefs({ badgeCount: e.target.checked })} />
              Unread count on the dock / taskbar
            </label>
            <label className="flex items-center gap-2.5">
              <Checkbox checked={prefs.mailtoHandler === true} onChange={(e) => void updatePrefs({ mailtoHandler: e.target.checked })} />
              Open mailto: links in WorkSuite
            </label>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-3">Each mailbox can be left out of notifications in Manage. With mailto: links on, WorkSuite is this computer’s mail app: a link opens a new message here.</p>
          <p className="mt-3 rounded-[10px] bg-subtle p-3 text-[12.5px] leading-relaxed text-ink-2">
            {text('Using Apple Mail or Outlook too? Create an app password for it. Your WorkSuite password never works for mail.')}{' '}
            <button type="button" className="font-semibold text-primary underline" onClick={() => setPasswords(true)}>
              Mail app passwords
            </button>
          </p>
        </section>
      </div>
      {passwords ? <AppPasswords onClose={() => setPasswords(false)} /> : null}
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
      void qc.invalidateQueries({ queryKey: mailKeys.mailboxes });
    } catch (e) {
      setB(before);
      toast('error', errorMessage(e));
    }
  };
  const act = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      void qc.invalidateQueries({ queryKey: mailKeys.mailboxes });
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <Modal title={b.email} labelledBy="mail-manage-title" width={480} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4 p-5 text-[13.5px]">
        <SwitchRow label={text('Include in All Accounts')} hint={text('Show its Inbox, Drafts, Sent and other folders in All Accounts, and sync it with Sync all.')} checked={b.in_unified !== false} onChange={(v) => void save({ in_unified: v })} />
        <SwitchRow label={text('Notify me about new mail')} hint={text('Desktop notifications for mail arriving in this mailbox.')} checked={(b as Mailbox & { notify?: boolean }).notify !== false} onChange={(v) => void save({ notify: v } as Partial<Mailbox>)} />
        {!b.shared ? <SwitchRow label={text('Pause syncing')} hint={text('Stop checking for new mail until you turn this off.')} checked={!!b.sync_paused} onChange={(v) => void save({ sync_paused: v })} /> : null}
        <AccountTagSettings box={b} />
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {!b.is_default && !b.shared ? <Button onClick={() => void act(() => apiPost(`/api/mail/mailboxes/${b.id}/default`), text('Now your default mailbox.'))}>Make default</Button> : null}
          <SyncButton
            onSync={async () => {
              try {
                await apiPost(`/api/mail/mailboxes/${b.id}/sync`);
                void qc.invalidateQueries({ queryKey: mailKeys.mailboxes });
              } catch (e) {
                toast('error', errorMessage(e));
                throw e;
              }
            }}
          />
          {!b.shared ? (
            confirm ? (
              <Button variant="danger" onClick={() => void act(async () => {
                await apiDelete(`/api/mail/mailboxes/${b.id}`);
                // Its mail kept on this computer goes with it (worksuite-desktop#162).
                await forgetMailbox(b.id);
              }, text('Removed from WorkSuite. The mail stays with the provider.')).then(onClose)}>
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

const KEEP: Array<{ value: 7 | 30 | 90 | 0; label: string }> = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 0, label: 'Headers only' },
];

const PART_BG: Record<string, string> = { messages: 'bg-primary', lists: 'bg-[var(--ws-acct-teal)]', search: 'bg-warning', other: 'bg-ink-3' };

function Storage() {
  const boxes = useMailboxes();
  const sync = useSyncStatus(true);
  const stats = useMailStats();
  const prefs = useStore(app, (s) => s.prefs);
  const qc = useQueryClient();
  const [clearing, setClearing] = useState(false);
  const list = (boxes.data?.mailboxes ?? []).filter((b) => !b.archived);
  const copies = list.filter((b) => b.copy);
  const stored = copies.reduce((n, b) => n + (b.copy?.stored_bytes ?? 0), 0);
  const opens = copies.map((b) => b.copy?.opens_from_copy).filter((x): x is number => typeof x === 'number');
  const opened = opens.length ? opens.reduce((n, x) => n + x, 0) / opens.length : null;
  const mode = copies[0]?.copy ?? null;
  const s = stats.data ?? null;
  const byBox = prefs?.mailCacheDaysByMailbox ?? {};
  // The same Sync all as the folder pane: single-flight, three accounts at a time (DMO-SYN-02/12).
  const syncAll = async () => {
    const r = await runSync(includedIds(sync.data, list), { all: true, offline: app.get().status?.network === 'OFFLINE' });
    void qc.invalidateQueries({ queryKey: mailKeys.mailboxes });
    if (!r.started.length) return;
    toast(r.failed.length ? 'error' : 'success', r.failed.length ? text('{n} mailboxes could not be synced.', { n: r.failed.length }) : text('Every mailbox was synced.'));
    if (r.failed.length) throw new Error('sync failed');
  };
  const keep = (id: number, v: 7 | 30 | 90 | 0) => {
    const next = { ...byBox, [String(id)]: v };
    if (prefs && v === prefs.mailCacheDays) delete next[String(id)];
    void updatePrefs({ mailCacheDaysByMailbox: next });
  };
  const clearAll = () =>
    void call('offline:clearModule', { module: 'mail' })
      .then(() => {
        void qc.invalidateQueries({ queryKey: mailKeys.localStore });
        toast('success', text('Mail saved on this computer was removed.'));
        setClearing(false);
      })
      .catch((e) => toast('error', errorMessage(e)));
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-ink">Storage & sync</h2>
        <SyncButton label={text('Sync all now')} onSync={syncAll} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <section aria-label="On this computer" className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-[18px]">
          <div className="flex items-baseline gap-2">
            <h3 className="flex-1 text-[14.5px] font-bold text-ink">On this computer</h3>
            <b className="font-mono text-[13px] text-ink">{bytes(s?.total ?? 0)}</b>
            {s?.limitBytes ? <span className="text-[12.5px] text-ink-3">{text('of {size} limit', { size: bytes(s.limitBytes) })}</span> : null}
          </div>
          {s ? (
            <>
              <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-subtle">
                {storeParts(s).map((p) => (
                  <span key={p.key} className={PART_BG[p.key]} style={{ width: `${p.percent}%` }} />
                ))}
              </div>
              <ul role="list" className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] text-ink-2">
                {storeParts(s).map((p) => (
                  <li key={p.key} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span aria-hidden className={cx('h-2 w-2 rounded-[2px]', PART_BG[p.key])} />
                    {p.label} {bytes(p.bytes)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="text-[12px] text-ink-3">Encrypted with a key kept in your system keychain. Removed when you sign out.</p>
        </section>
        <section aria-label="In WorkSuite storage" className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-[18px]">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-[14.5px] font-bold text-ink">In WorkSuite storage</h3>
            {mode ? <Chip tone="success">{text('Set by your admin')}</Chip> : null}
          </div>
          {mode ? (
            <>
              <p className="text-[13px] leading-relaxed text-ink-2">{text('Your organization keeps a copy of {what} on the WorkSuite server, so mail opens fast on every device and while a provider is down.', { what: copyWords(mode.copy_mode, mode.window_months) })}</p>
              <div className="flex gap-5 text-[12px]">
                <span className="flex flex-col">
                  <span className="text-ink-3">Your mailboxes</span>
                  <b className="font-mono text-[15px] text-ink">{bytes(stored)}</b>
                </span>
                <span className="flex flex-col">
                  <span className="text-ink-3">Opened from copy</span>
                  <b className="font-mono text-[15px] text-ink">{opened === null ? '—' : `${(opened * 100).toFixed(1)}%`}</b>
                </span>
                <span className="flex flex-col">
                  <span className="text-ink-3">Counts against</span>
                  <b className="text-[13px] text-ink">Organization, not your Files</b>
                </span>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-3">Your organization does not keep a copy of this mail on the WorkSuite server.</p>
          )}
        </section>
      </div>
      {list.length ? (
        <table className="mt-5 w-full overflow-hidden rounded-[12px] border border-line bg-surface text-left text-[13px]">
          <thead className="bg-subtle text-[11.5px] text-ink-3">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-bold">Mailbox</th>
              <th className="px-4 py-2 font-bold">New mail</th>
              <th className="w-[180px] px-4 py-2 font-bold">Keep on this computer</th>
              <th className="px-4 py-2 font-bold">On the server</th>
              <th className="px-4 py-2 text-right font-bold">Size here</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => {
              const sm = sync.data?.mailboxes.find((m) => m.mailbox === b.id);
              const w = syncWords(b, sm);
              const days = (byBox[String(b.id)] ?? prefs?.mailCacheDays ?? 30) as 7 | 30 | 90 | 0;
              return (
                <tr key={b.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <AccountAvatar letter={mailboxLetter(b)} colour={b.colour} size={26} className="rounded-[7px]" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{b.email}</span>
                        <span className="block truncate text-[11.5px] text-ink-3">{b.account_type === 'local_mailbox' ? text('WorkSuite Local') : b.shared ? text('Shared mailbox') : (b.provider_label ?? '')}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className={cx('h-2 w-2 rounded-full', w.tone === 'success' ? 'bg-success' : w.tone === 'danger' || w.tone === 'warning' ? 'bg-warning' : 'bg-ink-3')} />
                      {w.label}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <Select aria-label={text('Keep {email} on this computer', { email: b.email })} value={days} options={KEEP.map((k) => ({ ...k, label: text(k.label) }))} onValueChange={(v) => keep(b.id, v as 7 | 30 | 90 | 0)} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-ink-2">{b.copy ? bytes(b.copy.stored_bytes) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink">{bytes(s?.byMailbox[String(b.id)]?.bytes ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-3 text-[13px]">
        <span className="flex-1 text-ink-2">Short on disk space? Choose a shorter keep period above; older mail stays searchable on the server and downloads when you open it. Each folder can also keep recent messages, headers only or nothing (right-click it › On this computer): Inbox, Sent and Drafts keep recent mail, Archive is online only, other folders keep headers.</span>
        {clearing ? (
          <Button size="sm" variant="danger" onClick={clearAll}>
            Clear everything now
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setClearing(true)}>
            Clear everything
          </Button>
        )}
      </div>
    </>
  );
}

function Layout() {
  const { prefs, set } = useMailPrefs();
  // Pull to refresh (worksuite-desktop#236): kept on this computer, on unless turned off.
  const pull = useStore(pullPrefs, (s) => !s.off.mail);
  const theme = useStore(app, (s) => s.prefs?.theme ?? 'system');
  const desktopPrefs = useStore(app, (s) => s.prefs);
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
      <h2 className="mb-4 text-[20px] font-bold text-ink">Appearance & reading</h2>
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
      <label className="mt-3 flex items-center gap-2.5 text-[13.5px] text-ink">
        <Checkbox checked={desktopPrefs?.highContrast === true} onChange={(e) => void updatePrefs({ highContrast: e.target.checked })} />
        {text('High contrast')}
      </label>
      <section aria-label="Mail layout" className="mt-4 rounded-[12px] border border-line bg-surface p-4">
        <h3 className="text-[15px] font-bold text-ink">Mail layout</h3>
        {seg('pane', prefs.pane, 'right', [['right', 'Right'], ['bottom', 'Bottom'], ['hidden', 'Off']], 'Reading pane')}
        {seg('view', prefs.view, 'compact', [['classic', 'Classic'], ['compact', 'Compact'], ['super', 'Super compact'], ['table', 'Full list']], 'Density')}
        {seg('zoom', prefs.zoom, 100, [[90, 'Small'], [100, 'Default'], [120, 'Large']], 'Text size')}
        {seg('toolbar', prefs.toolbar, 'docked', [['docked', 'Docked'], ['floating', 'Floating'], ['compact', 'Compact'], ['minimal', 'Minimal']], 'Action bar')}
        <p className="mt-2 text-[12px] text-ink-3">Kept with your WorkSuite account, so every computer you use shows Mail the same way.</p>
      </section>
      <section aria-label="Reading" className="mt-4 flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4 text-[13.5px] text-ink">
        <h3 className="text-[15px] font-bold text-ink">Reading</h3>
        <label className="flex items-center gap-2.5">
          <Checkbox checked={prefs.tabs !== false} onChange={(e) => set({ tabs: e.target.checked })} />
          Open messages in tabs
        </label>
        <label className="flex items-center gap-2.5">
          <Checkbox checked={prefs.previews !== false} onChange={(e) => set({ previews: e.target.checked })} />
          Show message previews in the list
        </label>
        <label className="flex items-center gap-2.5">
          <Checkbox checked={prefs.headerIcons === 'more'} onChange={(e) => set({ headerIcons: e.target.checked ? 'more' : 'few' })} />
          {text('Show more buttons in the message header')}
        </label>
        {/* Emails in dark mode (#287): decided per email under Automatic; ☀ / 🌙 in a message's header overrides it for its sender. */}
        {seg('bodyTheme', prefs.bodyTheme, 'auto', [['auto', 'Automatic'], ['light', 'Always light'], ['dark', 'Always dark']], 'Show emails in dark mode')}
        <p className="-mt-2 text-[12px] leading-relaxed text-ink-3">{text('Automatic follows the theme: plain emails take the app’s colours, designed ones their own dark style or a careful darkening, and an email that would not read well stays light on a soft card. ☀ or 🌙 above a message changes it for that sender.')}</p>
        {seg('markRead', prefs.markRead, 'open', [['open', 'When opened'], ['delay', 'After a few seconds'], ['change', 'When I move on'], ['never', 'Never']], 'Mark as read')}
        {prefs.markRead === 'delay' ? seg('markReadDelay', prefs.markReadDelay, 5, [[0, '0 s'], [5, '5 s'], [10, '10 s'], [30, '30 s']], 'After') : null}
        {seg('openIn', prefs.openIn, 'tabs', [['tabs', 'Tabs'], ['windows', 'Windows'], ['both', 'Both']], 'Open messages in')}
        {/* Which account a message came to, on the rows of the combined views (#227); each account's own label and colour are under Accounts. */}
        {seg('accountTag', prefs.accountTag, 'name', [['name', 'Name tag'], ['dot', 'Dot only'], ['off', 'Off']], 'Account tag')}
        <SwitchRow label={text('Pull to refresh')} hint={text('At the top of the mail list, scroll or pull down a little further to check for new mail.')} checked={pull} onChange={(v) => setPullEnabled('mail', v)} />
      </section>
      <InboxAndKeyboard prefs={prefs} set={set} />
      <FormattingSettings prefs={prefs} set={set} />
      <section aria-label={text('Catch up')} className="mt-4 flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4 text-[13.5px] text-ink">
        <SwitchRow label={text('Catch up after time away')} hint={text('Back after eight hours or more: unread mail from VIPs, mail that mentions you and flags due, at the top of Mail.')} checked={prefs.catchUp !== false} onChange={(v) => set({ catchUp: v })} />
      </section>
    </>
  );
}

/** Focused Inbox, the keyboard scheme and the command bar (DMO-INB-01, DMO-KEY-01, DMO-SHL-03; §9.1). */
function InboxAndKeyboard({ prefs, set }: { prefs: MailPrefs; set: (p: Partial<MailPrefs>) => void }) {
  const boxes = (useMailboxes().data?.mailboxes ?? []).filter((b) => !b.archived);
  const off = prefs.focusedOff ?? [];
  return (
    <section aria-label={text('Inbox and keyboard')} className="mt-4 flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4 text-[13.5px] text-ink">
      <h3 className="text-[15px] font-bold text-ink">{text('Inbox and keyboard')}</h3>
      <SwitchRow label={text('Show setup tips')} hint={text('The banner above the mail list with the steps left to set up Mail: import email, add a signature, make WorkSuite the default mail app.')} checked={prefs.firstRun === 'outlook'} onChange={(v) => set({ firstRun: v ? 'outlook' : 'done' })} />
      <SwitchRow label={text('Focused Inbox')} hint={text('Sort the inbox into Focused and Other. Moving a message between the tabs teaches it.')} checked={prefs.focused !== false} onChange={(v) => set({ focused: v })} />
      {prefs.focused !== false && boxes.length > 1 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-1">
          {boxes.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-[12.5px]">
              <Checkbox checked={!off.includes(b.id)} onChange={(e) => set({ focusedOff: e.target.checked ? off.filter((x) => x !== b.id) : [...off, b.id] })} />
              {b.email}
            </label>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4 py-1">
        <span className="font-semibold">{text('Keyboard shortcuts')}</span>
        <div role="radiogroup" aria-label={text('Keyboard scheme')} className="flex rounded-[10px] bg-subtle p-0.5">
          {(['worksuite', 'outlook', 'gmail'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={(prefs.keyScheme ?? 'worksuite') === s} onClick={() => set({ keyScheme: s })} className={cx('h-8 rounded-[8px] px-3 text-[13px] font-semibold', (prefs.keyScheme ?? 'worksuite') === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
              {s === 'worksuite' ? 'WorkSuite' : s === 'outlook' ? 'Outlook' : 'Gmail'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-ink-3">{text('Press ? (or Ctrl+/ in the Outlook scheme) in Mail to see every shortcut and change any of them.')}</p>
      <div className="flex items-center justify-between gap-4 py-1">
        <span className="font-semibold">{text('Command bar')}</span>
        <div role="radiogroup" aria-label={text('Command bar')} className="flex rounded-[10px] bg-subtle p-0.5">
          {(['simplified', 'classic'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={(prefs.commandBar ?? 'simplified') === s} onClick={() => set({ commandBar: s })} className={cx('h-8 rounded-[8px] px-3 text-[13px] font-semibold', (prefs.commandBar ?? 'simplified') === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
              {s === 'simplified' ? text('Simplified') : text('Classic')}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 py-1">
        <span className="font-semibold">{text('When someone asks for a read receipt')}</span>
        <Select
          aria-label={text('Read receipts')}
          value={prefs.readReceipts ?? 'ask'}
          options={[
            { value: 'ask', label: text('Ask me each time') },
            { value: 'always', label: text('Always send one') },
            { value: 'never', label: text('Never send one') },
          ]}
          onValueChange={(v) => set({ readReceipts: v as 'ask' | 'always' | 'never' })}
          className="h-8 w-[200px]"
        />
      </div>
    </section>
  );
}
