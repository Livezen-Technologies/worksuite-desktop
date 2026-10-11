import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { AUDIENCES, audienceOf, type ChatAudience } from '@shared/meet-chat';
import { Thread } from '../chat/Thread';

/**
 * The meeting's chat, as one thread with an audience (the Meet Side Panel
 * canvas).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Chat tab used to stack three things: the meeting chat, a collapsed
 * "Desktop guest chat", and a collapsed "Workspace conversation (members
 * only)". Three composers, and no way to tell from any of them who would read
 * what you typed. There is one composer now, and a picker that says exactly
 * who sees it — which is the question somebody is actually asking when they
 * hesitate before sending.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE AUDIENCES ARE TRANSPORTS THAT ALREADY EXIST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Everyone** is the meeting's own chat — `communication_meet_browser_chat`,
 * which has no account ids in it and is what a guest in a browser sees.
 * **Staff only** is the meeting's workspace conversation, which guests have no
 * access to at all. Nothing new is stored and no message changes hands
 * differently; the picker chooses which of the two a message goes to, and
 * says so before it is sent.
 *
 * **The canvas's third audience — a private message to one person — is not
 * here.** The meeting chat has no recipient column and no audience column, and
 * a workspace DM is a different conversation rather than part of this meeting.
 * Drawing the option and sending it to everybody would be the worst possible
 * version of it.
 */
export function MeetChatPanel({ uuid, roomId, chat, canManage }: { uuid: string; roomId: number | null; chat: string; canManage: boolean }) {
  const [audience, setAudience] = useState<ChatAudience>('all');
  const [picking, setPicking] = useState(false);
  const choices = AUDIENCES.filter((a) => a.id !== 'staff' || roomId !== null);
  const chosen = audienceOf(audience, choices);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="border-b border-line px-3 py-2 text-[11.5px] leading-snug text-ink-3">
        {chat === 'off'
          ? 'The host has turned chat off in this meeting.'
          : chat === 'hosts' && !canManage
            ? 'Only the host and co-hosts can write here.'
            : 'Chat is saved to the meeting’s conversation. Guests only see messages sent to Everyone.'}
      </p>

      <div className="min-h-0 flex-1">
        {chosen.id === 'staff' && roomId !== null ? (
          // The workspace conversation itself, with everything it has —
          // attachments, reactions, history. Flattening it into a list of
          // lines here would have lost all of that to make one scroll.
          <Thread roomId={String(roomId)} room={undefined} mini bare rooms={[]} />
        ) : (
          <MeetingThread uuid={uuid} />
        )}
      </div>

      <div className="border-t border-line p-2">
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-start hover:bg-subtle"
          >
            <span className={cx('h-2 w-2 shrink-0 rounded-full', chosen.id === 'staff' ? 'bg-warning' : 'bg-success')} />
            <span className="text-[12.5px] font-semibold text-ink">{chosen.label}</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">{chosen.help}</span>
            <Icon name="chevron-down" size={13} className="shrink-0 text-ink-3" />
          </button>
          {picking ? (
            <ul role="listbox" aria-label="Who sees this" className="absolute bottom-full left-0 z-10 mb-1 w-full overflow-hidden rounded-[10px] border border-line bg-surface shadow-lg">
              {choices.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={a.id === chosen.id}
                    onClick={() => {
                      setAudience(a.id);
                      setPicking(false);
                    }}
                    className={cx('flex w-full flex-col gap-0.5 px-3 py-2 text-start hover:bg-subtle', a.id === chosen.id && 'bg-selection')}
                  >
                    <span className="text-[12.5px] font-semibold text-ink">{a.label}</span>
                    <span className="text-[11.5px] text-ink-2">{a.help}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ChatState {
  enabled: boolean;
  can_send: boolean;
  messages: Array<{ id: number; name: string; guest: boolean; text: string }>;
}

/**
 * The meeting's own chat: everybody in the room, guests included.
 *
 * It polls, and the thing worth drawing carefully is what happens when the
 * poll fails. A message typed then is **kept and retried**, and says so —
 * "Waiting to send" — rather than being lost to an error toast. The canvas
 * draws exactly that, and it is the difference between a dropped connection
 * costing somebody a sentence and costing them nothing.
 */
function MeetingThread({ uuid }: { uuid: string }) {
  const [state, setState] = useState<ChatState | null>(null);
  const [text, setText] = useState('');
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  const path = `/meet/${encodeURIComponent(uuid)}/browser-chat`;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await apiGet<ChatState>(path);

        if (active) {
          setState(next);
          setOffline(false);
        }
      } catch {
        if (active) setOffline(true);
      } finally {
        if (active) timer = setTimeout(load, 5_000);
      }
    };

    void load();

    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [state?.messages.length, queue.length]);

  /** Send what is waiting, oldest first, stopping at the first refusal. */
  const flush = async (lines: string[]) => {
    setSending(true);
    const left = [...lines];

    try {
      while (left.length) {
        setState(await apiPost<ChatState>(path, { text: left[0] }));
        left.shift();
        setOffline(false);
      }
    } catch {
      setOffline(true);
    } finally {
      setQueue(left);
      setSending(false);
    }
  };

  const send = () => {
    const line = text.trim();

    if (!line) return;
    setText('');
    void flush([...queue, line]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {offline ? (
        <div role="status" className="m-2.5 mb-0 flex items-center gap-2 rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-[12px] text-ink">
          <Icon name="refresh" size={13} className="animate-spin text-warning" />
          <span className="flex-1">Reconnecting to chat… Messages you send now are delivered when it is back.</span>
          <button type="button" onClick={() => void flush(queue)} className="font-bold text-warning hover:underline">
            Retry
          </button>
        </div>
      ) : null}

      <ol aria-label="Messages" className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 scroll-thin">
        {state?.enabled === false ? <li className="text-[12.5px] text-ink-3">The host turned meeting chat off.</li> : null}
        {(state?.messages ?? []).map((m) => (
          <li key={m.id}>
            <span className="text-[11.5px] text-ink-3">
              {m.name}
              {m.guest ? ' · Guest' : ''}
            </span>
            <p className="text-[13px] break-words whitespace-pre-wrap text-ink">{m.text}</p>
          </li>
        ))}
        {queue.map((line, i) => (
          <li key={`queued-${i}`} className="opacity-70">
            <span className="text-[11.5px] text-ink-3">You · Waiting to send</span>
            <p className="text-[13px] break-words whitespace-pre-wrap text-ink">{line}</p>
          </li>
        ))}
        <div ref={end} />
      </ol>

      {state?.can_send === false && state.enabled ? (
        <p className="px-3 pb-2 text-[12.5px] text-ink-3">Only hosts can send messages.</p>
      ) : (
        <form
          className="flex gap-2 px-2 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            aria-label="Message"
            placeholder="Message"
            className="min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
          />
          <button type="submit" disabled={!text.trim() || sending} aria-label="Send" className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-primary text-white disabled:opacity-50">
            <Icon name="send" size={15} />
          </button>
        </form>
      )}
    </div>
  );
}
