import { connectionLabel } from '@shared/network';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app, organizationName } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { PRESENCE_SHOWN, refreshMyPresence, shownPresence } from '../../core/presence';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { closeOverlay, openOverlay } from '../../core/ui';
import { bytes, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Empty, cx } from '../../components/ui';
import { UserPicture, useMe } from '../../components/UserPicture';
import { apiGet, apiPost } from '../../core/api';
import { useMfa } from '../../modules/account/api';
import { attendanceTime, useAttendance } from '../../modules/hr/attendance';
import { Popover, PopoverHeader } from './Popover';
import { AccountSwitcher } from '../accounts/AccountSwitcher';
import { openSignOut } from '../accounts/dialogs';
import { accountName } from '../accounts/labels';

/** The bell's drawer is the Notifications module's (NotifDrawer). */
export { NotifDrawer as NotificationCenter } from '../../modules/notifications/Drawer';

/** Transfer Center (FR-XFR-03, UI-12): its own file. */
export { TransferCenter } from './TransferCenter';

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
const SHOWN = PRESENCE_SHOWN;

export function ProfileMenu() {
  const qc = useQueryClient();
  const me = useMe();
  const hasChat = useStore(app, (s) => s.apps.some((a) => a.id === 'chat'));
  const hasHr = useStore(app, (s) => s.apps.some((a) => a.id === 'hr'));
  const orgs = useStore(app, (s) => s.bootstrap?.organizations.length ?? 0);
  const orgId = useStore(app, (s) => s.organizationId);
  // Asked afresh each time the menu opens: what the server last said may be from before this sign-in or unlock.
  const presence = useQuery({ queryKey: ['account', 'presence'], queryFn: ({ signal }) => apiGet<{ status: string; choice: string }>('/api/chat/presence/me', undefined, signal), enabled: hasChat, refetchOnMount: 'always' });
  // The same connection the title bar's pill reads (#150): never Offline here beside Online there.
  const network = useStore(app, (s) => s.status?.network ?? 'ONLINE');
  const mfa = useMfa();
  const { today, clockedIn } = useAttendance(hasHr);
  const [confirm, setConfirm] = useState(false);
  // Accounts side by side (Connection & Startup): the switcher, and Sign out with what has not synced (screen 14).
  const accounts = useStore(app, (s) => (s.accounts && s.accounts.accounts.length > 0 ? s.accounts : null));
  const active = accounts?.accounts.find((a) => a.id === accounts.activeId) ?? null;
  const [picking, setPicking] = useState(false);
  const go = (route: string) => (closeOverlay(), navigate(route));
  const shownAs = shownPresence(presence.data, network);
  const shown = shownAs ? SHOWN[shownAs]! : null;
  const working = hasHr && clockedIn && today?.check_in ? `${today.on_break ? 'On a break' : 'Working'} since ${attendanceTime(today.check_in)}` : null;
  const choose = async (status: string) => {
    setPicking(false);
    try {
      await apiPost('/api/chat/presence', { status, active: true });
      // Every copy of my status asks again: Chat, Website chats and the Phone's status follow at once (#288).
      await refreshMyPresence(qc);
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
          {active ? <span className="truncate text-[12px] text-ink-3">{active.kind === 'personal' ? 'Personal · WorkSuite Cloud' : `Enterprise · ${accountName(active)}`}</span> : null}
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
      {accounts ? <AccountSwitcher accounts={accounts} /> : null}
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
        {accounts ? <MenuRow icon="server" label="Account Settings" onClick={() => go('/settings/accounts')} /> : null}
        <MenuRow icon="settings" label="Settings for this computer" onClick={() => go('/settings')} />
        <MenuRow icon="book-open" label="User guides" onClick={() => go('/help')} />
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
          <button type="button" onClick={() => (active ? (closeOverlay(), openSignOut(active.id)) : setConfirm(true))} className="flex h-9 w-full items-center gap-[11px] rounded-[9px] px-2.5 text-[13px] font-medium text-[#B42318] hover:bg-danger-bg dark:text-danger">
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
  const label = connectionLabel(status);
  return (
    <Popover label="Connection" width={400} offset={200}>
      <PopoverHeader title="Connection" />
      <div className="space-y-1 border-b border-line px-4 py-3 text-[12.5px] text-ink-2">
        <div>
          <span className="font-semibold text-ink">{label}</span>
        </div>
        <div>Live updates: {status?.realtime === 'connected' ? 'connected' : status?.realtime === 'disabled' ? 'not offered by this server (checking every minute instead)' : 'reconnecting'}</div>
        {(status?.realtimeDiagnostics?.attempt ?? 0) >= 3 ? <div className="text-warning">Live updates repeatedly failed ({status?.realtimeDiagnostics?.lastDisconnect ?? 'connection unavailable'}). Check your network/VPN, server gateway and proxy; open Help → Diagnostics. Queued files and unsaved changes remain on this device.</div> : null}
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
