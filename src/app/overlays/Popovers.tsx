import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { NotificationItem, Transfer } from '@shared/types';
import { app, organizationName } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { closeTabsOutside, navigate } from '../../core/tabs';
import { openWebLink } from '../../core/tab-context';
import { closeOverlay } from '../../core/ui';
import { bytes, duration, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, Empty, IconButton, Spinner, cx } from '../../components/ui';
import { Popover, PopoverHeader } from './Popover';

/** In-app notification centre mirroring the OS notifications (§4.2). */
export function NotificationCenter() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('all');
  const q = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => call('notifications:list') });
  const items = (q.data?.items ?? []).filter((n) => filter === 'all' || (filter === 'unread' ? !n.read : n.module === filter));
  const modules = [...new Set((q.data?.items ?? []).map((n) => n.module))].slice(0, 5);
  const paused = useStore(app, (s) => s.status?.notificationsPausedUntil);

  const open = (n: NotificationItem) => {
    closeOverlay();
    if (!n.read) void call('notifications:markRead', { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    openWebLink(n.link);
  };

  return (
    <Popover label="Notifications" width={420} offset={70}>
      <PopoverHeader
        title="Notifications"
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => void call('notifications:markAllRead').then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}>
              Mark all read
            </Button>
            <IconButton icon="settings" label="Notification settings" onClick={() => (closeOverlay(), navigate('/settings/notifications'))} size={16} />
          </div>
        }
      />
      {paused ? (
        <div className="flex items-center justify-between bg-warning-bg px-4 py-2 text-[12px] font-semibold text-warning">
          Paused until {new Date(paused).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          <button type="button" className="underline" onClick={() => void call('notifications:pause', { minutes: null })}>
            Resume
          </button>
        </div>
      ) : null}
      <div className="flex gap-1 border-b border-line px-3 py-2">
        {['all', 'unread', ...modules].map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize', filter === f ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-subtle')}>
            {f}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {q.isLoading ? <Spinner /> : items.length === 0 ? <Empty icon="bell" title="You're all caught up" /> : null}
        {items.map((n) => (
          <button key={n.id} type="button" onClick={() => open(n)} className="flex w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-subtle">
            <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-ink">{n.title}</span>
              {n.body ? <span className="line-clamp-2 block text-[12.5px] text-ink-2">{n.body}</span> : null}
              <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                <Chip>{n.module}</Chip> {relative(n.createdAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="border-t border-line p-2">
        <Button variant="ghost" className="w-full" onClick={() => (closeOverlay(), navigate('/notifications'))}>
          Open all notifications
        </Button>
      </div>
    </Popover>
  );
}

/** Transfer Center (FR-XFR-03, UI-12): uploads and downloads with progress, speed, ETA and controls. */
export function TransferCenter() {
  const transfers = useStore(app, (s) => s.transfers);
  const active = transfers.filter((t) => t.state === 'running' || t.state === 'queued' || t.state === 'paused');
  const done = transfers.filter((t) => !active.includes(t)).slice(0, 30);
  return (
    <Popover label="Transfers" width={440} offset={112}>
      <PopoverHeader
        title="Transfers"
        action={
          done.length ? (
            <Button size="sm" variant="ghost" onClick={() => void call('transfers:clearFinished')}>
              Clear finished
            </Button>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {transfers.length === 0 ? <Empty icon="transfers" title="No transfers" hint="Downloads and uploads from every app appear here." /> : null}
        {active.length ? <Group title="In progress" items={active} /> : null}
        {done.length ? <Group title="Recent" items={done} /> : null}
      </div>
    </Popover>
  );
}

function Group({ title, items }: { title: string; items: Transfer[] }) {
  return (
    <section>
      <h3 className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">{title}</h3>
      {items.map((t) => (
        <TransferRow key={t.id} t={t} />
      ))}
    </section>
  );
}

function TransferRow({ t }: { t: Transfer }) {
  const pct = t.total > 0 ? Math.min(100, Math.round((t.bytes / t.total) * 100)) : 0;
  const eta = t.speed > 0 && t.total > 0 ? duration((t.total - t.bytes) / t.speed) : null;
  const act = (ch: 'transfers:pause' | 'transfers:resume' | 'transfers:cancel' | 'transfers:retry' | 'transfers:open' | 'transfers:reveal') => call(ch, { id: t.id }).catch((e) => toast('error', errorMessage(e)));
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Icon name={t.direction === 'upload' ? 'upload' : 'download'} size={17} className={t.direction === 'upload' ? 'text-primary' : 'text-teal'} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink">{t.name}</div>
        {t.state === 'running' || t.state === 'paused' ? (
          <>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle">
              <div className={cx('h-full rounded-full', t.state === 'paused' ? 'bg-ink-3' : 'bg-primary')} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-3">
              {bytes(t.bytes)} / {bytes(t.total)} {t.state === 'paused' ? '· paused' : `· ${bytes(t.speed)}/s${eta ? ` · ${eta} left` : ''}`}
            </div>
          </>
        ) : (
          <div className={cx('text-[11.5px]', t.state === 'failed' ? 'text-danger' : 'text-ink-3')}>
            {t.state === 'done' ? `${bytes(t.total)} · ${t.direction === 'upload' ? 'uploaded' : 'saved'}` : t.state === 'failed' ? (t.error ?? 'Failed') : t.state}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5">
        {t.state === 'running' ? <IconButton icon="pause" label="Pause" size={15} onClick={() => void act('transfers:pause')} /> : null}
        {t.state === 'paused' ? <IconButton icon="play" label="Resume" size={15} onClick={() => void act('transfers:resume')} /> : null}
        {t.state === 'failed' ? <IconButton icon="refresh" label="Retry" size={15} onClick={() => void act('transfers:retry')} /> : null}
        {t.state === 'done' && t.direction === 'download' ? (
          <>
            <IconButton icon="external" label="Open" size={15} onClick={() => void act('transfers:open')} />
            <IconButton icon="folder-open" label="Show in folder" size={15} onClick={() => void act('transfers:reveal')} />
          </>
        ) : null}
        {t.state === 'running' || t.state === 'paused' || t.state === 'queued' ? <IconButton icon="x" label="Cancel" size={15} onClick={() => void act('transfers:cancel')} /> : null}
      </div>
    </div>
  );
}

/** Organization selector (FR-AUTH-05/06, WF-03). */
export function OrgSwitcher() {
  const b = useStore(app, (s) => s.bootstrap);
  const current = useStore(app, (s) => s.organizationId);
  const [busy, setBusy] = useState(false);
  if (!b) return null;
  const choose = async (id: string | null) => {
    setBusy(true);
    try {
      const r = await call('session:switchOrganization', { organizationId: id });
      app.set({ organizationId: r.organizationId });
      const closed = closeTabsOutside(id);
      if (closed) toast('info', `${closed} tab${closed === 1 ? '' : 's'} from another organization closed.`);
      toast('success', `Showing ${organizationName(id)}.`);
      closeOverlay();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const orgs = b.organizations;
  return (
    <Popover label="Organizations" align="left" offset={220} width={320}>
      <PopoverHeader title="Organization" />
      <ul className="max-h-[420px] overflow-y-auto p-1.5 scroll-thin">
        {orgs.length > 1 ? (
          <li>
            <OrgRow name="All organizations" hint="Where the app supports it" active={current === null} onClick={() => void choose(null)} disabled={busy} />
          </li>
        ) : null}
        {orgs.map((o) => (
          <li key={o.id}>
            <OrgRow name={o.name} active={current === o.id || (orgs.length === 1 && current === null)} onClick={() => void choose(o.id)} disabled={busy || orgs.length === 1} />
          </li>
        ))}
        {orgs.length === 0 ? <li className="p-4 text-[12.5px] text-ink-3">No organizations are shared with you.</li> : null}
      </ul>
    </Popover>
  );
}

function OrgRow({ name, hint, active, onClick, disabled }: { name: string; hint?: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled && !active} className={cx('flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <Avatar name={name} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-ink">{name}</span>
        {hint ? <span className="block text-[11.5px] text-ink-3">{hint}</span> : null}
      </span>
      {active ? <Icon name="check" size={16} className="text-primary" /> : null}
    </button>
  );
}

export function ProfileMenu() {
  const user = useStore(app, (s) => s.auth?.user);
  const server = useStore(app, (s) => s.auth?.server);
  const [confirm, setConfirm] = useState(false);
  return (
    <Popover label="Account" width={300}>
      <div className="flex items-center gap-3 border-b border-line p-4">
        <Avatar name={user?.name} size={40} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold text-ink">{user?.name}</div>
          <div className="truncate text-[12px] text-ink-3">{user?.email}</div>
          <div className="truncate text-[11.5px] text-ink-3">{server ? new URL(server.origin).host : ''}</div>
        </div>
      </div>
      <div className="flex flex-col p-1.5">
        <MenuRow icon="settings" label="Settings" onClick={() => (closeOverlay(), navigate('/settings'))} />
        <MenuRow icon="laptop" label="This device" onClick={() => (closeOverlay(), navigate('/settings/devices'))} />
        <MenuRow icon="external" label="My account on the web" onClick={() => (closeOverlay(), void call('app:openInBrowser', { path: '/account/settings' }))} />
        <MenuRow icon="stethoscope" label="Help & Diagnostics" onClick={() => (closeOverlay(), navigate('/diagnostics'))} />
        <MenuRow icon="lock" label="Lock WorkSuite" onClick={() => (closeOverlay(), void call('security:lock'))} />
        {confirm ? (
          <div className="m-1.5 rounded-[8px] bg-subtle p-2.5 text-[12.5px] text-ink-2">
            Sign out of WorkSuite on this computer? Drafts stay saved for when you come back.
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="danger" onClick={() => void call('auth:signOut', { wipe: false })}>
                Sign out
              </Button>
              <Button size="sm" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <MenuRow icon="logout" label="Sign out" onClick={() => setConfirm(true)} />
        )}
      </div>
    </Popover>
  );
}

function MenuRow({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-9 items-center gap-3 rounded-[8px] px-2.5 text-[13px] text-ink hover:bg-subtle">
      <Icon name={icon} size={16} className="text-ink-2" /> {label}
    </button>
  );
}

/** Connection detail (FR-OFF-05): network state and the changes waiting to sync (WF-17). */
export function NetworkPopover() {
  const status = useStore(app, (s) => s.status);
  const q = useQuery({ queryKey: ['offline', 'pending'], queryFn: () => call('offline:pending') });
  const st = useQuery({ queryKey: ['offline', 'status'], queryFn: () => call('offline:status') });
  const label = { ONLINE: 'Online', LIMITED: 'Limited — live updates paused', RECONNECTING: 'Reconnecting…', OFFLINE: 'Offline' }[status?.network ?? 'ONLINE'];
  return (
    <Popover label="Connection" width={400} offset={200}>
      <PopoverHeader title="Connection" />
      <div className="space-y-1 border-b border-line px-4 py-3 text-[12.5px] text-ink-2">
        <div>
          <span className="font-semibold text-ink">{label}</span>
        </div>
        <div>Live updates: {status?.realtime === 'connected' ? 'connected' : status?.realtime === 'disabled' ? 'not offered by this server (checking every minute instead)' : 'reconnecting'}</div>
        {st.data ? <div>Saved for offline use: {st.data.cacheEntries} items ({bytes(st.data.cacheBytes)})</div> : null}
        {st.data?.reason ? <div className="text-warning">{st.data.reason}</div> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {q.data && q.data.length === 0 ? <Empty icon="check-circle" title="Nothing waiting" hint="Every change has reached WorkSuite." /> : null}
        {(q.data ?? []).map((m) => (
          <div key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <Icon name={m.state === 'CONFLICT' ? 'warning' : m.state === 'FAILED' ? 'alert' : 'clock'} size={16} className={m.state === 'PENDING' || m.state === 'SYNCING' ? 'text-ink-3' : 'text-danger'} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink">{m.label}</div>
              <div className="truncate text-[11.5px] text-ink-3">
                {m.state === 'CONFLICT' ? 'Changed on the server while you were offline' : m.state === 'FAILED' ? (m.error ?? 'The server refused this change') : 'Waiting to sync'} · {relative(m.createdAt)}
              </div>
            </div>
            {m.state === 'CONFLICT' || m.state === 'FAILED' ? (
              <>
                <Button size="sm" onClick={() => void call('offline:retry', { id: m.id })}>
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void call('offline:discard', { id: m.id })}>
                  Discard
                </Button>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </Popover>
  );
}
