import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WebchatJoined, WebchatRingChat, WebchatRingState } from '@shared/types';
import { call, errorMessage, isMac } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Avatar, cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { write, writerProblem, useWriter } from '../../ai/writer';
import { useCanned } from './api';
import { clock, handoverIn, stageLabel, waited } from './Ringing';

/**
 * The website chat ringing card (worksuite-desktop#225), in the call window over other apps:
 *
 * - one chat ringing: who and where, what they are reading, what they wrote, quick replies, a reply box whose Send
 *   joins the chat and sends in one step, Join chat, Transfer (a chat given to me) and Silence;
 * - several: compact cards, each with what the visitor wrote, its own reply box, Join and Silence;
 * - after joining from it: a mini chat — "You joined the chat", what I sent, a reply box and Open full chat — until I
 *   open the full chat or minimise it.
 *
 * The window is as tall as the card: it measures itself (`ring:fit`), so nothing is cut off and nothing is left empty.
 */

const QUICK = ['Hi! How can I help?', 'One moment, checking for you', 'Can I call you back?'];

/** The window takes the card's height. */
export function useFit(): (el: HTMLDivElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (el) => {
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const report = () => void call('ring:fit', { height: Math.max(80, Math.min(1200, Math.ceil(el.getBoundingClientRect().height))) }).catch(() => undefined);
    observer.current = new ResizeObserver(report);
    observer.current.observe(el);
    report();
  };
}

const minimise = () => void call('ring:minimise').catch(() => undefined);

/** The card's frame: dark, the header's red dot and status, and minimise. */
function Frame({ dot, status, badge, children, hint, after }: { dot: 'ringing' | 'silenced' | 'joined'; status: string; badge?: ReactNode; children: ReactNode; hint: string; after?: ReactNode }) {
  // Esc minimises, wherever focus is in the card.
  return (
    <div className="flex flex-col bg-[#131838] text-[13px] text-[#E6E8F5]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), minimise())}>
      <div className="drag flex items-center gap-2 py-2.5 pr-3 pl-4">
        <span className={cx('h-[9px] w-[9px] rounded-full', dot === 'joined' ? 'bg-[#22C55E] shadow-[0_0_0_4px_rgba(34,197,94,0.18)]' : dot === 'silenced' ? 'bg-[#F5B94A] shadow-[0_0_0_4px_rgba(245,185,74,0.18)]' : 'bg-[#EF5A4C] shadow-[0_0_0_4px_rgba(239,90,76,0.2)] motion-safe:animate-pulse')} />
        <span className="flex-1 truncate text-[11px] font-bold tracking-[.08em] text-[#AEB3D1] uppercase">{status}</span>
        {badge}
        <button type="button" aria-label="Minimise notification" title="Minimise (Esc)" onClick={minimise} className="no-drag flex h-7 w-7 items-center justify-center rounded-[7px] text-[#8C92B5] hover:bg-white/7 hover:text-white">
          <Icon name="minus" size={14} />
        </button>
      </div>
      {children}
      {after}
      <p className="drag px-4 pt-3 pb-3.5 text-[11px] text-[#8C92B5]">{hint}</p>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'green' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={cx('shrink-0 rounded-full px-2 py-[3px] text-[11px] font-semibold', tone === 'green' ? 'bg-[rgba(34,197,94,0.12)] text-[#6EE7A0]' : tone === 'red' ? 'bg-[rgba(239,90,76,0.16)] text-[#FFB4A4]' : 'bg-[rgba(102,118,255,0.16)] text-[#C3CAFF]')}>{children}</span>;
}

/** Who the visitor is: name, new or returning, site · place · device, and how long they have waited. */
function Visitor({ c, now, hidden, joined }: { c: Pick<WebchatRingChat, 'visitor' | 'site' | 'place' | 'device' | 'since'> & { returning?: boolean }; now: number; hidden: boolean; joined?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 pt-0.5 pb-3">
      <span className="relative">
        <Avatar name={hidden ? '?' : c.visitor} size={44} />
        <span className="absolute -right-px -bottom-px h-[11px] w-[11px] rounded-full border-2 border-[#131838] bg-[#22C55E]" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-center gap-2">
          <b className="truncate text-[16px] text-white">{hidden ? 'A website visitor' : c.visitor}</b>
          {!hidden && c.returning !== undefined ? <Badge tone="blue">{c.returning ? 'Returning' : 'New visitor'}</Badge> : null}
        </span>
        <span className="truncate text-[12px] text-[#AEB3D1]">{hidden ? 'Unlock WorkSuite to see who.' : [c.site, c.place, c.device].filter(Boolean).join(' · ') || 'Website chat'}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className={cx('font-mono text-[15px] font-bold tabular-nums', joined ? 'text-[#AEB3D1]' : 'text-[#F2B77E]')}>{waited(c.since, now)}</span>
        <span className="text-[10px] text-[#8C92B5]">{joined ? 'waited' : 'waiting'}</span>
      </span>
    </div>
  );
}

/** "Reading: …" on its own line, so it is never cut off by the rest. */
function Reading({ page }: { page: string }) {
  return (
    <div className="mx-4 flex items-center gap-2 rounded-[9px] bg-white/[.04] px-2.5 py-2 text-[12px] text-[#AEB3D1]">
      <Icon name="eye" size={14} className="shrink-0" />
      <span className="truncate">Reading: {page}</span>
    </div>
  );
}

function Theirs({ text }: { text: string }) {
  return <div className="max-w-[85%] self-start rounded-[4px_14px_14px_14px] border border-white/6 bg-[#1E2450] px-3 py-2 text-[14px] leading-[1.45] break-words whitespace-pre-wrap">{text}</div>;
}

function Mine({ text, last }: { text: string; last: boolean }) {
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-[3px] self-end">
      <div className="rounded-[14px_14px_4px_14px] bg-[#4F5FEF] px-3 py-2 text-[14px] leading-[1.45] break-words whitespace-pre-wrap text-white">{text}</div>
      {last ? <span className="text-[11px] text-[#8C92B5]">Sent</span> : null}
    </div>
  );
}

/**
 * The reply box: what is typed, the AI button (a reply to what the visitor wrote, when this workspace has the
 * writing assistant) and Send. Enter sends.
 */
function ReplyBox({ id, label, placeholder, sendLabel, draft, setDraft, onSend, busy, visitorSaid, disabled }: {
  id: string; label: string; placeholder: string; sendLabel: string; draft: string; setDraft: (v: string) => void; onSend: () => void; busy: boolean; visitorSaid: string | null; disabled?: boolean;
}) {
  const writer = useWriter();
  const canWrite = !!writer.data?.available && writer.data.actions.some((a) => a.key === 'reply') && !!visitorSaid;
  const [thinking, setThinking] = useState(false);
  const ai = async () => {
    if (!visitorSaid || thinking) return;
    setThinking(true);
    try {
      setDraft(await write('reply', `Visitor: ${visitorSaid}`));
    } catch (e) {
      toast('error', writerProblem(e));
    } finally {
      setThinking(false);
    }
  };
  const ready = !!draft.trim() && !busy && !disabled;
  return (
    <div className={cx('flex items-center gap-1.5 rounded-[12px] border bg-[#0E1231] py-1 pr-1 pl-3', draft ? 'border-[#6676FF]' : 'border-white/10')}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="text"
        value={draft}
        disabled={disabled}
        maxLength={4000}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (ready) onSend();
          }
        }}
        placeholder={placeholder}
        className="h-[38px] min-w-0 flex-1 bg-transparent text-[14px] text-[#E6E8F5] outline-none placeholder:text-[#8C92B5]"
      />
      {canWrite ? (
        <button type="button" aria-label="Write with AI" title="Write a reply with AI" disabled={thinking || disabled} onClick={() => void ai()} className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[#AEB8FF] hover:bg-white/7 disabled:opacity-50">
          <Icon name={thinking ? 'spinner' : 'sparkles'} size={16} className={cx(thinking && 'animate-spin')} />
        </button>
      ) : null}
      <button type="button" disabled={!ready} onClick={onSend} className={cx('flex h-[38px] items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold text-white', ready ? 'bg-[#4F5FEF] hover:brightness-110' : 'bg-[#3A4170] text-white/70')}>
        <Icon name="send" size={15} />
        {sendLabel}
      </button>
    </div>
  );
}

/** Quick replies: the team's most used saved replies, or three plain ones; a click puts one in the box. */
function Chips({ pick, enabled }: { pick: (text: string) => void; enabled: boolean }) {
  const canned = useCanned(enabled);
  const chips = (canned.data?.responses ?? []).slice(0, 3).map((r) => ({ label: r.title || r.body, text: r.body }));
  const list = chips.length ? chips : QUICK.map((t) => ({ label: t, text: t }));
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-1.5" role="group" aria-label="Quick replies">
      {list.map((c) => (
        <button key={c.label} type="button" onClick={() => pick(c.text)} className="h-[30px] max-w-full truncate rounded-full border border-white/14 bg-white/[.04] px-[11px] text-[12px] font-medium text-[#E6E8F5] hover:bg-white/10">
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Join chat and Join & send: one request, first come; a moment too late, the card says who has it. */
async function joinSend(id: number, message?: string): Promise<boolean> {
  try {
    const r = await call('ring:joinSend', { id, ...(message ? { message } : {}) });
    return r.ok;
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

const silence = (id: number, on: boolean) => void call('ring:silence', { id, on }).catch(() => undefined);

/** One chat ringing (#225, design 1). */
export function RingCard({ s, c, now, after }: { s: WebchatRingState; c: WebchatRingChat; now: number; after?: ReactNode }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const joinKey = isMac ? '⌘⇧J' : 'Ctrl+Shift+J';
  const handover = c.mine ? handoverIn(c.handoverAt, now) : null;
  const send = async (withText: boolean) => {
    if (busy) return;
    setBusy(true);
    const ok = await joinSend(c.id, withText ? draft.trim() : undefined);
    setBusy(false);
    if (ok) setDraft('');
  };
  const hint = s.outcome ? s.outcome.text : s.elsewhere ? 'Ringing on your other device — shown here without sound' : `Enter sends and joins${s.shortcut ? ` · ${joinKey} join` : ''} · Esc minimises · rings until someone joins`;
  return (
    <Frame
      dot={c.silenced ? 'silenced' : 'ringing'}
      status={c.silenced ? 'Website chat · ringing (silenced)' : 'Website chat · ringing'}
      badge={<Badge tone={c.atRisk ? 'red' : c.mine ? 'green' : 'blue'}>{stageLabel(c)}</Badge>}
      hint={hint}
      after={after}
    >
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A website chat is waiting.' : `Website chat: ${c.visitor}${c.site ? ` on ${c.site}` : ''} is waiting.`}
      </div>
      <Visitor c={c} now={now} hidden={s.hidden} />
      {!s.hidden && c.page ? <Reading page={c.page} /> : null}
      {!s.hidden && c.preview ? (
        <div className="flex flex-col gap-2 px-4 pt-3 pb-1">
          <Theirs text={c.preview} />
        </div>
      ) : null}
      {c.mine && c.by ? <p className="px-4 pt-1 text-[11.5px] text-[#AEB3D1]">Assigned to you by {c.by}</p> : null}
      {!s.hidden ? (
        <>
          <Chips pick={setDraft} enabled={!s.hidden} />
          <div className="px-4 pt-2.5">
            <ReplyBox id={`ring-reply-${c.id}`} label="Reply to visitor" placeholder="Type a reply to join and send" sendLabel="Join & send" draft={draft} setDraft={setDraft} onSend={() => void send(true)} busy={busy} visitorSaid={c.preview} />
          </div>
        </>
      ) : null}
      <div className="flex gap-2 px-4 pt-3">
        <button type="button" disabled={s.hidden || busy} onClick={() => void send(false)} className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-[11px] bg-[#22A35A] text-[14px] font-bold text-white hover:brightness-110 disabled:opacity-50">
          <Icon name="chat" size={16} />
          Join chat
        </button>
        {c.mine ? (
          <button type="button" disabled={s.hidden} onClick={() => void call('ring:join', { id: c.id, then: 'transfer' }).catch((e) => toast('error', errorMessage(e)))} className="h-11 flex-1 rounded-[11px] border border-white/14 text-[13px] font-semibold hover:bg-white/7 disabled:opacity-50">
            Transfer
          </button>
        ) : null}
        <button
          type="button"
          aria-label={c.silenced ? 'Unmute ringing' : 'Silence ringing'}
          aria-pressed={c.silenced}
          title={c.silenced ? 'Unmute ringing' : 'Silence ringing'}
          onClick={() => silence(c.id, !c.silenced)}
          className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-white/14 hover:bg-white/7', c.silenced && 'bg-white/10')}
        >
          <Icon name="bell-off" size={17} />
        </button>
      </div>
      {handover !== null ? (
        // A chat given to me passes on if I do not join it in time (RING-UI-02).
        <div className="px-4 pt-2.5" role="timer" aria-label={`Passes on in ${clock(handover)}`}>
          <div className="h-1 overflow-hidden rounded-full bg-[#22305C]">
            <div className="h-full rounded-full bg-[#8FA6E0] transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, (handover / 60) * 100)}%` }} />
          </div>
          <p className="mt-1 flex items-center gap-2 text-[11.5px] text-[#AEB3D1]">
            <span className="flex-1">Passes to the next available agent in {clock(handover)} if you don't join</span>
            <button type="button" onClick={() => void call('ring:pass', { id: c.id }).catch((e) => toast('error', errorMessage(e)))} className="font-semibold text-[#AEB8FF] hover:underline">
              Pass now
            </button>
          </p>
        </div>
      ) : null}
    </Frame>
  );
}

/** One of several chats ringing, compact (#225, design 2): what they wrote, a reply box, Join and Silence. */
function StackRow({ s, c, now }: { s: WebchatRingState; c: WebchatRingChat; now: number }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await joinSend(c.id, draft.trim() || undefined);
    setBusy(false);
    if (ok) setDraft('');
  };
  const name = s.hidden ? 'A visitor' : c.visitor;
  return (
    <li className="flex flex-col gap-2.5 rounded-[14px] border border-white/10 bg-[#131838] py-3 pr-3 pl-3.5" aria-label={name}>
      <div className="flex items-center gap-2.5">
        <Avatar name={s.hidden ? '?' : c.visitor} size={36} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <b className="truncate text-[14px] text-white">{name}</b>
            {!s.hidden && c.site ? <span className="truncate text-[11px] text-[#8C92B5]">{c.site}</span> : null}
            {c.atRisk || c.mine ? <Badge tone={c.atRisk ? 'red' : 'green'}>{stageLabel(c)}</Badge> : null}
          </span>
          <span className="truncate text-[13px] text-[#C9CDE6]">{s.hidden ? 'Unlock WorkSuite to see who.' : (c.preview ?? (c.page ? `Reading ${c.page}` : 'Waiting for someone'))}</span>
        </span>
        <span className={cx('shrink-0 font-mono text-[13px] font-bold tabular-nums', c.atRisk ? 'text-[#FF8A73]' : 'text-[#F2B77E]')}>{waited(c.since, now)}</span>
      </div>
      <div className="flex gap-1.5">
        <span className="flex h-9 flex-1 items-center rounded-[9px] border border-white/10 bg-[#0E1231] px-2.5">
          <label htmlFor={`ring-row-${c.id}`} className="sr-only">Reply to {name}</label>
          <input
            id={`ring-row-${c.id}`}
            type="text"
            value={draft}
            disabled={s.hidden}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                e.preventDefault();
                void go();
              }
            }}
            placeholder="Reply to join…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#E6E8F5] outline-none placeholder:text-[#8C92B5]"
          />
        </span>
        <button type="button" disabled={s.hidden || busy} onClick={() => void go()} className="h-9 rounded-[9px] bg-[#22A35A] px-3.5 text-[13px] font-bold text-white hover:brightness-110 disabled:opacity-50">
          {draft.trim() ? 'Join & send' : 'Join'}
        </button>
        <button type="button" aria-label={`${c.silenced ? 'Unmute' : 'Silence'} ${name}`} aria-pressed={c.silenced} onClick={() => silence(c.id, !c.silenced)} className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-white/14 hover:bg-white/7', c.silenced && 'bg-white/10')}>
          <Icon name="bell-off" size={15} />
        </button>
      </div>
    </li>
  );
}

/** Several chats ringing (#225, design 2): "N chats waiting · Open inbox", then a compact card each. */
export function RingStack({ s, chats, now, after }: { s: WebchatRingState; chats: WebchatRingChat[]; now: number; after?: ReactNode }) {
  const shown = chats.slice(0, 3);
  return (
    <div className="flex flex-col gap-2.5 bg-[#0F1438] p-2.5 text-[13px] text-[#E6E8F5]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), minimise())}>
      <div className="sr-only" role="alert" aria-live="assertive">{`${chats.length} website chats are waiting.`}</div>
      <div className="drag flex items-center gap-2 px-1 text-[12px] text-[#C9CDE6]">
        <span className="h-2 w-2 rounded-full bg-[#EF5A4C] motion-safe:animate-pulse" />
        <b className="flex-1 font-semibold">{chats.length} chats waiting</b>
        <button type="button" onClick={() => void call('ring:openInbox').catch(() => undefined)} className="no-drag font-semibold text-[#AEB8FF] hover:text-white">
          Open inbox
        </button>
        <button type="button" aria-label="Minimise notification" onClick={minimise} className="no-drag flex h-7 w-7 items-center justify-center rounded-[7px] text-[#8C92B5] hover:bg-white/7 hover:text-white">
          <Icon name="minus" size={14} />
        </button>
      </div>
      <ul className="flex flex-col gap-2.5" aria-label="Chats waiting">
        {shown.map((c) => <StackRow key={c.id} s={s} c={c} now={now} />)}
      </ul>
      {chats.length > shown.length ? <p className="px-1 text-[11.5px] text-[#AEB3D1]">+{chats.length - shown.length} more waiting</p> : null}
      {after}
      {s.outcome ? <p className="px-1 text-[11.5px] text-[#AEB3D1]">{s.outcome.text}</p> : null}
    </div>
  );
}

/** After joining from the card (#225): a mini chat until I open the full chat or minimise it. */
export function JoinedCard({ j, now }: { j: WebchatJoined; now: number }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await call('ring:reply', { message: text });
      if (r.ok) setDraft('');
      else toast('error', r.why ?? 'The reply was not sent.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame dot="joined" status="Website chat · you joined" badge={<Badge tone="green">Your chat</Badge>} hint="The visitor sees you joined · Esc to minimise">
      <Visitor c={j} now={now} hidden={false} joined />
      {j.page ? <Reading page={j.page} /> : null}
      <div className="flex flex-col gap-2 px-4 pt-3 pb-1">
        {j.preview ? <Theirs text={j.preview} /> : null}
        <div className="self-center text-[11px] text-[#8C92B5]">You joined the chat</div>
        {j.sent.map((t, i) => <Mine key={i} text={t} last={i === j.sent.length - 1} />)}
      </div>
      <div className="px-4 pt-2.5">
        <ReplyBox id="ring-joined-reply" label={`Reply to ${j.visitor}`} placeholder="Reply…" sendLabel="Send" draft={draft} setDraft={setDraft} onSend={() => void send()} busy={busy} visitorSaid={j.preview} />
      </div>
      <div className="flex gap-2 px-4 pt-3">
        <button type="button" onClick={() => void call('ring:closeJoined', { open: true }).catch(() => undefined)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[11px] bg-[#4F5FEF] text-[14px] font-bold text-white hover:brightness-110">
          Open full chat
          <Icon name="external" size={14} />
        </button>
      </div>
    </Frame>
  );
}
