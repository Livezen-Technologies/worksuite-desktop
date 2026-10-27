import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';
import { apiGet } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { PRESENCE_SHOWN, shownPresence } from '../../../core/presence';
import { useStore } from '../../../core/store';
import { app } from '../../../core/app-state';
import { timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { cx, Spinner } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useNow } from '../../calls/parts';
import { ReplyBox, joinSend, useFit, useRingDraft } from './RingCard';
import { useRingState, waited } from './Ringing';
import { DASHBOARD_KEYS, homeOf, MAP_KEYS } from './live/LiveDashboard';
import { DeskHeading, DeskTiles, NeedsYou, needsRows, useLiveDesk, Yours, yoursRows } from './live/LiveDesk';
import { placesNow, presetsFor } from './live/liveMap';
import { LiveMap } from './live/LazyMap';
import { BrandMark } from '../../../components/BrandMark';

/**
 * The tray's ringing menu (R-06, RING-UI-07, X-UI-11; RING-43, UX-ALR-02): opened from the menu-bar or tray icon
 * while chats ring. "3 WEBSITE CHATS RINGING"; the most urgent chat expanded — who, "At risk · 3:12 · Kandy", Join,
 * what they last wrote and a reply box whose Send & join joins and stops the ring — and every other chat a row with
 * Reply and Join; then Open Website Chats, Ringing settings… and Quit WorkSuite. Reply on a row expands that one.
 */

/** "At risk", "Assigned to you", "Silenced for you" or "Waiting", with how long — and, expanded, the visitor's town. */
export function trayLine(c: Pick<WebchatRingChat, 'atRisk' | 'mine' | 'silenced' | 'since' | 'place'>, now: number, expanded: boolean): string {
  const what = c.atRisk ? text('At risk') : c.mine ? text('Assigned to you') : c.silenced ? text('Silenced for you') : text('Waiting');
  const town = expanded ? (c.place?.split(',')[0]?.trim() ?? null) : null;
  return [what, waited(c.since, now), town].filter(Boolean).join(' · ');
}

type TrayAction = 'inbox' | 'settings' | 'quit' | 'close' | 'dashboard' | 'liveMap' | 'wall' | 'silence';
const tray = (action: TrayAction) => void call('ring:tray', { action }).catch(() => undefined);
const join = (id: number) => void call('ring:join', { id }).catch((e) => toast('error', errorMessage(e)));

function JoinLink({ c, name }: { c: WebchatRingChat; name: string }) {
  return (
    <button type="button" aria-label={`Join ${name}`} onClick={() => join(c.id)} className="flex h-[26px] shrink-0 items-center rounded-full bg-green px-[11px] text-[12px] font-bold text-white hover:brightness-110">
      {text('Join')}
    </button>
  );
}

/** The expanded row: the chat, what they last wrote, and the reply box (UX-ALR-02). */
function Expanded({ s, c, now }: { s: WebchatRingState; c: WebchatRingChat; now: number }) {
  const [draft, setDraft] = useRingDraft(c.id, s.drafts?.[c.id]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const words = draft.trim();
    if (!words || busy) return;
    setBusy(true);
    // Joins, sends and stops the ring for everyone in one request; the menu stays where I am (R-06).
    const ok = await joinSend(c.id, words);
    setBusy(false);
    if (ok) setDraft('');
  };
  return (
    <li aria-label={c.visitor} className={cx('flex flex-col gap-[7px] rounded-[10px] px-2.5 py-2', c.atRisk ? 'bg-danger-bg' : 'bg-selection')}>
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[14px] font-bold">{c.visitor}</b>
          <span className={cx('truncate text-[12px]', c.atRisk ? 'text-danger' : 'text-ink-2')}>{trayLine(c, now, true)}</span>
        </span>
        <JoinLink c={c} name={c.visitor} />
      </div>
      {c.preview ? <p className="line-clamp-2 text-[12px] text-ink-2 italic">{`"${c.preview}"`}</p> : null}
      <ReplyBox id={`tray-reply-${c.id}`} label={text('Reply to {name}', { name: c.visitor })} placeholder={text('Type a reply…')} sendLabel="Send & join" sendAria="Send and join" draft={draft} setDraft={setDraft} onSend={() => void send()} busy={busy} visitorSaid={c.preview} look="menu" />
    </li>
  );
}

/**
 * The tray's window (R-06, L-05): for website staff the Live mini-dashboard (MAP-22, MAP-UI-05, X-UI-12), ringing or
 * not; for anybody the dashboard does not answer (or before its first answer, while chats ring), the ringing menu.
 */
export function RingTrayWindow() {
  const s = useRingState();
  const desk = useLiveDesk();
  // Put away, not closed, between uses: opened again, the reply box has the keyboard again.
  useEffect(() => {
    const typed = () => (document.querySelector('section input[type="text"]') as HTMLInputElement | null)?.focus();
    window.addEventListener('focus', typed);
    return () => window.removeEventListener('focus', typed);
  }, []);
  if (desk.d && !s.hidden) return <TrayDashboard s={s} desk={desk} />;
  if (desk.dash.isPending && !s.chats.length && !s.hidden) return <Spinner />;
  return <RingTrayMenu s={s} />;
}

function RingTrayMenu({ s }: { s: WebchatRingState }) {
  const now = useNow();
  const fit = useFit('ring:trayFit');
  // The most urgent chat is expanded (RING-23 order); Reply on another expands it instead.
  const [open, setOpen] = useState<number | null>(null);
  const shown = s.chats.slice(0, 5);
  const expanded = shown.find((c) => c.id === open) ?? shown[0];
  const first = useRef<HTMLDivElement | null>(null);
  // Opened to be typed in: the reply box has the keyboard at once.
  const expandedId = expanded?.id ?? null;
  useEffect(() => {
    if (expandedId !== null) (first.current?.querySelector('input') as HTMLInputElement | null)?.focus();
  }, [expandedId]);
  const header = s.chats.length === 1 ? text('Website chat ringing') : text('{n} website chats ringing', { n: s.chats.length });
  return (
    <div
      ref={(el) => {
        first.current = el;
        fit(el);
      }}
      onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), tray('close'))}
      className="flex flex-col"
    >
      <section aria-label="Tray menu" className="flex flex-col gap-0.5 border border-line bg-surface p-2 text-[13px] text-ink">
        {s.hidden || !expanded ? (
          <p className="px-2.5 py-2 text-ink-2">{s.hidden ? text('Unlock WorkSuite to see who.') : text('Nothing is ringing.')}</p>
        ) : (
          <>
            <div className="px-2.5 py-2 text-[11px] font-bold tracking-[0.8px] text-danger uppercase">{header}</div>
            <ul className="flex flex-col gap-0.5" aria-label={text('Chats ringing')}>
              {shown.map((c) =>
                c.id === expanded.id ? (
                  <Expanded key={c.id} s={s} c={c} now={now} />
                ) : (
                  <li key={c.id} aria-label={c.visitor} className="flex items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-subtle">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] font-semibold">{c.visitor}</span>
                      <span className={cx('truncate text-[12px]', c.atRisk ? 'text-danger' : 'text-ink-2')}>{trayLine(c, now, false)}</span>
                    </span>
                    <button type="button" aria-label="Reply" title={text('Reply to {name}', { name: c.visitor })} onClick={() => setOpen(c.id)} className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-primary hover:bg-selection">
                      <Icon name="reply" size={12} />
                    </button>
                    <JoinLink c={c} name={c.visitor} />
                  </li>
                ),
              )}
            </ul>
            {s.chats.length > shown.length ? <p className="px-2.5 text-[11.5px] text-ink-2">{text('+{n} more waiting', { n: s.chats.length - shown.length })}</p> : null}
            <p className="px-2.5 pt-0.5 pb-1 text-[11px] text-ink-2">{text('Reply from here: sending joins the chat and stops the ring.')}</p>
          </>
        )}
        <div role="separator" className="my-1 h-px bg-line" />
        <button type="button" onClick={() => tray('inbox')} className="rounded-[6px] px-2.5 py-2 text-left text-[13px] hover:bg-subtle">
          {text('Open Website Chats')}
        </button>
        <button type="button" onClick={() => tray('settings')} className="rounded-[6px] px-2.5 py-2 text-left text-[13px] hover:bg-subtle">
          {text('Ringing settings…')}
        </button>
        <button type="button" onClick={() => tray('quit')} className="rounded-[6px] px-2.5 py-2 text-left text-[13px] hover:bg-subtle">
          {text('Quit WorkSuite')}
        </button>
      </section>
    </div>
  );
}

/** The user's own status for the header (MAP-UI-05 "Online"): as the account menu shows it. */
function useMyStatus(): { label: string; dot: string } | null {
  const hasChat = useStore(app, (st) => st.apps.some((a) => a.id === 'chat'));
  const network = useStore(app, (st) => st.status?.network ?? 'ONLINE');
  const presence = useQuery({ queryKey: ['account', 'presence'], queryFn: ({ signal }) => apiGet<{ status: string; choice: string }>('/api/chat/presence/me', undefined, signal), enabled: hasChat, refetchInterval: 60_000 });
  const shown = shownPresence(presence.data, network);
  return shown ? PRESENCE_SHOWN[shown] : null;
}

/**
 * The menu-bar / tray mini-dashboard (L-05; MAP-22, MAP-UI-05, X-UI-12): opened from the icon over any app, the main
 * window open or not — Website chats, Live and my own status; ON SITE, WAITING, AT RISK and REPLY; a small map on the
 * region; who needs me with reply and join (UX-ALR-03); my own chats with Open; then Open Live dashboard ⌘⇧D, Show
 * Live map window ⌘⇧M, Wall mode on Display 2, Silence for 15 minutes and Quit WorkSuite.
 */
function TrayDashboard({ s, desk }: { s: WebchatRingState; desk: ReturnType<typeof useLiveDesk> }) {
  const now = useNow(1_000);
  const fit = useFit('ring:trayFit');
  const d = desk.d!;
  const status = useMyStatus();
  const info = useQuery({ queryKey: ['live', 'desk'], queryFn: () => call('live:info'), refetchOnWindowFocus: 'always' });
  const region = useMemo(() => {
    const p = presetsFor(homeOf(d, desk.visitors));
    return (p[1] ?? p[0])!.box;
  }, [d, desk.visitors]);
  const places = useMemo(() => placesNow(desk.visitors), [desk.visitors]);
  const needs = needsRows(desk.visitors, now, desk.skew);
  const yours = yoursRows(desk.visitors);
  const wall = info.data?.wall ?? null;
  const silenced = info.data?.silencedUntil && new Date(info.data.silencedUntil).getTime() > now ? info.data.silencedUntil : null;
  return (
    <div
      ref={fit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') return void (e.preventDefault(), tray('close'));
        // The shortcuts the menu shows answer here too (MAP-22).
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key.toLowerCase() === 'd' || e.key.toLowerCase() === 'm')) {
          e.preventDefault();
          tray(e.key.toLowerCase() === 'd' ? 'dashboard' : 'liveMap');
        }
      }}
      className="flex flex-col"
    >
      <section aria-label="WorkSuite tray — live dashboard" className="flex flex-col border border-line bg-surface text-[13px] text-ink">
        <div className="flex items-center gap-2 px-3 pt-[11px] pb-2">
          <BrandMark size={22} />
          <span className="flex-1 text-[13.5px] font-bold">{text('Website chats')}</span>
          <span className="flex items-center gap-[5px] text-[11px] font-bold text-success dark:text-success">
            <span className="h-[7px] w-[7px] rounded-full bg-green" aria-hidden />
            {text('Live')}
          </span>
          {status ? (
            <span className={cx('rounded-[8px] px-2 py-0.5 text-[11px] font-bold', status.label === 'Online' ? 'bg-success-bg text-success dark:bg-success-bg dark:text-success' : 'bg-subtle text-ink-2')}>
              {text(status.label)}
            </span>
          ) : null}
        </div>
        <div className="px-2.5 pb-2">
          <DeskTiles d={d} last="reply" />
        </div>
        <div className="mx-2.5 h-[150px] overflow-hidden rounded-[10px] border border-line">
          <LiveMap places={places} box={region} edges={false} label="Map of visitors on the site now" className="h-full w-full" />
        </div>
        <div className="pt-1">
          <DeskHeading title="Needs you" n={needs.length} tone="red" />
          <NeedsYou rows={needs} ring={s} said={desk.said} now={now} skew={desk.skew} limit={3} autoFocus />
        </div>
        {yours.length ? (
          <div>
            <DeskHeading title="Yours" n={yours.length} />
            <Yours rows={yours} said={desk.said} now={now} skew={desk.skew} />
          </div>
        ) : null}
        <div role="separator" className="my-1.5 h-px bg-line" />
        <div className="flex flex-col px-1.5 pb-2 text-ink-2">
          <TrayItem onClick={() => tray('dashboard')} keys={DASHBOARD_KEYS}>{text('Open Live dashboard')}</TrayItem>
          <TrayItem onClick={() => tray('liveMap')} keys={MAP_KEYS}>{text('Show Live map window')}</TrayItem>
          {/* Wall mode on Display 2 asks first in its sheet (L-06, WF-M3); while it is up, the tray closes it (MAP-24). */}
          {info.data?.wallOpen ? (
            <TrayItem onClick={() => tray('wall')} detail={wall?.display}>
              {text('Close wall mode')}
            </TrayItem>
          ) : wall ? (
            <TrayItem onClick={() => tray('wall')} detail={wall.name ? `${wall.name} ›` : '›'}>
              {text('Wall mode on {display}', { display: wall.display })}
            </TrayItem>
          ) : null}
          {/* Its display was unplugged (MAP-24 "the tray says so"), until the wall opens again. */}
          {info.data?.wallGone && !info.data.wallOpen ? (
            <p role="status" className="px-2 pb-1 text-[11.5px] text-warning-ink dark:text-warning">
              {text('Wall mode closed — its display was disconnected.')}
            </p>
          ) : null}
          <TrayItem onClick={() => tray('silence')} detail={silenced ? text('until {time}', { time: timeLabel(silenced) }) : undefined}>
            {text('Silence for 15 minutes')}
          </TrayItem>
          <TrayItem onClick={() => tray('quit')} quiet>
            {text('Quit WorkSuite')}
          </TrayItem>
        </div>
      </section>
    </div>
  );
}

function TrayItem({ onClick, keys, detail, quiet, children }: { onClick: () => void; keys?: string; detail?: string; quiet?: boolean; children: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[13px] hover:bg-selection hover:text-primary focus-visible:bg-selection focus-visible:text-primary', quiet ? 'text-ink-3' : 'text-ink')}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {keys ? <span className="font-mono text-[11.5px] text-ink-3">{keys}</span> : null}
      {detail ? <span className="text-[12px] whitespace-nowrap text-ink-3">{detail}</span> : null}
    </button>
  );
}
