import { useEffect, useState } from 'react';
import { useCanOpen } from '../core/access';
import { app } from '../core/app-state';
import { call, isMac, on } from '../core/bridge';
import { topBarPaddingRight } from '../core/window-chrome';
import { t } from '../core/i18n';
import { useStore } from '../core/store';
import { minimiseChatDrawer, openChatDrawer, openOverlay, toggleDock, ui, useAiDisplay } from '../core/ui';
import { prettyAccelerator } from '../core/commands';
import { Icon } from '../components/Icon';
import { ClockControl } from '../app/overlays/ClockPopover';
import { ActiveCalls } from '../app/ActiveCalls';
import { RingAlertPill } from '../modules/chat/website/Ringing';
import { UpdateIndicator } from '../app/screens/UpdateScreens';
import { MandatoryChip } from '../app/screens/MandatoryUpdate';
import { CountBadge, cx } from '../components/ui';
import { UserPicture, useMe } from '../components/UserPicture';
import { unreadLabel, useAssistantActivity } from '../app/overlays/AiDock';
import { phaseLabel } from '../modules/ai/session';
import { useGuest } from '../core/session';
import { TimerPill } from '../modules/projects/Timer';

/**
 * Title / top bar, 52 px (§4.12 shared shell components): WorkSuite mark,
 * organization selector, global search, clock in / out, network pill, a new
 * version (the update icon), transfers, notifications, AI, profile — and the
 * window controls (native traffic lights on macOS, the OS overlay controls
 * elsewhere).
 */
export function TitleBar() {
  const status = useStore(app, (s) => s.status);
  const user = useStore(app, (s) => s.auth?.user);
  const me = useMe();
  const overlay = useStore(ui, (s) => s.overlay);
  const dock = useStore(ui, (s) => s.dock);
  const transfers = useStore(app, (s) => s.transfers);
  const activeTransfers = transfers.filter((x) => x.state === 'running' || x.state === 'queued').length;
  const hasAi = useCanOpen('ai');
  // The header button is the drawer's (Settings › AI Assistant › Display mode); it says when an answer is on its way or came in unseen.
  const aiDisplay = useAiDisplay();
  const { busy: aiBusy, unread: aiUnread, phase: aiPhase, engine: aiEngine } = useAssistantActivity();
  const aiState = dock === 'ai' ? null : aiBusy || aiPhase === 'needsInput' ? phaseLabel(aiPhase, aiEngine) : aiUnread ? unreadLabel(aiUnread) : null;
  const hasChat = useCanOpen('chat');
  // Guest mode (#149): the Local Profile is who this is; transfers and notifications need an account.
  const guest = useGuest();
  const localProfile = useStore(app, (s) => s.local?.profile ?? null);
  const who = guest ? { name: localProfile?.name, avatar: localProfile?.picture ?? null } : { name: me?.name ?? user?.name, avatar: me?.avatar };

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
  // In macOS full screen the traffic lights hide with the menu bar, so their room is given back (#221).
  const fullScreen = useFullScreen();

  return (
    <header className="drag flex h-[52px] shrink-0 items-center gap-3 bg-navy pr-3 text-white" style={{ paddingLeft: isMac && !fullScreen ? 84 : 14, paddingRight: topBarPaddingRight(12) }}>
      <div className="flex w-[180px] shrink-0 items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-brand text-[15px] font-extrabold">W</span>
        <span className="text-[16px] font-bold tracking-tight">WorkSuite</span>
      </div>

      {/* The App Launcher: every app this person has, as tiles. */}
      <TopButton icon="grid" label={t('shell.apps')} onClick={() => openOverlay('launcher')} active={overlay === 'launcher'} />

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

      {/* A website chat ringing, or silenced and still waiting (R-01, RING-25): the title bar's alert, on every module. */}
      {hasChat ? <RingAlertPill /> : null}
      <ActiveCalls />
      <ClockControl />
      {/* The Projects timer while it runs (PRJ-DSK-02, D01): opens the mini timer. */}
      {guest ? null : <TimerPill />}

      <button type="button" className={cx('no-drag flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold', pill.tone)} onClick={() => openOverlay('network')} aria-label={`Connection: ${pill.text}`}>
        <span className={cx('h-2 w-2 rounded-full', pill.dot)} />
        {pill.text}
      </button>

      {/* A newer version: on offer, on its way, or ready (the Update ready pill, #205) — Settings › Updates. */}
      <UpdateIndicator />
      {/* A required update with time left: the chip opens Settings › Updates. */}
      <MandatoryChip />
      {guest ? null : <TopButton icon="transfers" label={t('shell.transfers')} onClick={() => openOverlay('transfers')} active={overlay === 'transfers'} count={activeTransfers} countTone="indigo" />}
      {hasChat ? <TopButton icon="chat" label="Chat" onClick={() => (dock === 'chat' ? minimiseChatDrawer() : openChatDrawer(null))} active={dock === 'chat'} count={status?.unread.chat ?? 0} /> : null}
      {guest ? null : <TopButton icon="bell" label={t('nav.notifications')} onClick={() => openOverlay('notifications')} active={overlay === 'notifications'} count={unread} />}
      {hasAi && aiDisplay === 'drawer' ? (
        <button
          type="button"
          className={cx('no-drag relative flex h-8 items-center gap-1.5 rounded-[8px] border border-teal-light/30 px-3 text-[13px] font-semibold text-teal-light hover:bg-teal/20', dock === 'ai' && 'bg-teal/25')}
          onClick={() => toggleDock('ai')}
          aria-pressed={dock === 'ai'}
          aria-label={aiState ? `${t('ai.title')} — ${aiState}` : t('ai.title')}
          title={aiState ?? t('ai.title')}
        >
          <Icon name="sparkles" size={15} className={cx(aiBusy && dock !== 'ai' && 'motion-safe:animate-pulse')} /> {t('shell.ai')}
          {aiUnread && dock !== 'ai' ? <CountBadge n={aiUnread} className="absolute -top-1 -right-1.5" /> : null}
        </button>
      ) : null}
      {/* 32 px across, edge included (TopBar design: a 2 px indigo edge, no ring outside it), so it lines up with the buttons beside it. */}
      <button
        type="button"
        className={cx('no-drag flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-[#E8ECFA] transition-colors', overlay === 'profile' ? 'border-[#9DB0F7]' : 'border-[#3B5BDB] hover:border-[#7C93F2]')}
        onClick={() => openOverlay('profile')}
        aria-label={`Account: ${who.name ?? ''}`}
      >
        <UserPicture name={who.name} src={who.avatar} size={28} className="!bg-[#E8ECFA] text-[11px] !text-[#1E2F8A]" />
      </button>
    </header>
  );
}

/** Whether this window is in full screen: asked once, then told when it changes. */
function useFullScreen(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    let live = true;
    void call('windows:state').then((s) => live && setFull(!!s.fullScreen), () => undefined);
    const off = on<boolean>('window:fullscreen', (v) => setFull(!!v));
    return () => {
      live = false;
      off();
    };
  }, []);
  return full;
}

function TopButton({ icon, label, onClick, active, count, countTone = 'badge' }: { icon: string; label: string; onClick: () => void; active?: boolean; count?: number; countTone?: 'badge' | 'indigo' }) {
  return (
    <button type="button" aria-label={count ? `${label} (${count})` : label} title={label} onClick={onClick} className={cx('no-drag relative flex h-8 w-8 items-center justify-center rounded-[8px] text-navy-ink hover:bg-white/10 hover:text-white', active && 'bg-white/12 text-white')}>
      <Icon name={icon} size={18} />
      {count ? <CountBadge n={count} tone={countTone} className="absolute -top-1 -right-1.5" /> : null}
    </button>
  );
}
