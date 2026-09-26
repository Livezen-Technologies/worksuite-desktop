import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { NotificationItem, Transfer } from '@shared/types';
import { app, organizationName } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { openWebLink } from '../../core/tab-context';
import { closeOverlay, openOverlay } from '../../core/ui';
import { bytes, duration, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, Empty, IconButton, Spinner, cx } from '../../components/ui';
import { UserPicture, useMe } from '../../components/UserPicture';
import { apiGet, apiPost } from '../../core/api';
import { useMfa } from '../../modules/account/api';
import { attendanceTime, useAttendance } from '../../modules/hr/attendance';
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

/**
 * The account menu (AcctMenu), from your picture in the title bar: who you
 * are and how you show to others, My account's sections, this computer's
 * settings, and Sign out. The status line is chat presence (Chat app) and
 * today's clock-in (People app); either is left out without its app.
 */
const PRESENCE: Array<{ id: 'available' | 'busy' | 'dnd' | 'away' | 'offline'; label: string; dot: string }> = [
  { id: 'available', label: 'Online', dot: '#22A861' },
  { id: 'busy', label: 'Busy', dot: '#D92D20' },
  { id: 'dnd', label: 'Do not disturb', dot: '#D92D20' },
  { id: 'away', label: 'Away', dot: '#F79009' },
  { id: 'offline', label: 'Appear offline', dot: '#8A91A5' },
];
const SHOWN: Record<string, { label: string; dot: string }> = {
  online: { label: 'Online', dot: '#22A861' },
  busy: { label: 'Busy', dot: '#D92D20' },
  dnd: { label: 'Do not disturb', dot: '#D92D20' },
  away: { label: 'Away', dot: '#F79009' },
  offline: { label: 'Offline', dot: '#8A91A5' },
};

export function ProfileMenu() {
  const qc = useQueryClient();
  const me = useMe();
  const hasChat = useStore(app, (s) => s.apps.some((a) => a.id === 'chat'));
  const hasHr = useStore(app, (s) => s.apps.some((a) => a.id === 'hr'));
  const orgs = useStore(app, (s) => s.bootstrap?.organizations.length ?? 0);
  const orgId = useStore(app, (s) => s.organizationId);
  const presence = useQuery({ queryKey: ['account', 'presence'], queryFn: ({ signal }) => apiGet<{ status: string; choice: string }>('/api/chat/presence/me', undefined, signal), enabled: hasChat });
  const mfa = useMfa();
  const { today, clockedIn } = useAttendance(hasHr);
  const [confirm, setConfirm] = useState(false);
  const [picking, setPicking] = useState(false);
  const go = (route: string) => (closeOverlay(), navigate(route));
  const shown = SHOWN[presence.data?.status ?? ''] ?? null;
  const working = hasHr && clockedIn && today?.check_in ? `${today.on_break ? 'On a break' : 'Working'} since ${attendanceTime(today.check_in)}` : null;
  const choose = async (status: string) => {
    setPicking(false);
    try {
      await apiPost('/api/chat/presence', { status, active: true });
      await qc.invalidateQueries({ queryKey: ['account', 'presence'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <Popover label="Account" width={320} className="rounded-[18px] border border-line shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.22)]">
      <div className="flex items-center gap-3 bg-[linear-gradient(180deg,#F3F5FE,var(--color-surface))] p-4 dark:bg-[linear-gradient(180deg,var(--color-selection),var(--color-surface))]">
        <span className="relative">
          <UserPicture name={me?.name} src={me?.avatar} size={52} className="!bg-primary text-[17px] !text-white" />
          {shown ? <span className="absolute right-0 bottom-0 h-3.5 w-3.5 rounded-full border-[2.5px] border-surface" style={{ background: shown.dot }} /> : null}
        </span>
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-[14.5px] text-ink">{me?.name}</b>
          <span className="truncate text-[12px] text-ink-3">{me?.email}</span>
        </span>
      </div>
      {shown || working ? (
        <div className="px-3 pb-2.5">
          <button
            type="button"
            aria-expanded={hasChat ? picking : undefined}
            onClick={() => (hasChat ? setPicking(!picking) : (closeOverlay(), openOverlay('clock')))}
            className="flex h-[38px] w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-subtle"
          >
            <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: shown?.dot ?? '#22A861' }} />
            <span className="min-w-0 flex-1 truncate text-left">{[shown?.label, working].filter(Boolean).join(' · ')}</span>
            <Icon name="chevron-right" size={14} className={cx('shrink-0 text-ink-3 transition-transform', picking && 'rotate-90')} />
          </button>
          {picking ? (
            <div role="menu" aria-label="Show me as" className="mt-1 flex flex-col rounded-[10px] border border-line p-1">
              {PRESENCE.map((p) => (
                <button key={p.id} type="button" role="menuitemradio" aria-checked={(presence.data?.choice ?? 'available') === p.id} onClick={() => void choose(p.id)} className="flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] text-ink hover:bg-subtle">
                  <span className="h-2 w-2 rounded-full" style={{ background: p.dot }} />
                  <span className="flex-1 text-left">{p.label}</span>
                  {(presence.data?.choice ?? 'available') === p.id ? <Icon name="check" size={14} className="text-primary" /> : null}
                </button>
              ))}
              {hasHr ? (
                <button type="button" onClick={() => (closeOverlay(), openOverlay('clock'))} className="flex h-8 items-center gap-2.5 rounded-[7px] border-t border-line px-2.5 text-[13px] text-ink hover:bg-subtle">
                  <Icon name="clock" size={14} className="text-ink-3" />
                  <span className="flex-1 text-left">{clockedIn ? 'Clock out or take a break' : 'Clock in'}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col border-t border-line px-2 py-1">
        <MenuRow icon="user" label="My profile" onClick={() => go('/account/profile')} />
        <MenuRow icon="id-card" label="Profile settings" onClick={() => go('/account/general')} />
        <MenuRow
          icon="lock"
          label="Security"
          onClick={() => go('/account/security')}
          extra={mfa.data ? <span className={cx('flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold', mfa.data.enabled ? 'bg-[#E6F6EE] text-[#1F7A4D] dark:bg-success-bg dark:text-success' : 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning')}>{mfa.data.enabled ? '2FA on' : '2FA off'}</span> : null}
        />
        <MenuRow icon="image" label="Profile pictures" onClick={() => go('/account/pictures')} />
        <MenuRow icon="key" label="My access" onClick={() => go('/account/access')} />
      </div>
      <div className="flex flex-col border-t border-line px-2 py-1">
        {orgs > 1 ? <MenuRow icon="building" label="Switch organisation" onClick={() => openOverlay('org')} extra={<span className="max-w-[110px] truncate text-[12px] text-ink-3">{organizationName(orgId)}</span>} /> : null}
        <MenuRow icon="settings" label="Settings for this computer" onClick={() => go('/settings')} />
        <MenuRow icon="help" label="Help & diagnostics" onClick={() => go('/diagnostics')} />
        <MenuRow icon="lock" label="Lock WorkSuite" onClick={() => (closeOverlay(), void call('security:lock'))} />
      </div>
      <div className="border-t border-line px-2 pt-1 pb-2">
        {confirm ? (
          <div className="m-1 rounded-[10px] bg-subtle p-2.5 text-[12.5px] text-ink-2">
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
          <button type="button" onClick={() => setConfirm(true)} className="flex h-9 w-full items-center gap-[11px] rounded-[9px] px-2.5 text-[13px] font-medium text-[#B42318] hover:bg-danger-bg dark:text-danger">
            <Icon name="logout" size={17} /> Sign out
          </button>
        )}
      </div>
    </Popover>
  );
}

function MenuRow({ icon, label, onClick, extra }: { icon: string; label: string; onClick: () => void; extra?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-9 items-center gap-[11px] rounded-[9px] px-2.5 text-left text-[13px] font-medium text-ink hover:bg-subtle">
      <Icon name={icon} size={17} className="shrink-0 text-ink-2" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
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
