import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { call, isMac } from '../../../core/bridge';
import { hideWindowBar } from '../../../app/windowChrome';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { CallAvatar, VideoView } from '../parts';
import { CallSidePanel, type PanelTab } from './CallSidePanel';
import { CallVideoPip } from './CallVideoPip';
import { CoreCallControls, type ControlButton, type MenuEntry } from './CoreCallControls';
import type { MenuSection } from '../../../components/Menu';
import { text } from '../../../core/i18n';
import { computeLayout, HEADER, SIDE_COLUMN, STRIP, type LayoutOutput } from './layout';
import { featured, screenPresenter, type CallPerson } from './people';
import { callUi, type LayoutMode } from './state';

/**
 * MeetCallWorkspace: the call surface shared by a chat call's video window
 * and a meeting (CallHeader, CallStage with ScreenShareStage /
 * ActiveSpeakerStage / VideoGrid / CallVideoPip, CallSidePanel,
 * CoreCallControls, CallLayoutSelector, the status overlay).
 *
 * The layout comes from `computeLayout` alone. Full screen puts THIS element
 * in full screen — stage, panel and controls together — and leaving it
 * (Esc, or the button) changes nothing else. Nothing here mounts or unmounts
 * a track: a video element attaches the track it is given and detaches it
 * when it goes, and opening the panel only resizes the stage.
 *
 * Z-order is fixed: stage 10, PiP 20, panel 30, controls 40, menus 50,
 * dialogs 100 (ui.Modal), alerts 200.
 */
export interface WorkspaceProps {
  title: string;
  clock?: string | null;
  badges?: ReactNode;
  headerExtra?: ReactNode;
  people: CallPerson[];
  /** Over the stage while the call is not connected (ringing, ended, a problem). */
  overlay?: ReactNode;
  /** Banners at the top of the stage (someone waiting, an error). */
  alerts?: ReactNode;
  /** The whiteboard, when it is on stage. */
  board?: ReactNode | null;
  tabs: PanelTab[];
  buttons: ControlButton[];
  /** The More menu's own groups (Meeting Tools, Host Controls…); View & Layout is added after them. */
  more: MenuSection[];
  end: { label: string; onClick: () => void; menu?: MenuEntry[] };
  /** A line above the controls ("You are sharing Screen 1"). */
  status?: ReactNode;
  /** Keep-on-top is offered for call windows; meetings can too. */
  pinnable?: boolean;
  /** Who spoke last (the session keeps it), so the big picture does not flick between two voices. */
  lastSpeaker?: string | null;
  /** Drawn over another person's shared screen on the stage (Meet's remote control). */
  screenLayer?: (sharer: CallPerson) => ReactNode;
  /** The session owns stopping its local screen track. */
  stopPresenting?: () => void;
}

const IDLE_MS = 3_000;

export function CallWorkspace(props: WorkspaceProps) {
  const ui = useSyncExternalStore(callUi.subscribe, callUi.get);
  // The surface's element (state, not a ref: full screen and the menu's actions use it).
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1024, height: 700 });
  const held = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pinned, setPinned] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // This surface has its own header; the window's slim bar steps aside, and
  // a narrow voice-call window grows to fit a picture.
  useEffect(() => hideWindowBar(), []);
  useEffect(() => {
    void call('windows:fitVideo').catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    const el = root;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1 ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [root]);

  // Full screen is this element's, and the store follows the browser: Esc leaves it too.
  useEffect(() => {
    const sync = () => callUi.set({ fullscreen: document.fullscreenElement === root && root !== null });
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [root]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void root?.requestFullscreen().catch(() => undefined);
  }, [root]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [toggleFullscreen]);

  // The window's own state: kept on top, maximised, shrunk to the card (the
  // main window's "back to the call" brings it back without asking us).
  useEffect(() => {
    const read = () =>
      void call('windows:state').then(
        (w) => {
          setPinned(w.alwaysOnTop);
          setMaximized(w.maximized);
          if (!!w.compact !== callUi.get().floating) callUi.set({ floating: !!w.compact });
        },
        () => undefined,
      );
    read();
    let t: ReturnType<typeof setTimeout> | null = null;
    const later = () => {
      if (t) clearTimeout(t);
      t = setTimeout(read, 150);
    };
    window.addEventListener('resize', later);
    return () => {
      window.removeEventListener('resize', later);
      if (t) clearTimeout(t);
    };
  }, []);

  // The controls fade when the mouse is still, and come back when it moves.
  const wake = useCallback(() => {
    if (!callUi.get().controlsVisible) callUi.set({ controlsVisible: true });
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      if (!held.current) callUi.set({ controlsVisible: false });
    }, IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, [wake]);
  const hold = useCallback(
    (h: boolean) => {
      held.current = h;
      if (!h) wake();
    },
    [wake],
  );

  const floating = ui.floating;
  const setFloating = (value: boolean) => {
    if (value && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    void call('windows:setCompact', { value, shape: 'card' }).then((v) => callUi.set({ floating: v }), () => undefined);
  };

  const people = props.people;
  const self = people.find((p) => p.self) ?? null;
  const presenter = screenPresenter(people);
  const localScreen = self?.screen;
  useEffect(() => {
    void call('media:screenIndicator', { active: !!localScreen }).catch(() => undefined);
    return () => { void call('media:screenIndicator', { active: false }).catch(() => undefined); };
  }, [localScreen]);
  const primary = !!props.board || !!presenter;
  const star = featured(people, props.lastSpeaker ?? null);

  const layout = computeLayout({
    width: size.width,
    height: size.height,
    people: people.length,
    primary,
    panelOpen: ui.panelOpen && props.tabs.length > 0 && !floating,
    panelWidth: ui.panelWidth,
    fullscreen: ui.fullscreen,
    floating,
    mode: ui.layoutMode,
  });
  const visible = ui.controlsVisible || !!props.overlay;

  if (floating) {
    return (
      <div ref={setRoot} className="relative flex h-full flex-col overflow-hidden bg-[#0B1226] text-[13px] text-[#E6ECFA]">
        <FloatingCard {...props} star={star} self={self} presenter={presenter} onReturn={() => setFloating(false)} onChat={() => (callUi.set({ panelOpen: true, panelTab: props.tabs.find((t) => t.id === 'Chat')?.id ?? props.tabs[0]?.id ?? 'Chat' }), setFloating(false))} />
      </div>
    );
  }

  const layouts = (
    [
      ['auto', text('Auto'), primary ? text('The shared screen, you in the corner') : text('Speaker for two, a grid for more')],
      ['focus', text('Focus'), primary ? text('The shared screen, people in the corner') : text('Whoever is speaking, large')],
      ['side', text('Side by side'), primary ? text('The shared screen with people beside it') : text('A grid')],
      ['grid', text('Grid'), primary ? text('The shared screen with people under it') : text('Everybody the same size')],
    ] as Array<[LayoutMode, string, string]>
  ).map(([mode, label, hint]) => ({ mode, label, hint }));
  const layoutMenu: MenuEntry[] = [
    { heading: primary ? text('While something is shared') : text('Layout') },
    ...layouts.map(({ mode, label, hint }) => ({ label, hint, radio: true, checked: ui.layoutMode === mode, onClick: () => callUi.set({ layoutMode: mode }) })),
  ];
  const view = viewSection({
    primary,
    layoutMode: ui.layoutMode,
    layouts,
    selfView: ui.selfView,
    mirror: ui.mirror,
    fill: ui.fit === 'fill',
    pip: ui.pipEnabled,
    fullscreen: ui.fullscreen,
    toggleFullscreen,
    float: () => setFloating(true),
  });
  const buttons: ControlButton[] = [
    ...props.buttons,
    { id: 'layout', icon: 'grid', label: text('Layout'), menu: layoutMenu },
    { id: 'more', icon: 'more', label: text('More'), sections: [...props.more, view] },
  ];

  const stageRect = layout.stage;
  const inner = { width: stageRect.width, height: stageRect.height - (layout.strip && !ui.stripCollapsed ? STRIP : 0) };
  const mainWidth = layout.side ? inner.width - SIDE_COLUMN : inner.width;
  // Everybody else first, you last (and not at all with self view off).
  const tiles = [...people.filter((p) => !p.self), ...people.filter((p) => p.self && ui.selfView)];

  return (
    <div ref={setRoot} onPointerMove={wake} className="relative h-full overflow-hidden bg-[#0B1226] text-[13px] text-[#E6ECFA]">
      <Header {...props} pinned={pinned} maximized={maximized} fullscreen={ui.fullscreen} onPin={() => void call('windows:setAlwaysOnTop', { value: !pinned }).then(setPinned)} onMax={() => void call('windows:toggleMaximize').then(setMaximized)} onFull={toggleFullscreen} onFloat={() => setFloating(true)} />

      <div className="absolute z-[10]" style={{ left: stageRect.x, top: stageRect.y, width: stageRect.width, height: stageRect.height }}>
        <div className="absolute top-0 left-0 overflow-hidden" style={{ width: mainWidth, height: inner.height }}>
          <Stage layout={layout} people={people} tiles={tiles} star={star} self={self} presenter={presenter} board={props.board ?? null} size={{ width: mainWidth, height: inner.height }} screenLayer={props.screenLayer} stopPresenting={props.stopPresenting} />
          {props.alerts ? <div className="absolute inset-x-3 top-3 z-[25] flex flex-col gap-2">{props.alerts}</div> : null}
          {props.overlay ? <div className="absolute inset-0 z-[25] flex items-center justify-center bg-[rgba(11,18,38,.72)] p-6">{props.overlay}</div> : null}
        </div>
        {layout.side ? (
          <div className="absolute top-0 right-0 flex flex-col gap-2 overflow-y-auto p-2 scroll-thin" style={{ width: SIDE_COLUMN, height: inner.height }}>
            {tiles.map((p) => (
              <Tile key={p.id} p={p} className="aspect-video w-full shrink-0" />
            ))}
          </div>
        ) : null}
        {layout.strip ? <Strip tiles={tiles} collapsed={ui.stripCollapsed} top={inner.height} /> : null}
      </div>

      {layout.panel ? <CallSidePanel tabs={props.tabs} active={ui.panelTab} rect={layout.panel.rect} docked={layout.panel.docked} width={ui.panelWidth} /> : null}

      <div className="pointer-events-none absolute z-[40]" style={{ left: stageRect.x, top: stageRect.y, width: stageRect.width, height: stageRect.height }}>
        <div className="pointer-events-auto">
          <CoreCallControls buttons={buttons} end={props.end} visible={visible} compact={layout.compactControls} onHold={hold} status={props.status} />
        </div>
      </div>
    </div>
  );
}

function Header({ title, clock, badges, headerExtra, pinnable = true, pinned, maximized, fullscreen, onPin, onMax, onFull, onFloat }: WorkspaceProps & { pinned: boolean; maximized: boolean; fullscreen: boolean; onPin: () => void; onMax: () => void; onFull: () => void; onFloat: () => void }) {
  const btn = 'no-drag flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-[#C9D3EE] hover:bg-white/10 hover:text-white';
  return (
    <div className="drag absolute inset-x-0 top-0 z-[35] flex items-center gap-2.5 border-b border-white/8 bg-[#0F1B3D]" style={{ height: HEADER, paddingLeft: isMac && !fullscreen ? 84 : 14, paddingRight: isMac || fullscreen ? 10 : 146 }}>
      <Icon name="lock" size={13} className="shrink-0 text-[#AFC0E8]" />
      <b className="min-w-0 truncate text-[13px]">{title}</b>
      {clock ? <span className="font-mono text-[12px] text-[#AFC0E8] tabular-nums">{clock}</span> : null}
      {badges}
      <span className="flex-1" />
      {headerExtra}
      {pinnable ? (
        <button type="button" aria-label="Keep on top" aria-pressed={pinned} title="Keep on top" onClick={onPin} className={cx(btn, pinned && 'bg-white/16 text-white')}>
          <Icon name="pin" size={14} />
        </button>
      ) : null}
      <button type="button" aria-label="Shrink to a floating window" title="Shrink to a floating window — the call stays on top of your other apps" onClick={onFloat} className={btn}>
        <Icon name="minimize" size={15} />
      </button>
      {!fullscreen ? (
        <button type="button" aria-label={maximized ? 'Restore the window' : 'Maximise the window'} title={maximized ? 'Restore' : 'Maximise'} onClick={onMax} className={btn}>
          <Icon name={maximized ? 'app-window' : 'maximize'} size={15} />
        </button>
      ) : null}
      <button type="button" aria-label={fullscreen ? 'Leave full screen' : 'Full screen'} title={fullscreen ? 'Leave full screen (Esc)' : 'Full screen (F11)'} onClick={onFull} className={btn}>
        <Icon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} size={15} />
      </button>
    </div>
  );
}

function Stage({ layout, people, tiles, star, self, presenter, board, size, screenLayer, stopPresenting }: { layout: LayoutOutput; people: CallPerson[]; tiles: CallPerson[]; star: CallPerson | null; self: CallPerson | null; presenter: CallPerson | null; board: ReactNode | null; size: { width: number; height: number }; screenLayer?: (sharer: CallPerson) => ReactNode; stopPresenting?: () => void }) {
  const ui = callUi.get();
  if (layout.resolved.startsWith('screen')) {
    const pipPerson = presenter ?? star;
    return (
      <>
        {board && !presenter?.screen ? (
          <div className="absolute inset-0">{board}</div>
        ) : presenter?.screen ? (
          <div aria-label="Shared screen preview" className="absolute inset-0 flex items-center justify-center border-[3px] border-[#E5484D] bg-[#070C1A]">
            <VideoView track={presenter.screen} className="h-full w-full object-contain" />
            <div className="absolute top-3 left-3 z-[15] flex items-center gap-3 rounded-[8px] bg-[rgba(11,18,38,.8)] px-2.5 py-1 text-[12px] font-semibold">
              <span>{presenter.self ? 'You are presenting' : `${presenter.name} is sharing their screen`}</span>
              {presenter.self && stopPresenting ? <button type="button" onClick={stopPresenting} className="rounded px-2 py-1 bg-[#E5484D] text-white">Stop presenting</button> : null}
            </div>
            {presenter.screenPaused ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[rgba(7,12,26,.82)]">
                <Icon name="pause" size={28} />
                <b className="text-[15px]">Screen sharing paused.</b>
                <span className="text-[12.5px] text-[#AFC0E8]">{presenter.name} will pick it up again in a moment.</span>
              </div>
            ) : null}
            {!presenter.self ? screenLayer?.(presenter) : null}
          </div>
        ) : null}
        {layout.pip ? <CallVideoPip person={pipPerson && pipPerson.self && !ui.selfView ? null : pipPerson} self={self} stage={size} inset={layout.controlsInset} /> : null}
      </>
    );
  }
  if (layout.resolved === 'grid') {
    const n = tiles.length;
    const cols = layout.columns;
    return (
      <div className="grid h-full gap-2 p-2 pb-[84px]" style={{ gridTemplateColumns: `repeat(${Math.min(cols, Math.max(1, n))}, minmax(0, 1fr))`, gridAutoRows: '1fr' }}>
        {tiles.map((p) => (
          <Tile key={p.id} p={p} />
        ))}
      </div>
    );
  }
  // Speaker: the featured person large, you in the corner.
  const big = star && !star.self ? star : (people.find((p) => !p.self) ?? star);
  return (
    <>
      {big ? <Big p={big} /> : null}
      {layout.pip && self && ui.selfView && big && big.id !== self.id ? <CallVideoPip person={self} self={null} stage={size} inset={layout.controlsInset} /> : null}
    </>
  );
}

function Big({ p }: { p: CallPerson }) {
  const ui = callUi.get();
  return (
    <div className={cx('absolute inset-0 flex items-center justify-center bg-[#16254F]', p.speaking && 'shadow-[inset_0_0_0_3px_#3DD68C]')}>
      {p.camera ? (
        <VideoView track={p.camera} mirror={p.self && ui.mirror} className={cx('h-full w-full', ui.fit === 'fit' ? 'object-contain' : 'object-cover')} />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <CallAvatar name={p.self ? 'You' : p.name} size={150} glow={p.speaking ? 'speaking' : null} />
          <span className="text-[#AFC0E8]">{p.name} · camera off</span>
        </div>
      )}
      <span className="absolute bottom-3 left-3 rounded-[8px] bg-[rgba(11,18,38,.72)] px-2.5 py-1 text-[12.5px] font-semibold">
        {p.name}
        {!p.micOn ? ' · muted' : ''}
      </span>
      {p.hand ? <HandBadge hand={p.hand} className="absolute top-3 left-3" /> : null}
    </div>
  );
}

/** A raised hand on a tile, with its place in the queue. */
function HandBadge({ hand, className }: { hand: NonNullable<CallPerson['hand']>; className?: string }) {
  return (
    <span role="img" aria-label={hand.label} title={hand.label} className={cx('flex items-center gap-0.5 rounded-[6px] bg-[#F6C177] px-1.5 py-0.5 text-[10.5px] font-bold text-[#3A2A10]', className)}>
      <Icon name="hand" size={12} />
      {hand.position}
    </span>
  );
}

export function Tile({ p, className }: { p: CallPerson; className?: string }) {
  const ui = callUi.get();
  return (
    <div className={cx('relative flex min-h-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#2F4A7A]', p.speaking && 'shadow-[inset_0_0_0_3px_#3DD68C]', className)}>
      {p.camera ? <VideoView track={p.camera} mirror={p.self && ui.mirror} className={cx('h-full w-full', ui.fit === 'fit' ? 'object-contain' : 'object-cover')} /> : <CallAvatar name={p.self ? 'You' : p.name} size={64} />}
      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-[6px] bg-[rgba(11,18,38,.72)] px-1.5 py-0.5 text-[11.5px] font-semibold">
        {p.name}
        {p.host ? <span className="font-normal text-[#AFC0E8]">Host</span> : p.guest ? <span className="font-normal text-[#AFC0E8]">Guest</span> : null}
      </span>
      {!p.micOn ? (
        <span className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(11,18,38,.72)]" title="Muted">
          <Icon name="mic-off" size={13} />
        </span>
      ) : null}
      {p.screen || p.hand ? (
        <span className="absolute top-1.5 left-1.5 flex items-center gap-1">
          {p.hand ? <HandBadge hand={p.hand} /> : null}
          {p.screen ? <span className="rounded-[6px] bg-[rgba(59,91,219,.85)] px-1.5 py-0.5 text-[10.5px] font-bold">Sharing</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function Strip({ tiles, collapsed, top }: { tiles: CallPerson[]; collapsed: boolean; top: number }) {
  return (
    <div className="absolute inset-x-0 flex flex-col" style={{ top: collapsed ? top - 28 : top, height: collapsed ? 28 : STRIP }}>
      <button type="button" onClick={() => callUi.set({ stripCollapsed: !collapsed })} className="no-drag absolute -top-3 left-1/2 z-[21] flex h-6 -translate-x-1/2 items-center gap-1 rounded-full bg-[#16254F] px-2.5 text-[11px] font-semibold text-[#C9D3EE] hover:text-white">
        <Icon name={collapsed ? 'chevron-down' : 'chevron-down'} size={12} className={collapsed ? 'rotate-180' : ''} />
        {collapsed ? `Show ${tiles.length} ${tiles.length === 1 ? 'person' : 'people'}` : 'Hide people'}
      </button>
      {!collapsed ? (
        <div className="flex h-full gap-2 overflow-x-auto px-2 pt-3 pb-2 scroll-thin" aria-label="People">
          {tiles.map((p) => (
            <Tile key={p.id} p={p} className="h-full w-[170px] shrink-0" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The floating card: the call kept small on top of other apps. It shows the
 * shared screen with the speaker in its corner, or the speaker alone, and
 * the few controls a person reaches for without going back: mute, camera,
 * chat, back to the call, hang up.
 */
function FloatingCard({ title, clock, badges, buttons, end, star, self, presenter, board, onReturn, onChat }: WorkspaceProps & { star: CallPerson | null; self: CallPerson | null; presenter: CallPerson | null; onReturn: () => void; onChat: () => void }) {
  const mic = buttons.find((b) => b.id === 'mic');
  const cam = buttons.find((b) => b.id === 'camera');
  const who = star && !star.self ? star : self;
  const btn = 'no-drag flex h-9 w-9 items-center justify-center rounded-full';
  return (
    <>
      <div className="drag flex h-9 shrink-0 items-center gap-2 px-3" style={{ paddingRight: isMac ? 12 : 146 }}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-[#3DD68C]" />
        <b className="min-w-0 truncate text-[12.5px]">{title}</b>
        {clock ? <span className="font-mono text-[11.5px] text-[#AFC0E8]">{clock}</span> : null}
      </div>
      {badges ? <div className="shrink-0 px-2 pb-1">{badges}</div> : null}
      <button type="button" onClick={onReturn} title="Back to the call" className="no-drag relative min-h-0 flex-1 overflow-hidden bg-[#16254F]">
        {board && !presenter?.screen ? (
          <span className="flex h-full items-center justify-center gap-2 text-[#C9D3EE]">
            <Icon name="board" size={18} /> Whiteboard on stage
          </span>
        ) : presenter?.screen ? (
          <VideoView track={presenter.screen} className="h-full w-full border-[3px] border-[#E5484D] object-contain" />
        ) : who?.camera ? (
          <VideoView track={who.camera} mirror={who.self && callUi.get().mirror} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center">
            <CallAvatar name={who?.name ?? title} size={64} glow={who?.speaking ? 'speaking' : null} />
          </span>
        )}
        {presenter?.camera ? (
          <span className="absolute right-2 bottom-2 h-[38%] w-[30%] overflow-hidden rounded-[8px] border border-white/25">
            <VideoView track={presenter.camera} mirror={presenter.self && callUi.get().mirror} className="h-full w-full object-cover" />
          </span>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center justify-center gap-2 py-2">
        {mic ? (
          <button type="button" aria-label={mic.label} title={mic.label} onClick={mic.onClick} className={cx(btn, mic.tone === 'warn' ? 'bg-white text-[#B42318]' : 'bg-white/12 text-white hover:bg-white/20')}>
            <Icon name={mic.icon} size={17} />
          </button>
        ) : null}
        {cam ? (
          <button type="button" aria-label={cam.label} title={cam.label} onClick={cam.onClick} className={cx(btn, cam.tone === 'on' ? 'bg-white text-[#0F1B3D]' : 'bg-white/12 text-white hover:bg-white/20')}>
            <Icon name={cam.icon} size={17} />
          </button>
        ) : null}
        <button type="button" aria-label="Chat" title="Chat" onClick={onChat} className={cx(btn, 'bg-white/12 text-white hover:bg-white/20')}>
          <Icon name="chat" size={17} />
        </button>
        <button type="button" aria-label="Back to the call" title="Back to the call" onClick={onReturn} className={cx(btn, 'bg-white/12 text-white hover:bg-white/20')}>
          <Icon name="maximize" size={16} />
        </button>
        <button type="button" aria-label={end.label} title={end.label} onClick={end.onClick} className={cx(btn, 'w-12 bg-[#E5484D] text-white hover:bg-[#D93D42]')}>
          <Icon name="phone-off" size={17} />
        </button>
      </div>
    </>
  );
}

/**
 * The More menu's View & Layout group: the layout and the video options as
 * submenus, full screen (saying which way it goes) and the floating window.
 */
export function viewSection(v: {
  primary: boolean;
  layoutMode: LayoutMode;
  layouts: Array<{ mode: LayoutMode; label: string; hint: string }>;
  selfView: boolean;
  mirror: boolean;
  fill: boolean;
  pip: boolean;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  float: () => void;
}): MenuSection {
  const set = (patch: Parameters<typeof callUi.set>[0]) => () => callUi.set(patch);
  return {
    id: 'view',
    label: text('View & Layout'),
    items: [
      {
        id: 'layout',
        icon: 'grid',
        label: text('Layout'),
        description: v.layouts.find((l) => l.mode === v.layoutMode)?.label,
        submenu: [
          {
            id: 'layouts',
            label: v.primary ? text('While something is shared') : undefined,
            items: v.layouts.map((l) => ({ id: l.mode, label: l.label, description: l.hint, radio: true, checked: v.layoutMode === l.mode, onSelect: set({ layoutMode: l.mode }) })),
          },
        ],
      },
      {
        id: 'video',
        icon: 'video',
        label: text('Video'),
        submenu: [
          {
            id: 'video',
            items: [
              { id: 'self', icon: 'user', label: text('Show My Video'), checked: v.selfView, onSelect: set({ selfView: !v.selfView }) },
              { id: 'mirror', icon: 'flip', label: text('Mirror My Video'), checked: v.mirror, onSelect: set({ mirror: !v.mirror }) },
              { id: 'fill', icon: 'scaling', label: text('Fill the Tile'), description: text('Crops the picture to fill its tile'), checked: v.fill, onSelect: set({ fit: v.fill ? 'fit' : 'fill' }) },
              { id: 'pip', icon: 'pip', label: text('Show the Corner Video'), checked: v.pip, onSelect: set({ pipEnabled: !v.pip }) },
            ],
          },
        ],
      },
      { id: 'fullscreen', icon: v.fullscreen ? 'fullscreen-exit' : 'fullscreen', label: v.fullscreen ? text('Exit Full Screen') : text('Enter Full Screen'), shortcut: 'F11', onSelect: v.toggleFullscreen },
      { id: 'float', icon: 'minimize', label: text('Shrink to a Floating Window'), onSelect: v.float },
    ],
  };
}
