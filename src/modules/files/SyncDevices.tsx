import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SyncDevice, SyncFolder, SyncMode, SyncPolicy, SyncStatus } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage, platform } from '../../core/bridge';
import { useStore } from '../../core/store';
import { bytes, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import type { TreeNode } from './api';
import { ConfirmDialog, NameDialog } from './Dialogs';
import { PopMenu, below, type MenuItem } from './Menu';
import { computerWord, hereLabel, revealLabel, useSync } from './sync';

/**
 * Sync devices (the Drive designs' "Sync devices"): the computers and phones
 * that keep Drive files, the company's sync policy, and — on this computer —
 * which Drive folders are kept here, how, and how each is doing.
 *
 * Everything that touches this computer goes through the main process: the
 * page names Drive folders and asks; a place on disk is only ever chosen in
 * the system's own folder dialog.
 */

const card = 'rounded-[14px] border border-line bg-surface';
const label = 'text-[11px] font-bold tracking-[0.6px] text-ink-2';

const MODES: Array<{ value: SyncMode; label: string; hint: string }> = [
  { value: 'two_way', label: 'Two-way', hint: 'Changes on either side reach the other.' },
  { value: 'upload_only', label: 'Upload only', hint: 'Drive follows this computer. Changes made in Drive are not brought down.' },
  { value: 'download_only', label: 'Download only', hint: 'This computer follows Drive. Changes made here are not sent up.' },
];

function run(fn: () => Promise<unknown>, done?: string): void {
  fn().then(
    () => done && toast('success', done),
    (e) => toast('error', errorMessage(e)),
  );
}

export function SyncDevices({ tree, ask, onAsked }: { tree: TreeNode[]; ask: number | 'all' | null; onAsked: () => void }) {
  const sync = useSync();
  const [adding, setAdding] = useState<{ preselect: number | 'all' | null } | null>(null);
  // A folder's "Keep on this computer" arrives as ?sync=<id>: opened once per ask.
  const [asked, setAsked] = useState<number | 'all' | null>(null);
  if (ask !== null && ask !== asked) {
    setAsked(ask);
    setAdding({ preselect: ask });
  }
  const close = () => {
    setAdding(null);
    onAsked();
  };
  return (
    <main aria-label="Sync devices" className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-ground px-7 py-5 scroll-thin">
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-bold text-ink">Sync devices</h1>
          <span className="text-[13px] text-ink-3">Computers and phones that keep your Drive files. Signing one out stops it syncing; wiping it removes its synced copy — never your other files.</span>
        </div>
        {sync?.available && sync.folders.length ? (
          <Button variant="primary" icon="refresh" onClick={() => run(() => call('sync:now'))} disabled={sync.state === 'syncing'}>
            Sync now
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <Devices sync={sync} />
        <PolicyCard />
      </div>
      <ThisComputer sync={sync} onChoose={() => setAdding({ preselect: null })} />
      {adding ? <ChooseFolders tree={tree} sync={sync} preselect={adding.preselect} onClose={close} /> : null}
    </main>
  );
}

// ── the devices ──────────────────────────────────────────────────────────

function Devices({ sync }: { sync: SyncStatus | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'sync-devices'], queryFn: () => call('sync:devices'), refetchInterval: 60_000 });
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: string; run: () => void } | null>(null);
  const [rename, setRename] = useState<SyncDevice | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; d: SyncDevice } | null>(null);
  const act = (d: SyncDevice, action: 'rename' | 'sign-out' | 'wipe' | 'remove', name?: string) =>
    call('sync:deviceAction', { id: d.id, action, ...(name ? { name } : {}) }).then(() => void qc.invalidateQueries({ queryKey: ['files', 'sync-devices'] }));
  const devices = (q.data?.devices ?? []).filter((d) => d.status !== 'wiped');
  const mine = q.data?.thisDevice ?? null;
  const signOut = (d: SyncDevice) =>
    setConfirm({ title: `Sign out ${d.name}?`, body: `${d.name} stops syncing at once. The files already on it stay there until it is wiped or they are deleted.`, action: 'Sign out', run: () => run(() => act(d, 'sign-out'), `${d.name} is signed out of sync`) });
  const menuItems = (d: SyncDevice): MenuItem[] =>
    [
      { label: 'Rename…', icon: 'compose', run: () => setRename(d) },
      d.id !== mine && d.status !== 'wipe_pending'
        ? { label: 'Wipe its synced copy…', icon: 'trash', danger: true, run: () => setConfirm({ title: `Wipe ${d.name}?`, body: `The next time ${d.name} connects, it removes the files it synced from Drive and signs out of sync. Files it did not sync are left alone. Your Drive is not touched.`, action: 'Wipe', run: () => run(() => act(d, 'wipe'), `${d.name} will remove its synced copy`) }) }
        : null,
      d.id !== mine ? { label: 'Remove from this list', icon: 'x', run: () => setConfirm({ title: `Remove ${d.name}?`, body: `${d.name} stops syncing and is removed from your devices. Files already on it stay there.`, action: 'Remove', run: () => run(() => act(d, 'remove')) }) } : null,
    ].filter(Boolean) as MenuItem[];

  return (
    <section aria-label="Your devices" className={cx(card, 'min-w-[520px] flex-[2]')}>
      {q.isLoading ? <Spinner /> : null}
      {q.error && !q.data ? <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
      {q.isSuccess && !devices.length ? <div className="px-5 py-10 text-center text-[13px] text-ink-3">No devices sync your Drive yet.</div> : null}
      {devices.map((d, i) => {
        const self = d.id === mine;
        const pill = self ? selfPill(sync) : otherPill(d);
        const phone = d.platform === 'ios' || d.platform === 'android';
        return (
          <div key={d.id} className={cx('grid grid-cols-[48px_minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_auto] items-center gap-3 px-5 py-4', i > 0 && 'border-t border-line')}>
            <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-subtle text-ink-2"><Icon name={phone ? 'mobile' : 'laptop'} size={20} /></span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[15px] font-bold text-ink">{d.name}</span>
              {self ? <span className="w-fit rounded-[6px] bg-success-bg px-1.5 py-0.5 text-[11.5px] font-bold text-success">This device</span> : null}
              <span className="text-[12.5px] text-ink-3">{[osWords(d), d.appVersion ? `${phone ? 'WorkSuite' : 'WorkSuite Desktop'} ${d.appVersion.replace(/^WorkSuite( Desktop)? /, '')}` : null].filter(Boolean).join(' · ')}</span>
            </div>
            <span><span className={cx('inline-flex rounded-[8px] px-2 py-1 text-[12.5px] font-bold', pill.tone)}>{pill.text}</span></span>
            <span className="truncate text-[13px] text-ink-2">{self ? selfSummary(sync) : otherSummary(d)}</span>
            <span className="flex items-center gap-3">
              <Button onClick={(e) => setMenu({ at: below(e.currentTarget, 'right'), d })}>Manage</Button>
              {!self && d.status !== 'disconnected' && d.status !== 'wipe_pending' ? (
                <button type="button" onClick={() => signOut(d)} className="text-[13px] font-semibold text-danger hover:underline">Sign out</button>
              ) : (
                <span className="w-[54px]" />
              )}
            </span>
          </div>
        );
      })}
      {menu ? <PopMenu at={menu.at} items={menuItems(menu.d)} label={`Manage ${menu.d.name}`} onClose={() => setMenu(null)} /> : null}
      {confirm ? <ConfirmDialog title={confirm.title} body={confirm.body} action={confirm.action} danger onClose={() => setConfirm(null)} onYes={confirm.run} /> : null}
      {rename ? <NameDialog title="Rename device" initial={rename.name} action="Rename" onClose={() => setRename(null)} onSave={async (name) => void (await act(rename, 'rename', name))} /> : null}
    </section>
  );
}

function osWords(d: SyncDevice): string | null {
  const os = d.osVersion ?? '';
  if (/^Darwin/i.test(os)) return 'macOS';
  if (/^Windows_NT/i.test(os)) return 'Windows';
  return os || ({ macos: 'macOS', windows: 'Windows', linux: 'Linux', ios: 'iOS', android: 'Android' } as Record<string, string>)[d.platform] || null;
}

function daysSince(stamp: string | null): number | null {
  if (!stamp) return null;
  const t = new Date(stamp.replace(' ', 'T') + (stamp.includes('T') ? '' : 'Z')).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000);
}

function selfPill(s: SyncStatus | null): { text: string; tone: string } {
  const ok = 'bg-success-bg text-success';
  const blue = 'bg-selection text-primary';
  const grey = 'bg-subtle text-ink-2';
  const warn = 'bg-warning-bg text-warning';
  if (!s?.available) return { text: 'Online only', tone: grey };
  if (!s.folders.length) return { text: 'No folders synced', tone: grey };
  const pending = s.folders.reduce((n, f) => n + f.pending.up + f.pending.down, 0);
  switch (s.state) {
    case 'syncing':
      return { text: pending ? `Syncing ${pending.toLocaleString()} ${pending === 1 ? 'item' : 'items'}` : 'Syncing…', tone: blue };
    case 'paused':
      return { text: 'Paused', tone: grey };
    case 'offline':
      return { text: 'Waiting for the server', tone: grey };
    case 'error':
    case 'disconnected':
    case 'blocked':
      return { text: 'Needs attention', tone: warn };
    default:
      return s.lastSyncAt ? { text: `Up to date · ${relative(s.lastSyncAt)}`, tone: ok } : { text: 'Starting…', tone: blue };
  }
}

function otherPill(d: SyncDevice): { text: string; tone: string } {
  if (d.status === 'wipe_pending') return { text: 'Wipe pending', tone: 'bg-danger-bg text-danger' };
  if (d.status === 'disconnected') return { text: 'Signed out', tone: 'bg-subtle text-ink-2' };
  if (d.status === 'paused') return { text: 'Paused', tone: 'bg-subtle text-ink-2' };
  const days = daysSince(d.lastSeenAt);
  if (days !== null && days >= 14) return { text: `Not seen for ${days} days`, tone: 'bg-warning-bg text-warning' };
  if (d.lastSyncAt) return { text: `Synced ${relative(d.lastSyncAt)}`, tone: 'bg-success-bg text-success' };
  return { text: d.lastSeenAt ? `Seen ${relative(d.lastSeenAt)}` : 'Never connected', tone: 'bg-subtle text-ink-2' };
}

function selfSummary(s: SyncStatus | null): string {
  if (!s?.folders.length) return '—';
  const n = s.folders.length;
  const size = s.folders.reduce((a, f) => a + f.bytes, 0);
  return `${n} ${n === 1 ? 'folder' : 'folders'} · ${bytes(size)}`;
}

function otherSummary(d: SyncDevice): string {
  if (!d.fileCount && !d.storageUsed) return '—';
  return `${d.fileCount.toLocaleString()} ${d.fileCount === 1 ? 'file' : 'files'} · ${bytes(d.storageUsed)}`;
}

// ── the company's policy ─────────────────────────────────────────────────

function PolicyCard() {
  const q = useQuery({ queryKey: ['files', 'sync-devices'], queryFn: () => call('sync:devices'), refetchInterval: 60_000 });
  const desk = useStore(app, (s) => s.bootstrap?.policy ?? null);
  const p: SyncPolicy | null = q.data?.policy ?? null;
  const rows: Array<[string, string]> = [];
  if (p) {
    rows.push(['Largest file synced', p.max_file_bytes > 0 ? bytes(p.max_file_bytes) : 'No limit']);
    rows.push(['File types never synced', p.blocked_types.length ? p.blocked_types.map((t) => `.${t.replace(/^\./, '')}`).join(', ') : 'None']);
    if (p.ignored_patterns.length) rows.push(['Always left out', p.ignored_patterns.join(', ')]);
    if (p.upload_kbps || p.download_kbps) rows.push(['Speed limit', [p.upload_kbps ? `up ${bytes(p.upload_kbps * 1024)}/s` : null, p.download_kbps ? `down ${bytes(p.download_kbps * 1024)}/s` : null].filter(Boolean).join(' · ')]);
    rows.push(['Devices per person', p.max_devices > 0 ? String(p.max_devices) : 'No limit']);
  }
  if (desk) {
    rows.push(['Personal devices', desk.personal_device_mode === 'full' ? 'Files kept offline' : desk.personal_device_mode === 'blocked' ? 'Not allowed' : 'Online-only files']);
    rows.push(['External disks', desk.removable_media_sync ? 'Allowed' : 'Not allowed']);
  }
  rows.push(['Conflicts', 'Keep both copies']);
  if (desk) rows.push(['Wipe on sign-out', desk.wipe_on_revoke === 'cache+offline_files' ? 'WorkSuite folder only' : desk.wipe_on_revoke === 'cache' ? 'Cached data only' : 'Sign-in only']);
  return (
    <section aria-label="Company sync policy" className={cx(card, 'flex min-w-[320px] flex-1 flex-col gap-3 px-5 py-4')}>
      <div className="flex items-center gap-2">
        <span className={cx(label, 'flex-1')}>COMPANY SYNC POLICY</span>
        <span className="rounded-[8px] bg-subtle px-2 py-1 text-[11.5px] font-semibold text-ink-2">Set by admin</span>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 text-[13px]">
          <span className="text-ink-3">{k}</span>
          <span className="font-semibold break-words text-ink">{v}</span>
        </div>
      ))}
    </section>
  );
}

// ── this computer ────────────────────────────────────────────────────────

function ThisComputer({ sync, onChoose }: { sync: SyncStatus | null; onChoose: () => void }) {
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: string; danger?: boolean; run: () => void } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const title = hereLabel().toUpperCase();
  if (!sync) return null;
  if (!sync.available) {
    return (
      <section aria-label={hereLabel()} className={cx(card, 'flex items-center gap-3 px-5 py-4')}>
        <Icon name="cloud" size={20} className="text-ink-3" />
        <div className="flex flex-1 flex-col">
          <span className={label}>{title}</span>
          <span className="text-[13px] text-ink-2">{sync.reason ?? 'Drive sync is not available on this computer.'} Your files stay available online.</span>
        </div>
      </section>
    );
  }
  const total = sync.folders.reduce((a, f) => a + f.bytes, 0);
  return (
    <section aria-label={hereLabel()} className={cx(card, 'flex flex-col')}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={label}>{title}</span>
          <div className="flex flex-wrap gap-x-7 gap-y-1 text-[13.5px] text-ink-2">
            <span>Folder: <b className="font-mono text-[13px] text-ink">{sync.defaultRoot.replace(/^\/Users\/[^/]+|^[A-Z]:\\Users\\[^\\]+|^\/home\/[^/]+/, '~')}</b></span>
            <span>Kept offline: <b className="text-ink">{sync.folders.length ? sync.folders.map((f) => f.folderName).join(', ') : 'nothing yet'}</b></span>
            <span>On disk: <b className="text-ink">{bytes(total)}</b></span>
          </div>
        </div>
        <Button icon="folder-plus" onClick={onChoose}>Choose folders</Button>
        {sync.folders.length ? (
          <Button icon={sync.paused ? 'play' : 'pause'} onClick={() => run(() => call('sync:pause', { id: null, paused: !sync.paused }), sync.paused ? 'Sync resumed' : 'Sync paused')}>
            {sync.paused ? 'Resume sync' : 'Pause sync'}
          </Button>
        ) : null}
      </div>
      {sync.state === 'disconnected' || sync.state === 'blocked' || (sync.message && sync.state !== 'idle' && sync.state !== 'syncing') ? (
        <div className="mx-5 mb-3 flex items-center gap-3 rounded-[10px] bg-warning-bg px-3.5 py-2.5 text-[13px] text-warning">
          <Icon name="warning" size={16} className="shrink-0" />
          <span className="flex-1">{sync.message ?? 'Drive sync needs attention.'}</span>
          {sync.state === 'disconnected' ? <Button size="sm" onClick={() => run(() => call('sync:reconnect'), 'This computer is connected to Drive sync again')}>Reconnect</Button> : null}
        </div>
      ) : null}
      {!sync.folders.length ? (
        <div className="flex flex-col items-center gap-2 border-t border-line px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-selection text-primary"><Icon name="laptop" size={22} /></span>
          <b className="text-[14px] text-ink">Keep Drive folders on this {computerWord()}</b>
          <span className="max-w-[460px] text-[12.5px] text-ink-3">Choose folders and they are kept in step with a folder here: work on the files offline, in any app, and changes go both ways. Only what changed travels.</span>
          <Button variant="primary" icon="folder-plus" onClick={onChoose}>Choose folders</Button>
        </div>
      ) : null}
      {sync.folders.map((f) => (
        <FolderRow key={f.id} f={f} expanded={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} ask={setConfirm} />
      ))}
      {sync.activity.length ? <Activity sync={sync} /> : null}
      {confirm ? <ConfirmDialog title={confirm.title} body={confirm.body} action={confirm.action} danger={confirm.danger} onClose={() => setConfirm(null)} onYes={confirm.run} /> : null}
    </section>
  );
}

function folderState(f: SyncFolder): { text: string; tone: string; icon: string } {
  if (f.paused) return { text: 'Paused', tone: 'text-ink-3', icon: 'pause' };
  if (f.error) return { text: 'Stopped — see below', tone: 'text-danger', icon: 'warning' };
  if (f.heldDeletions) return { text: 'Waiting for you', tone: 'text-warning', icon: 'warning' };
  if (f.state === 'scanning') return { text: 'Checking for changes…', tone: 'text-primary', icon: 'refresh' };
  if (f.state === 'syncing') {
    const n = f.pending.up + f.pending.down;
    return { text: n ? `Syncing ${n.toLocaleString()} ${n === 1 ? 'item' : 'items'}` : 'Syncing…', tone: 'text-primary', icon: 'refresh' };
  }
  if (f.state === 'waiting') return { text: 'Waiting for the server', tone: 'text-ink-3', icon: 'cloud-off' };
  if (!f.lastSyncAt) return { text: 'Starting…', tone: 'text-primary', icon: 'refresh' };
  return { text: `Up to date · ${relative(f.lastSyncAt)}`, tone: 'text-success', icon: 'check-circle' };
}

function FolderRow({ f, expanded, onToggle, ask }: { f: SyncFolder; expanded: boolean; onToggle: () => void; ask: (c: { title: string; body: string; action: string; danger?: boolean; run: () => void }) => void }) {
  const st = folderState(f);
  const problems = f.issues.length;
  return (
    <div className="flex flex-col gap-2 border-t border-line px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-selection text-primary"><Icon name="folder" size={18} /></span>
        <div className="flex min-w-[220px] flex-1 flex-col">
          <span className="flex items-center gap-2 text-[14px] font-bold text-ink">
            {f.folderName}
            <Icon name="arrow-down" size={12} className="-rotate-90 text-ink-3" />
            <span className="truncate font-mono text-[12.5px] font-medium text-ink-2">{f.localPath.replace(/^\/Users\/[^/]+|^[A-Z]:\\Users\\[^\\]+|^\/home\/[^/]+/, '~')}</span>
          </span>
          <span className={cx('flex items-center gap-1.5 text-[12.5px]', st.tone)}>
            <Icon name={st.icon} size={13} className={cx(st.icon === 'refresh' && 'animate-spin-slow')} />
            {st.text}
            <span className="text-ink-3">· {f.files.toLocaleString()} {f.files === 1 ? 'file' : 'files'} · {bytes(f.bytes)}</span>
          </span>
        </div>
        <Select<SyncMode>
          aria-label={`How ${f.folderName} syncs`}
          value={f.mode}
          options={MODES.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))}
          onValueChange={(mode) => run(() => call('sync:setMode', { id: f.id, mode }), `${f.folderName}: ${MODES.find((m) => m.value === mode)?.label}`)}
          className="h-8 w-[150px] rounded-[8px] border border-line bg-surface px-2 text-[13px]"
        />
        <Button size="sm" icon="folder-open" onClick={() => run(() => call('sync:reveal', { syncFolderId: f.id }))}>{revealLabel()}</Button>
        <Button size="sm" icon={f.paused ? 'play' : 'pause'} onClick={() => run(() => call('sync:pause', { id: f.id, paused: !f.paused }))}>{f.paused ? 'Resume' : 'Pause'}</Button>
        <button
          type="button"
          className="text-[12.5px] font-semibold text-danger hover:underline"
          onClick={() => ask({ title: `Stop syncing ${f.folderName}?`, body: `Nothing is deleted: the files stay in ${f.localPath} and in Drive, but changes stop going between them.`, action: 'Stop syncing', danger: true, run: () => run(() => call('sync:remove', { id: f.id }), `${f.folderName} is no longer synced`) })}
        >
          Stop syncing
        </button>
      </div>
      {f.error ? (
        <div className="flex items-start gap-2 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <Icon name="warning" size={15} className="mt-px shrink-0" />
          <span className="flex-1">{f.error}</span>
        </div>
      ) : null}
      {f.heldDeletions ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-warning-bg px-3 py-2.5 text-[12.5px] text-warning">
          <Icon name="warning" size={15} className="shrink-0" />
          <span className="min-w-[260px] flex-1">
            {f.heldDeletions.side === 'drive'
              ? `${f.heldDeletions.count.toLocaleString()} files were deleted from this ${computerWord()}. Sync has not deleted them from Drive yet — was that meant?`
              : `${f.heldDeletions.count.toLocaleString()} files were deleted in Drive. Sync has not deleted them from this ${computerWord()} yet — was that meant?`}
          </span>
          <Button size="sm" variant="danger" onClick={() => run(() => call('sync:resolve', { id: f.id, choice: 'apply' }))}>{f.heldDeletions.side === 'drive' ? 'Delete them in Drive too' : `Delete them here too`}</Button>
          <Button size="sm" onClick={() => run(() => call('sync:resolve', { id: f.id, choice: 'restore' }))}>{f.heldDeletions.side === 'drive' ? 'Bring them back here' : 'Put them back in Drive'}</Button>
        </div>
      ) : null}
      {problems ? (
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink">
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />
          {problems.toLocaleString()} {problems === 1 ? 'item needs' : 'items need'} a look
        </button>
      ) : null}
      {expanded && problems ? (
        <ul className="flex flex-col gap-1 rounded-[10px] bg-ground px-3 py-2 text-[12.5px]">
          {f.issues.map((i, n) => (
            <li key={`${i.path}-${n}`} className="flex gap-2">
              <Icon name={i.kind === 'conflict' ? 'copy' : i.kind === 'error' ? 'warning' : 'info'} size={13} className={cx('mt-0.5 shrink-0', i.kind === 'error' ? 'text-danger' : i.kind === 'conflict' ? 'text-warning' : 'text-ink-3')} />
              <span className="min-w-0 flex-1">
                <b className="font-mono text-[12px] break-all text-ink">{i.path || f.folderName}</b> <span className="text-ink-2">{i.message}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const ACTIVITY_WORDS: Record<string, string> = {
  uploaded: 'Sent to Drive',
  downloaded: 'Brought here',
  'deleted-here': `Deleted here`,
  'deleted-in-drive': 'Deleted in Drive',
  moved: 'Moved or renamed',
  conflict: 'Both copies kept',
  folder: 'Folder made',
};

function Activity({ sync }: { sync: SyncStatus }) {
  const [more, setMore] = useState(false);
  const names = new Map(sync.folders.map((f) => [f.id, f.folderName]));
  const rows = sync.activity.slice(0, more ? 50 : 6);
  return (
    <div className="flex flex-col gap-1.5 border-t border-line px-5 py-3.5">
      <span className={label}>RECENT ACTIVITY</span>
      {rows.map((a, i) => (
        <div key={`${a.at}-${i}`} className="grid grid-cols-[140px_minmax(0,1fr)_90px] gap-3 text-[12.5px]">
          <span className="text-ink-2">{ACTIVITY_WORDS[a.action] ?? a.action}</span>
          <span className="truncate font-mono text-[12px] text-ink" title={a.path}>{names.get(a.folderId) ?? ''}/{a.path}</span>
          <span className="text-right text-ink-3">{relative(a.at)}</span>
        </div>
      ))}
      {sync.activity.length > 6 ? (
        <button type="button" onClick={() => setMore(!more)} className="w-fit text-[12.5px] font-semibold text-primary hover:underline">{more ? 'Show less' : 'Show more'}</button>
      ) : null}
    </div>
  );
}

// ── choosing folders ─────────────────────────────────────────────────────

function flatten(nodes: TreeNode[], depth = 0, above: number[] = []): Array<{ n: TreeNode; depth: number; above: number[] }> {
  return nodes.flatMap((n) => [{ n, depth, above }, ...flatten(n.children, depth + 1, [...above, n.id])]);
}

function ChooseFolders({ tree, sync, preselect, onClose }: { tree: TreeNode[]; sync: SyncStatus | null; preselect: number | 'all' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const synced = new Set((sync?.folders ?? []).map((f) => (f.folderId === null ? 'all' : f.folderId)));
  const [picked, setPicked] = useState<Set<number | 'all'>>(() => new Set(preselect !== null && !synced.has(preselect) ? [preselect] : []));
  const [mode, setMode] = useState<SyncMode>('two_way');
  const [busy, setBusy] = useState(false);
  const rows = flatten(tree);
  const all = synced.has('all');
  const pickedIds = [...picked].filter((x): x is number => x !== 'all');

  // Why a folder cannot be chosen, if it cannot.
  const refusal = (r: { n: TreeNode; above: number[] }): string | null => {
    if (synced.has(r.n.id)) return 'Synced';
    if (all) return 'Synced with My Drive';
    if (r.n.access && r.n.access.owner === false) return 'Not yours';
    if (r.n.is_locked) return 'Locked';
    if (r.above.some((a) => synced.has(a))) return 'Inside a synced folder';
    if (r.above.some((a) => picked.has(a))) return 'Chosen with the folder above';
    if (picked.has('all')) return 'Chosen with My Drive';
    return null;
  };
  const toggle = (id: number | 'all') => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      if (id === 'all') {
        for (const x of [...next]) if (x !== 'all') next.delete(x);
      } else {
        // A folder chosen takes the ones chosen inside it along.
        for (const r of rows) if (r.above.includes(id)) next.delete(r.n.id);
      }
    }
    setPicked(next);
  };
  const start = async (choose: boolean) => {
    setBusy(true);
    let added = 0;
    try {
      for (const id of picked) {
        const r = await call('sync:add', { folderId: id === 'all' ? null : id, mode, choose });
        if (r) added++;
        else break; // the dialog was cancelled
      }
      if (added) {
        toast('success', added === 1 ? 'Syncing started' : `Syncing ${added} folders`);
        void qc.invalidateQueries({ queryKey: ['files', 'sync-devices'] });
        onClose();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const sepChar = platform === 'win32' ? '\\' : '/';
  const where = pickedIds.length === 1 && picked.size === 1 ? `${sync?.defaultRoot ?? ''}${sepChar}${rows.find((r) => r.n.id === pickedIds[0])?.n.name ?? ''}` : sync?.defaultRoot ?? '';
  return (
    <Modal
      title={`Choose folders to keep on this ${computerWord()}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={busy || picked.size !== 1} onClick={() => void start(true)} title="Sync into a folder you pick on this computer — it may already hold files; they are merged in">
            Choose where…
          </Button>
          <Button variant="primary" loading={busy} disabled={!picked.size} onClick={() => void start(false)}>
            {picked.size > 1 ? `Sync ${picked.size} folders` : 'Sync'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <span className="text-ink-2">Chosen folders are kept in step with <b className="font-mono text-[12.5px] text-ink">{where.replace(/^\/Users\/[^/]+|^[A-Z]:\\Users\\[^\\]+|^\/home\/[^/]+/, '~')}</b>. Only your own folders can be synced.</span>
        <div role="listbox" aria-label="Your folders" aria-multiselectable="true" className="flex max-h-[320px] flex-col overflow-y-auto rounded-[10px] border border-line py-1 scroll-thin">
          <PickRow label="All of My Drive" depth={0} checked={picked.has('all') || all} disabled={all ? 'Synced' : sync?.folders.length ? 'Some folders are synced one by one' : null} onToggle={() => toggle('all')} icon="disk" />
          {rows.map((r) => {
            const no = refusal(r);
            return <PickRow key={r.n.id} label={r.n.name} depth={r.depth + 1} checked={picked.has(r.n.id) || synced.has(r.n.id) || picked.has('all') || r.above.some((a) => picked.has(a) || synced.has(a))} disabled={no} onToggle={() => toggle(r.n.id)} icon={r.n.is_locked ? 'lock' : 'folder'} color={r.n.color} />;
          })}
          {!rows.length ? <span className="px-3 py-3 text-ink-3">You have no folders yet.</span> : null}
        </div>
        <label className="flex items-center gap-3">
          <span className="w-[110px] shrink-0 text-ink-2">Changes go</span>
          <Select<SyncMode> aria-label="How these folders sync" value={mode} options={MODES.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))} onValueChange={setMode} className="h-8 flex-1 rounded-[8px] border border-line bg-surface px-2" />
        </label>
        <span className="text-[12px] text-ink-3">{MODES.find((m) => m.value === mode)?.hint} If the same file changes in both places, both copies are kept.</span>
      </div>
    </Modal>
  );
}

function PickRow({ label: text, depth, checked, disabled, onToggle, icon, color }: { label: string; depth: number; checked: boolean; disabled: string | null; onToggle: () => void; icon: string; color?: string | null }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      disabled={!!disabled}
      onClick={onToggle}
      className={cx('flex h-8 shrink-0 items-center gap-2 pr-3 text-left', disabled ? 'cursor-default text-ink-3' : 'text-ink hover:bg-subtle')}
      style={{ paddingLeft: 10 + depth * 18 }}
    >
      <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border', checked ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>{checked ? <Icon name="check" size={11} /> : null}</span>
      <span className="flex shrink-0" style={color ? { color } : undefined}><Icon name={icon} size={15} /></span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {disabled ? <span className="shrink-0 text-[11.5px]">{disabled}</span> : null}
    </button>
  );
}
