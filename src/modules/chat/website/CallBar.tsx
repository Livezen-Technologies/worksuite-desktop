import { useEffect, useState, type ReactNode } from 'react';
import { apiPost } from '../../../core/api';
import { errorMessage, isMac } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { parseTs } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Modal, cx } from '../../../components/ui';
import { useNow } from '../../calls/parts';
import { callLive, WEBSITE, type WebsiteCall, type WebsiteConversation } from './api';
import { clock } from './Ringing';
import { useWebsiteCall, websiteCall } from './call';

/**
 * A visitor's voice call in their thread (WS-WCHAT ENH-WCHAT-05, VOICE-UI-03): ringing for me (Answer, Decline), on
 * with me (the time, the connection, Mute, Hold, Invite, Transfer, End with call notes), on with a colleague (Join),
 * or on with me on another device (Rejoin). The chat goes on under it.
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
  const asked = Number(query.get('call') ?? 0);
  useEffect(() => {
    if (!c || asked !== c.call_id || c.status === 'ringing' || !callLive(c) || !c.on_call || websiteCall.triedOnce(c.call_id)) return;
    void websiteCall.join(c.call_id, conversationId, visitor);
  }, [asked, c, conversationId, visitor]);

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
          <>
            <Button size="sm" variant="success" loading={busy} onClick={() => void join(c)}>Rejoin audio</Button>
            <Button size="sm" disabled={busy} onClick={() => void act(() => websiteCall.end(c.call_id, false, ''))}>Leave call</Button>
          </>
        ) : canJoinCall(data, me) ? (
          <Button size="sm" variant="success" loading={busy} onClick={() => void join(c)}>
            <Icon name="phone" size={13} /> Join call
          </Button>
        ) : null}
      </Strip>
    );
  }

  const s = session!;
  const status = s.phase === 'joining' ? 'Connecting…' : s.phase === 'reconnecting' ? 'Reconnecting…' : s.held ? 'On hold' : 'On a call';
  const muteKey = isMac ? '⌘⇧M' : 'Ctrl+Shift+M';
  return (
    <>
      <Strip tone={s.held || s.phase === 'reconnecting' ? 'warning' : 'success'} icon="phone" label="Voice call">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', s.speaking ? 'bg-success motion-safe:animate-pulse' : 'bg-current/40')} title={s.speaking ? `${visitor} is speaking` : undefined} />
        <b className="shrink-0">{status}</b>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono">{since(c.answered_at, now)}</span>
          {s.quality ? ` · ${QUALITY[s.quality]}` : ''}
          {c.on.length > 1 ? ` · with ${c.on.filter((p) => p.user_id !== me).map((p) => p.name).join(', ')}` : ''}
        </span>
        <button type="button" aria-pressed={s.muted} title={`${s.muted ? 'Unmute' : 'Mute'} (${muteKey})`} onClick={() => void websiteCall.mute()} className={btn}>
          <Icon name={s.muted ? 'mic-off' : 'mic'} size={13} /> {s.muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" aria-pressed={s.held} disabled={busy} onClick={() => void act(() => websiteCall.hold(!s.held))} className={btn}>
          <Icon name={s.held ? 'play' : 'pause'} size={13} /> {s.held ? 'Resume' : 'Hold'}
        </button>
        {onInvite ? (
          <button type="button" onClick={onInvite} className={btn}>
            <Icon name="user-plus" size={13} /> Invite
          </button>
        ) : null}
        {onTransfer ? (
          <button type="button" onClick={onTransfer} className={btn}>
            <Icon name="transfers" size={13} /> Transfer
          </button>
        ) : null}
        <button type="button" onClick={() => setEnding(true)} className="flex h-7 items-center gap-1 rounded-[7px] bg-danger px-2.5 text-[12px] font-bold text-white hover:brightness-110">
          <Icon name="phone-off" size={13} /> End
        </button>
      </Strip>
      {ending ? <EndDialog call={c} me={me} onClose={() => setEnding(false)} onDone={onDone} /> : null}
    </>
  );
}

const btn = 'flex h-7 items-center gap-1 rounded-[7px] border border-current/30 px-2 text-[12px] font-semibold hover:bg-black/5 disabled:opacity-50 aria-pressed:bg-black/10';

/** Leave, or end for everybody, with notes only staff see (VOICE-13). */
function EndDialog({ call, me, onClose, onDone }: { call: WebsiteCall; me: number | null; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState('');
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
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={4000} placeholder="What was agreed, what to follow up…" className="rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-normal outline-none focus:border-primary" />
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
        tone === 'success' && 'border-[#A9DDBF] bg-success-bg text-[#0F5132] dark:text-success',
        tone === 'warning' && 'border-[#F2D39B] bg-warning-bg text-[#7A4308] dark:text-warning',
        tone === 'danger' && 'border-[#F6C4B8] bg-danger-bg text-[#8C2A14] dark:text-danger',
        tone === 'muted' && 'border-line bg-subtle text-ink-2',
      )}
    >
      <Icon name={icon} size={15} className="shrink-0" />
      {children}
    </div>
  );
}
