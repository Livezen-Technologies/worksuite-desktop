import { app } from '../core/app-state';
import { isMac } from '../core/bridge';
import { t } from '../core/i18n';
import { useStore } from '../core/store';
import { minimiseChatDrawer, openChatDrawer, openOverlay, toggleDock, ui } from '../core/ui';
import { prettyAccelerator } from '../core/commands';
import { Icon } from '../components/Icon';
import { ClockControl } from '../app/overlays/ClockPopover';
import { CountBadge, cx } from '../components/ui';
import { UserPicture, useMe } from '../components/UserPicture';

/**
 * Title / top bar, 52 px (§4.12 shared shell components): WorkSuite mark,
 * organization selector, global search, clock in / out, network pill, transfers,
 * notifications, AI, profile — and the window controls (native traffic
 * lights on macOS, the OS overlay controls elsewhere).
 */
export function TitleBar() {
  const status = useStore(app, (s) => s.status);
  const user = useStore(app, (s) => s.auth?.user);
  const me = useMe();
  const bootstrap = useStore(app, (s) => s.bootstrap);
  const overlay = useStore(ui, (s) => s.overlay);
  const dock = useStore(ui, (s) => s.dock);
  const transfers = useStore(app, (s) => s.transfers);
  const activeTransfers = transfers.filter((x) => x.state === 'running' || x.state === 'queued').length;
  const hasAi = useStore(app, (s) => s.apps.some((a) => a.id === 'ai'));
  const hasChat = useStore(app, (s) => s.apps.some((a) => a.id === 'chat'));

  const network = status?.network ?? 'ONLINE';
  const pending = status?.pendingChanges ?? 0;
  const pill =
    network === 'OFFLINE'
      ? { text: pending > 0 ? t('shell.offlineWaiting', { n: pending }) : t('shell.offline'), dot: 'bg-[#8A90A2]', tone: 'bg-white/8 text-navy-ink' }
      : network === 'RECONNECTING'
        ? { text: t('shell.reconnecting'), dot: 'bg-[#F0A04B] animate-pulse', tone: 'bg-[#F0A04B]/12 text-[#F7C68A]' }
        : network === 'LIMITED'
          ? { text: t('shell.limited'), dot: 'bg-[#F0A04B]', tone: 'bg-[#F0A04B]/12 text-[#F7C68A]' }
          : { text: t('shell.online'), dot: 'bg-[#43B581]', tone: 'bg-[#43B581]/12 text-[#7EE2B0]' };

  const unread = status?.unread.notifications ?? 0;

  return (
    <header className="drag flex h-[52px] shrink-0 items-center gap-3 bg-navy pr-3 text-white" style={{ paddingLeft: isMac ? 84 : 14, paddingRight: isMac ? 12 : 150 }}>
      <div className="flex w-[180px] shrink-0 items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-brand text-[15px] font-extrabold">W</span>
        <span className="text-[16px] font-bold tracking-tight">WorkSuite</span>
      </div>


      <button
        type="button"
        className="no-drag flex h-9 min-w-0 max-w-[560px] flex-1 items-center gap-2.5 rounded-[9px] bg-white/7 px-3 text-left text-[13.5px] text-navy-ink/80 hover:bg-white/10"
        onClick={() => openOverlay('search')}
      >
        <Icon name="search" size={16} />
        <span className="flex-1 truncate">{t('shell.search')}</span>
        <kbd className="rounded-[5px] border border-white/15 px-1.5 py-0.5 font-mono text-[11px]">{prettyAccelerator('Mod+K')}</kbd>
      </button>

      <div className="flex-1" />

      <ClockControl />

      <button type="button" className={cx('no-drag flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold', pill.tone)} onClick={() => openOverlay('network')} aria-label={`Connection: ${pill.text}`}>
        <span className={cx('h-2 w-2 rounded-full', pill.dot)} />
        {pill.text}
      </button>

      <TopButton icon="transfers" label={t('shell.transfers')} onClick={() => openOverlay('transfers')} active={overlay === 'transfers'} count={activeTransfers} countTone="indigo" />
      {hasChat ? <TopButton icon="chat" label="Chat" onClick={() => (dock === 'chat' ? minimiseChatDrawer() : openChatDrawer(null))} active={dock === 'chat'} count={status?.unread.chat ?? 0} /> : null}
      <TopButton icon="bell" label={t('nav.notifications')} onClick={() => openOverlay('notifications')} active={overlay === 'notifications'} count={unread} />
      {hasAi || bootstrap ? (
        <button
          type="button"
          className={cx('no-drag flex h-8 items-center gap-1.5 rounded-[8px] border border-teal-light/30 px-3 text-[13px] font-semibold text-teal-light hover:bg-teal/20', dock === 'ai' && 'bg-teal/25')}
          onClick={() => toggleDock('ai')}
          aria-pressed={dock === 'ai'}
        >
          <Icon name="sparkles" size={15} /> {t('shell.ai')}
        </button>
      ) : null}
      {/* 32 px across, edge included (TopBar design: a 2 px indigo edge, no ring outside it), so it lines up with the buttons beside it. */}
      <button
        type="button"
        className={cx('no-drag flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-[#E8ECFA] transition-colors', overlay === 'profile' ? 'border-[#9DB0F7]' : 'border-[#3B5BDB] hover:border-[#7C93F2]')}
        onClick={() => openOverlay('profile')}
        aria-label={`Account: ${me?.name ?? user?.name ?? ''}`}
      >
        <UserPicture name={me?.name ?? user?.name} src={me?.avatar} size={28} className="!bg-[#E8ECFA] text-[11px] !text-[#1E2F8A]" />
      </button>
    </header>
  );
}

function TopButton({ icon, label, onClick, active, count, countTone = 'badge' }: { icon: string; label: string; onClick: () => void; active?: boolean; count?: number; countTone?: 'badge' | 'indigo' }) {
  return (
    <button type="button" aria-label={count ? `${label} (${count})` : label} title={label} onClick={onClick} className={cx('no-drag relative flex h-8 w-8 items-center justify-center rounded-[8px] text-navy-ink hover:bg-white/10 hover:text-white', active && 'bg-white/12 text-white')}>
      <Icon name={icon} size={18} />
      {count ? <CountBadge n={count} tone={countTone} className="absolute -top-1 -right-1.5" /> : null}
    </button>
  );
}
