import { useEffect, useMemo, useRef, useState } from 'react';
import type { WebchatRingState } from '@shared/types';
import { call, errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { Icon } from '../../../../components/Icon';
import { cx } from '../../../../components/ui';
import { useWebsiteInbox } from '../api';
import { joinSend, ReplyBox, useRingDraft } from '../RingCard';
import { Tile } from './LiveDashboard';
import { useLiveData } from './liveData';
import { callClock, clock, groupOf, onCall, pathOf, since, STATES, stateOf, whereOf, type Dashboard, type OnlineVisitor } from './liveMap';
import { Pill, TINT, VisitorAvatar } from './OnSiteNow';

/*
 * The Live dashboard outside the main window (worksuite-desktop L-04, L-05; WS-WCHAT MAP-UI-04/05): what the Live map
 * window and the tray's mini-dashboard share — the four small figures, who needs you with reply and join (UX-ALR-03),
 * and your own chats with Open. The rows are the dashboard's, joined and answered through the ringing card's paths, so
 * a chat that rings for me keeps its draft in step with the call window and the tray (UX-ALR-04).
 */

/**
 * The dashboard's figures and everybody on the sites, every ten seconds, as the Live dashboard reads them (C-00) — the
 * same answers (live/liveData, #248): the summary for the figures, the visitor list for the rows, each opening from the
 * copy this computer kept, so the Live map window and the tray show the main window's figures at once.
 */
export function useLiveDesk() {
  const live = useLiveData([], { full: false });
  const d = live.d;
  // What was said last in each chat, for the expanded row's quote.
  const inbox = useWebsiteInbox(false, !!d);
  const said = useMemo(() => new Map((inbox.data?.conversations ?? []).map((r) => [r.id, r.last_message?.body ?? null])), [inbox.data]);
  const dash = { isPending: !d && !live.cardsFailed, error: live.cardsFailed ? new Error(text("Couldn't load")) : null, refetch: live.retryAll };
  return { dash, d, visitors: live.visitors, skew: live.skew, said: (id: number) => said.get(id) ?? null };
}

/** Who needs you, worst first: at risk, then the longest wait (C-00's order). */
export function needsRows(visitors: OnlineVisitor[], now: number, skew = 0): OnlineVisitor[] {
  const wait = (v: OnlineVisitor) => since(v.chat?.waiting_since, now, skew) ?? 0;
  return visitors
    .filter((v) => v.conversation_id && groupOf(stateOf(v)) === 'needs')
    .sort((a, b) => STATES.indexOf(stateOf(a)) - STATES.indexOf(stateOf(b)) || wait(b) - wait(a));
}

/** My own chats (MAP-22 "Yours"): assigned to me, and not waiting on me — those are under Needs you. */
export function yoursRows(visitors: OnlineVisitor[]): OnlineVisitor[] {
  return visitors.filter((v) => v.conversation_id && v.chat?.mine && groupOf(stateOf(v)) === 'chat');
}

/**
 * The four small figures (MAP-UI-04/05): ON SITE, WAITING, AT RISK, then CHATS in the Live map window or REPLY — the
 * median first reply today — in the tray.
 */
export function DeskTiles({ d, last }: { d: Dashboard; last: 'chats' | 'reply' }) {
  return (
    <div role="list" aria-label={text('Right now')} className="flex gap-1.5">
      <Tile compact label="On site" value={String(d.now.visitors_online)} tone="plain" />
      <Tile compact label="Waiting" value={String(d.now.waiting_on_us)} tone={d.now.waiting_on_us ? 'amber' : 'plain'} />
      <Tile compact label="At risk" value={String(d.now.at_risk)} tone={d.now.at_risk ? 'red' : 'plain'} />
      {last === 'chats' ? (
        <Tile compact label="Chats" value={String(d.now.open + d.now.pending)} tone="plain" />
      ) : (
        <Tile compact label="Reply" value={d.today.first_response_median === null ? '—' : clock(d.today.first_response_median)} tone="plain" />
      )}
    </div>
  );
}

/** "NEEDS YOU · 2", "YOURS · 1": a group's name and count, red for those who need you. */
export function DeskHeading({ title, n, tone }: { title: string; n: number; tone?: 'red' }) {
  return (
    <p className={cx('px-3 pt-2 pb-0.5 text-[10px] font-bold tracking-[0.9px] uppercase', tone === 'red' ? 'text-[#c2392d] dark:text-danger' : 'text-ink-3')}>
      {text(title)} · {n}
    </p>
  );
}

const join = (v: OnlineVisitor) =>
  void call('ring:join', { id: v.conversation_id!, visitor: v.name || v.label }).catch((e) => toast('error', errorMessage(e)));

/**
 * Who needs you, with reply and join from right here (UX-ALR-03, MAP-21/22): the first row — or the one whose Reply
 * was pressed, or the one a notification's Show on map named — opened with what the visitor last wrote and a reply
 * box whose Send & join joins the chat, posts the words and stops the ring for everybody; every other row with Reply
 * and Join. Nothing opens the main window but Join itself, which brings it forward on the chat.
 */
export function NeedsYou({ rows, ring, said, now, skew = 0, limit = 4, focus = null, autoFocus = false }: {
  rows: OnlineVisitor[];
  /** The ringing state, for the visitor's words and the draft a ringing chat shares with the call window. */
  ring: WebchatRingState | null;
  said: (conversationId: number) => string | null;
  now: number;
  skew?: number;
  limit?: number;
  /** A conversation to open (Show on map, MAP-23). */
  focus?: number | null;
  /** The reply box takes the keyboard as it opens (the tray is opened to be typed in). */
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(focus);
  // A new focus opens its row (adjusted while rendering, not after).
  const [asked, setAsked] = useState(focus);
  if (focus !== asked) {
    setAsked(focus);
    if (focus) setOpen(focus);
  }
  const shown = rows.slice(0, limit);
  const expanded = shown.find((v) => v.conversation_id === open) ?? shown[0];
  if (!shown.length) return <p className="px-3 py-2 text-[12px] text-ink-3">{text('Nobody waiting')}</p>;
  return (
    <ul aria-label={text('Needs you')} className="flex flex-col">
      {shown.map((v) => (
        <NeedsRow key={v.id} v={v} open={v === expanded} ring={ring} said={said} now={now} skew={skew} autoFocus={autoFocus} onReply={() => setOpen(v.conversation_id)} />
      ))}
    </ul>
  );
}

function NeedsRow({ v, open, ring, said, now, skew, autoFocus, onReply }: { v: OnlineVisitor; open: boolean; ring: WebchatRingState | null; said: (id: number) => string | null; now: number; skew: number; autoFocus: boolean; onReply: () => void }) {
  const cid = v.conversation_id!;
  const who = v.name || v.label;
  const s = stateOf(v);
  const waited = clock(since(v.chat?.waiting_since, now, skew) ?? 0);
  const rung = ring?.chats.find((c) => c.id === cid) ?? null;
  const quote = rung?.preview ?? said(cid);
  const [draft, setDraft] = useRingDraft(cid, ring?.drafts?.[cid]);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && autoFocus) box.current?.querySelector('input')?.focus();
  }, [open, autoFocus]);
  const send = async () => {
    const words = draft.trim();
    if (!words || busy) return;
    setBusy(true);
    // Joins, sends and stops the ring for everyone in one request; this stays where it is (UX-ALR-03).
    const ok = await joinSend(cid, words, { visitor: who });
    setBusy(false);
    if (ok) setDraft('');
  };
  return (
    <li aria-label={who} className={cx('flex flex-col', TINT[s])}>
      <div className="flex items-center gap-[9px] px-3 py-[7px]">
        <VisitorAvatar v={v} small />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-ink">
            {who} · {whereOf(v)}
          </span>
          <span className="block truncate text-[11px] text-ink-2">
            {s === 'at_risk' ? text('At risk {time}', { time: waited }) : text('Waiting {time}', { time: waited })} · {pathOf(v.current_url)}
          </span>
        </span>
        {!open ? (
          <button type="button" aria-label="Reply" title={text('Reply to {name}', { name: who })} onClick={onReply} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-primary hover:bg-selection">
            <Icon name="reply" size={13} />
          </button>
        ) : null}
        <Pill tone="join" label={text('Join {name}', { name: who })} onClick={() => join(v)}>
          {text('Join')}
        </Pill>
      </div>
      {open ? (
        <div ref={box} className="flex flex-col gap-1.5 pr-3 pb-2 pl-[49px]">
          {quote ? <p className="line-clamp-2 text-[11.5px] text-[#6b4a4a] italic dark:text-ink-2">{`"${quote}"`}</p> : null}
          <ReplyBox id={`desk-reply-${cid}`} label={text('Reply to {name}', { name: who })} placeholder={text('Type a reply…')} sendLabel="Send & join" sendAria="Send and join" draft={draft} setDraft={setDraft} onSend={() => void send()} busy={busy} visitorSaid={quote} look="menu" />
        </div>
      ) : null}
    </li>
  );
}

/** My own chats with Open (MAP-22, MAP-11): on a call, a colleague typing, or what was said last. */
export function Yours({ rows, said, now, skew = 0, limit = 3 }: { rows: OnlineVisitor[]; said: (conversationId: number) => string | null; now: number; skew?: number; limit?: number }) {
  return (
    <ul aria-label={text('Yours')} className="flex flex-col">
      {rows.slice(0, limit).map((v) => {
        const who = v.name || v.label;
        const call_ = onCall(v.chat) ? since(v.chat?.call?.since, now, skew) : null;
        const last = said(v.conversation_id!);
        return (
          <li key={v.id} aria-label={who} className="flex items-center gap-[9px] px-3 py-[7px] hover:bg-subtle">
            <VisitorAvatar v={v} small />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-ink">
                {who} · {whereOf(v)}
              </span>
              <span className="block truncate text-[11px] text-ink-2">
                {call_ !== null ? (
                  <span className="font-semibold text-[#2b7a4b] dark:text-success">{text('On a call {time}', { time: callClock(call_) })}</span>
                ) : v.chat?.agent_typing ? (
                  text('typing…')
                ) : last ? (
                  `“${last}”`
                ) : (
                  pathOf(v.current_url)
                )}
              </span>
            </span>
            <Pill label={text('Open {name}', { name: who })} onClick={() => void call('live:open', { to: 'chat', id: v.conversation_id! }).catch(() => undefined)}>
              {text('Open')}
            </Pill>
          </li>
        );
      })}
    </ul>
  );
}
