import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiPost } from '../../../core/api';
import { errorMessage, isMac } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { parseTs } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Menu, type MenuSection } from '../../../components/Menu';
import { Button, Modal, cx } from '../../../components/ui';
import { useNow } from '../../../components/CallKit';
import { callLive, WEBSITE, type WebsiteCall, type WebsiteConversation } from './api';
import { clock } from './Ringing';
import { PANEL_CARD, PANEL_HEADING } from './rowParts';
import { useWebsiteCall, websiteCall, type CallDevices, type WebsiteCallState } from './call';

/**
 * A visitor's voice call in their thread (WS-WCHAT ENH-WCHAT-05, VOICE-UI-03): ringing for me (Answer, Decline), on
 * with me (the time, the connection, Mute, Hold, Invite, Transfer, End with call notes), on with a colleague (Join),
 * or on with me on another device (Rejoin). The chat goes on under it.
 *
 * On the call with me, it is V-03's call controls (VOICE-UI-02): "Voice call · Visitor 4F2A 02:14" over "Good
 * connection · not recorded", then Mute, Hold, Invite, Transfer and End as pills, green — amber on hold or while it
 * reconnects. Beside the thread, the CALL NOTES · STAFF ONLY panel (`CallNotes`).
 */

const QUALITY: Record<string, string> = { good: 'Good connection', fair: 'Fair connection', poor: 'Poor connection' };

/** m:ss since a server stamp. */
const since = (at: string | null, now: number): string => (at ? clock((now - parseTs(at).getTime()) / 1000) : '0:00');

/** Whether I may join a call on in this chat: its owner or a participant who takes calls (WF-V3). */
export function canJoinCall(data: Pick<WebsiteConversation, 'team' | 'conversation' | 'can_call'>, me: number | null): boolean {
  if (!data.can_call || me === null) return false;
  const role = data.team?.my_role ?? (data.conversation.assigned_to === me ? 'owner' : null);
  return role === 'owner' || role === 'participant';
}

export function CallBar({ data, me, visitor, onInvite, onTransfer, onDone }: { data: WebsiteConversation; me: number | null; visitor: string; onInvite?: () => void; onTransfer?: () => void; onDone: () => void }) {
  const c = data.call ?? null;
  const session = useWebsiteCall();
  const now = useNow(1_000);
  const { query } = useTab();
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = c ? session?.callId === c.call_id : false;
  const here = c ? websiteCall.on(c.call_id) : false;
  const conversationId = data.conversation.id;

  // Answered from the call window or the tray: WorkSuite came forward on this chat with `call=`, so join its audio once.
  // Invited into the chat during the call, or taking its transfer, the same (V-03, WF-V3, AC-V07): "Join chat" on the
  // card brings me into the call too — as somebody in the chat who takes calls.
  const asked = Number(query.get('call') ?? 0);
  const joinable = canJoinCall(data, me);
  useEffect(() => {
    if (!c || asked !== c.call_id || c.status === 'ringing' || !callLive(c) || (!c.on_call && !joinable) || websiteCall.triedOnce(c.call_id)) return;
    void websiteCall.join(c.call_id, conversationId, visitor);
  }, [asked, c, conversationId, visitor, joinable]);

  // The panel's notes start from what the server kept for me (V-03): a thread opened again picks up where I was.
  useEffect(() => {
    if (c && here) websiteCall.seedNotes(c.call_id, c.my_notes ?? '');
  }, [c, here]);

  // The server says the call is over, or that I am off it: let the room go.
  useEffect(() => {
    if (!c || !websiteCall.on(c.call_id)) return;
    if (!callLive(c) || (c.status !== 'ringing' && !c.on_call)) websiteCall.over(c.call_id);
  }, [c]);

  // Ctrl/Cmd+Shift+M mutes and unmutes while I am on the call here.
  useEffect(() => {
    if (!here) return;
    const key = (e: KeyboardEvent) => {
      if (e.shiftKey && (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        void websiteCall.mute();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [here]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const answer = (call: WebsiteCall) =>
    act(async () => {
      await apiPost(`${WEBSITE}/calls/${call.call_id}/answer`, {});
      await websiteCall.join(call.call_id, conversationId, visitor);
    });
  const join = (call: WebsiteCall) =>
    act(async () => {
      if (!(await websiteCall.join(call.call_id, conversationId, visitor))) throw new Error(websiteCall.snapshot()?.problem ?? 'Could not join the call.');
    });

  // What went wrong joining, with another go (VOICE-06).
  if (c && mine && session?.phase === 'failed') {
    return (
      <Strip tone="danger" icon="phone-off">
        <span className="min-w-0 flex-1">{session.problem ?? 'Could not join the call.'}</span>
        {callLive(c) && c.status !== 'ringing' ? <Button size="sm" loading={busy} onClick={() => void join(c)}>Try again</Button> : null}
      </Strip>
    );
  }
  if (!c || !callLive(c)) return null;

  if (c.status === 'ringing') {
    return c.rings_me ? (
      <Strip tone="success" icon="phone-incoming" label="Voice call ringing">
        <b className="shrink-0">{visitor} is calling</b>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{since(c.requested_at, now)}</span>
        <Button size="sm" variant="success" loading={busy} onClick={() => void answer(c)}>
          <Icon name="phone" size={13} /> Answer
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void act(() => apiPost(`${WEBSITE}/calls/${c.call_id}/decline`, {}))}>Decline</Button>
      </Strip>
    ) : (
      <Strip tone="muted" icon="phone-incoming" label="Voice call ringing">
        <span className="min-w-0 flex-1 truncate">{visitor} is calling the team · {since(c.requested_at, now)}</span>
      </Strip>
    );
  }

  if (!here) {
    const others = c.on.filter((p) => p.user_id !== me).map((p) => p.name);
    return (
      <Strip tone="muted" icon="phone" label="Voice call">
        <span className="min-w-0 flex-1 truncate">
          {c.on_call ? 'You are on this call, but not on this computer' : `${others.length ? others.join(', ') : (c.answered_by_name ?? 'A colleague')} ${others.length > 1 ? 'are' : 'is'} on a call with ${visitor}`}
          {' · '}
          {since(c.answered_at, now)}
          {c.status === 'on_hold' ? ' · on hold' : ''}
        </span>
        {c.on_call ? (
          // Leaving from here: the server saves the notes I wrote on the other device (V-03).
          <>
            <Button size="sm" variant="success" loading={busy} onClick={() => void join(c)}>Rejoin audio</Button>
            <Button size="sm" disabled={busy} onClick={() => void act(() => websiteCall.end(c.call_id, false))}>Leave call</Button>
          </>
        ) : canJoinCall(data, me) ? (
          <Button size="sm" variant="success" loading={busy} onClick={() => void join(c)}>
            <Icon name="phone" size={13} /> Join call
          </Button>
        ) : null}
      </Strip>
    );
  }

  return (
    <>
      <OnCall call={c} s={session!} me={me} visitor={visitor} now={now} busy={busy} onHold={() => void act(() => websiteCall.hold(!session!.held))} onInvite={onInvite} onTransfer={onTransfer} onEnd={() => setEnding(true)} />
      {ending ? <EndDialog call={c} me={me} onClose={() => setEnding(false)} onDone={onDone} /> : null}
    </>
  );
}

/**
 * The call controls while I am on the call here (V-03, VOICE-UI-02; VOICE-13, VNFR-04): who and how long, how the line
 * is and whether it is recorded, then Mute, Hold, Invite, Transfer, the audio devices and End. The timer ticks inside a
 * plain region; state changes alone are announced, through their own live line, so a screen reader is not read the
 * clock every second.
 */
function OnCall({ call: c, s, me, visitor, now, busy, onHold, onInvite, onTransfer, onEnd }: {
  call: WebsiteCall; s: WebsiteCallState; me: number | null; visitor: string; now: number; busy: boolean;
  onHold: () => void; onInvite?: () => void; onTransfer?: () => void; onEnd: () => void;
}) {
  const muteKey = isMac ? '⌘⇧M' : 'Ctrl+Shift+M';
  const others = c.on.filter((p) => p.user_id !== me).map((p) => p.name);
  const amber = s.held || s.phase === 'reconnecting';
  const state = s.phase === 'joining' ? 'Connecting…' : s.phase === 'reconnecting' ? 'Reconnecting…' : s.held ? 'On hold — they hear the hold tone' : s.quality ? QUALITY[s.quality] : 'Connected';
  const line = [state, c.recorded ? 'Recording' : 'not recorded', others.length ? `with ${others.join(', ')}` : null, s.muted ? 'you are muted' : null].filter(Boolean).join(' · ');
  // What a screen reader hears when it changes (VNFR-04): never the ticking time.
  const heard = s.phase === 'joining' ? 'Connecting the call' : s.phase === 'reconnecting' ? 'Reconnecting the call' : s.held ? 'Call on hold' : s.muted ? 'On the call, muted' : `On a call with ${visitor}`;
  const pill = cx(
    'flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border bg-surface px-[13px] text-[13px] font-semibold hover:brightness-95 disabled:opacity-50',
    amber ? 'border-warning-line text-warning-strong dark:text-warning' : 'border-success-line text-success-ink dark:text-success',
    'aria-pressed:bg-subtle',
  );
  return (
    <div
      role="region"
      aria-label="Call controls"
      className={cx(
        'flex min-h-[58px] shrink-0 flex-wrap items-center gap-2.5 border-b px-4 py-2',
        amber ? 'border-warning-line bg-warning-bg' : 'border-success-line bg-success-bg',
      )}
    >
      <span className="sr-only" role="status" aria-live="polite">{heard}</span>
      {/* The dot breathes while the visitor speaks. */}
      <span
        aria-hidden="true"
        title={s.speaking ? `${visitor} is speaking` : undefined}
        className={cx('h-2.5 w-2.5 shrink-0 rounded-full', amber ? 'bg-warning shadow-[0_0_0_4px_rgb(242_211_155/.6)]' : 'bg-success shadow-[0_0_0_4px_var(--ws-success-line)] dark:shadow-none', s.speaking && 'motion-safe:animate-pulse')}
      />
      <div className="min-w-[180px] flex-1">
        <div className={cx('truncate text-[14px] font-bold', amber ? 'text-warning-strong dark:text-warning' : 'text-success-ink dark:text-success')}>
          Voice call · {visitor} <span className="font-mono font-medium tabular-nums">{since(c.answered_at, now)}</span>
        </div>
        <div className={cx('truncate text-[12px]', amber ? 'text-yellow-ink dark:text-warning' : 'text-success dark:text-success')}>{line}</div>
      </div>
      <button type="button" aria-pressed={s.muted} title={`${s.muted ? 'Unmute' : 'Mute'} (${muteKey})`} onClick={() => void websiteCall.mute()} className={pill}>
        <Icon name={s.muted ? 'mic-off' : 'mic'} size={14} /> {s.muted ? 'Unmute' : 'Mute'}
      </button>
      <button type="button" aria-pressed={s.held} disabled={busy} onClick={onHold} className={pill}>
        <Icon name={s.held ? 'play' : 'pause'} size={14} /> {s.held ? 'Resume' : 'Hold'}
      </button>
      {onInvite ? (
        <button type="button" title="Ask a colleague into the chat and the call" onClick={onInvite} className={pill}>
          <Icon name="user-plus" size={14} /> Invite
        </button>
      ) : null}
      {onTransfer ? (
        <button type="button" title="Hand the chat and the call to a colleague" onClick={onTransfer} className={pill}>
          <Icon name="transfers" size={14} /> Transfer
        </button>
      ) : null}
      <DevicesButton className={pill} />
      <button type="button" onClick={onEnd} className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-danger px-4 text-[13px] font-bold text-white hover:brightness-110">
        <Icon name="phone-off" size={14} /> End
      </button>
    </div>
  );
}

/**
 * The microphone and speaker the call uses (VOICE-14: "audio through the chosen headset"): switched now, and kept for
 * the next call on this computer — the same choice Meet and Team Chat calls make.
 */
function DevicesButton({ className }: { className: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [list, setList] = useState<CallDevices | null>(null);
  const open = () => void websiteCall.devices().then(setList, () => setList({ mics: [], speakers: [], mic: '', speaker: '' }));
  const sections = (d: CallDevices): MenuSection[] => [
    {
      id: 'mic',
      label: 'Microphone',
      items: [{ id: 'mic:', label: 'System default', radio: true, checked: !d.mic, onSelect: () => void websiteCall.useDevice('mic', '') }].concat(
        d.mics.map((m) => ({ id: `mic:${m.id}`, label: m.label, radio: true, checked: d.mic === m.id, onSelect: () => void websiteCall.useDevice('mic', m.id) })),
      ),
    },
    {
      id: 'speaker',
      label: 'Speaker',
      items: [{ id: 'spk:', label: 'System default', radio: true, checked: !d.speaker, onSelect: () => void websiteCall.useDevice('speaker', '') }].concat(
        d.speakers.map((m) => ({ id: `spk:${m.id}`, label: m.label, radio: true, checked: d.speaker === m.id, onSelect: () => void websiteCall.useDevice('speaker', m.id) })),
      ),
    },
  ];
  return (
    <>
      <button ref={anchor} type="button" aria-label="Audio devices" title="Microphone and speaker" aria-haspopup="menu" aria-expanded={!!list} onClick={open} className={cx(className, 'px-2.5')}>
        <Icon name="sliders" size={14} />
      </button>
      {list ? <Menu label="Audio devices" anchor={anchor} prefer="bottom" align="end" sections={sections(list)} onClose={() => setList(null)} /> : null}
    </>
  );
}

/**
 * CALL NOTES · STAFF ONLY, beside the thread while I am on the call here (V-03, VOICE-UI-02; VOICE-13, TEAM-60): kept on
 * the server as I write, and "saved as an internal note when the call ends" — however it ends.
 */
export function CallNotes({ call }: { call: WebsiteCall | null | undefined }) {
  const s = useWebsiteCall();
  if (!call || !s || s.callId !== call.call_id || !websiteCall.on(call.call_id)) return null;
  return (
    <section aria-label="Call notes" className={cx(PANEL_CARD, 'gap-2')}>
      <h3 className={PANEL_HEADING}>Call notes · staff only</h3>
      <textarea
        aria-label="Call notes"
        value={s.notes ?? ''}
        onChange={(e) => websiteCall.setNotes(e.target.value)}
        onBlur={() => void websiteCall.saveNotes()}
        rows={6}
        maxLength={4000}
        placeholder="What they want, what to send after the call…"
        className="min-h-[150px] resize-y rounded-[10px] border border-line bg-subtle px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
      />
      <p className="text-[12px] text-ink-3">{s.notesUnsaved ? 'Not saved yet — kept here, and saved when you end the call.' : 'Saved as an internal note when the call ends.'}</p>
    </section>
  );
}

/**
 * A call's line in the transcript as staff read it (V-03, VOICE-12): "Voice call started by the visitor · you
 * answered after 0:12", green; a missed or dropped one red. The server writes one line both sides read ("Voice call
 * started · Nuwan answered after 0:12"); who answered is the line's own author, so "you" is only ever said to them.
 */
export function callNotice(body: string | null, authorId: number | null | undefined, me: number | null): { body: string; tone: 'call' | 'missed' } | null {
  if (!body) return null;
  const started = /^Voice call started · (.+) answered after (\d+:\d{2})$/.exec(body);
  if (started) {
    const who = authorId !== null && authorId !== undefined && authorId === me ? 'you' : started[1];
    return { body: `Voice call started by the visitor · ${who} answered after ${started[2]}`, tone: 'call' };
  }
  if (/^Voice call (requested|ended)\b/.test(body)) return { body, tone: 'call' };
  if (/^(Missed voice call|Voice call dropped)\b/.test(body)) return { body, tone: 'missed' };
  return null;
}

/**
 * Leave, or end for everybody, with notes only staff see (VOICE-13). The notes are the panel's (V-03): one text,
 * whichever of the two it is written in.
 */
function EndDialog({ call, me, onClose, onDone }: { call: WebsiteCall; me: number | null; onClose: () => void; onDone: () => void }) {
  const s = useWebsiteCall();
  const notes = s?.callId === call.call_id ? (s.notes ?? '') : '';
  const [busy, setBusy] = useState<'leave' | 'end' | null>(null);
  const others = call.on.some((p) => p.user_id !== me);
  const go = async (forEveryone: boolean) => {
    setBusy(forEveryone ? 'end' : 'leave');
    try {
      await websiteCall.end(call.call_id, forEveryone, notes);
      onClose();
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="End the call" labelledBy="website-call-end" onClose={onClose} width={440} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        {others ? <Button loading={busy === 'leave'} disabled={!!busy} onClick={() => void go(false)}>Leave the call</Button> : null}
        <Button variant="danger" loading={busy === 'end'} disabled={!!busy} onClick={() => void go(true)}>{others ? 'End for everyone' : 'End call'}</Button>
      </>
    }>
      <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink">
        Call notes
        <textarea value={notes} onChange={(e) => websiteCall.setNotes(e.target.value)} rows={4} maxLength={4000} placeholder="What was agreed, what to follow up…" className="rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-normal outline-none focus:border-primary" />
      </label>
      <p className="mt-1.5 text-[12px] text-ink-3">Kept on the chat as a note only staff see.{others ? ' Leaving keeps the call going for the others.' : ''}</p>
    </Modal>
  );
}

function Strip({ tone, icon, label, children }: { tone: 'success' | 'warning' | 'danger' | 'muted'; icon: 'phone' | 'phone-off' | 'phone-incoming'; label?: string; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cx(
        'flex shrink-0 flex-wrap items-center gap-2 border-b px-3.5 py-1.5 text-[12.5px]',
        tone === 'success' && 'border-success-line bg-success-bg text-success-ink dark:text-success',
        tone === 'warning' && 'border-warning-line bg-warning-bg text-warning-strong dark:text-warning',
        tone === 'danger' && 'border-danger-line bg-danger-bg text-danger-ink dark:text-danger',
        tone === 'muted' && 'border-line bg-subtle text-ink-2',
      )}
    >
      <Icon name={icon} size={15} className="shrink-0" />
      {children}
    </div>
  );
}
