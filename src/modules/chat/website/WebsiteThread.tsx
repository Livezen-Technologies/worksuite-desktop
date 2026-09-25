import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiPost } from '../../../core/api';
import { app } from '../../../core/app-state';
import { errorMessage } from '../../../core/bridge';
import { useDraft } from '../../../core/drafts';
import { useStore } from '../../../core/store';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { dateLabel, dayKey, dayLabel, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Avatar, Button, Chip, Empty, ErrorNote, FileBadge, IconButton, Spinner, cx } from '../../../components/ui';
import { useAgents, useCanned, useWebsiteConversation, websiteAction, websiteAttach, WEBSITE, type WebsiteConversation, type WebsiteMessage, type WebsiteVisitor } from './api';

/**
 * One website visitor's conversation. Opening it counts as joining (the
 * server tells the visitor who joined and takes any assignment as seen), the
 * same as on the web. Replying to an unassigned chat claims it.
 */
export function WebsiteThread({ id }: { id: string }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const q = useWebsiteConversation(id);
  const data = q.data;
  const [panel, setPanel] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;
  useTabTitle(data ? `Website · ${data.visitor?.name || data.visitor?.label || 'Visitor'}` : 'Website chat');

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [count]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['website'] });
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.forbidden);
    return gone ? <Empty icon="globe" title="This website chat is not available" hint="It may have been removed, or you no longer staff this website." /> : <div className="p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;
  }
  if (!data) return null;
  const c = data.conversation;
  const v = data.visitor;
  const canReply = data.can?.reply !== false;
  const mine = me !== null && c.assigned_to === me;
  const name = v?.name || v?.label || 'Visitor';

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
          <Avatar name={name} size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 truncate text-[15px] font-bold text-ink">
              {name}
              {c.status === 'closed' ? <Chip>Closed</Chip> : c.assigned_to === null ? <Chip tone="warning">Unassigned</Chip> : mine ? <Chip tone="indigo">Yours</Chip> : null}
            </div>
            <div className="truncate text-[12.5px] text-ink-3">
              {data.conversation.visitor_typing ? 'Typing…' : `${c.website ?? c.widget ?? 'Website'}${v?.current_title ? ` · on “${v.current_title}”` : ''}`}
            </div>
          </div>
          <Actions data={data} canReply={canReply} mine={mine} onDone={refresh} />
          <IconButton icon={panel ? 'panel-close' : 'panel-open'} label={panel ? 'Hide visitor details' : 'Show visitor details'} onClick={() => setPanel(!panel)} />
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
          {data.messages.length === 0 ? <Empty icon="chat" title="No messages yet" hint="The visitor has opened the chat but not written anything." /> : null}
          {data.messages.map((m, i) => {
            const day = dayKey(parseTs(m.at));
            const header = i === 0 || dayKey(parseTs(data.messages[i - 1]!.at)) !== day;
            return (
              <div key={m.id}>
                {header ? <div className="my-3 text-center"><span className="rounded-full bg-subtle px-3 py-1 text-[12px] font-semibold text-ink-2">{dayLabel(day, 'short')}</span></div> : null}
                <Message m={m} visitor={name} />
              </div>
            );
          })}
        </div>
        {c.status === 'closed' ? (
          <div className="flex items-center justify-between border-t border-line bg-surface px-5 py-3 text-[13px] text-ink-3">
            This chat is closed{c.closed_at ? ` since ${dateLabel(c.closed_at)}` : ''}.
            {canReply ? <Button size="sm" onClick={() => void websiteAction(c.id, 'reopen').then(refresh, (e) => toast('error', errorMessage(e)))}>Reopen</Button> : null}
          </div>
        ) : canReply ? (
          <Composer id={c.id} name={name} onSent={refresh} />
        ) : (
          <div className="border-t border-line bg-surface px-5 py-3 text-[13px] text-ink-3">You can read this chat but not reply to it.</div>
        )}
      </div>
      {panel ? <VisitorPanel v={v} data={data} /> : null}
    </div>
  );
}

function Actions({ data, canReply, mine, onDone }: { data: WebsiteConversation; canReply: boolean; mine: boolean; onDone: () => void }) {
  const c = data.conversation;
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const agents = useAgents(assigning);
  if (!canReply) return null;
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast('success', done);
      onDone();
    } catch (e) {
      toast('error', e instanceof ApiError && e.status === 409 ? 'Someone else has already taken this chat.' : errorMessage(e));
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative flex items-center gap-1.5">
      {c.status !== 'closed' && c.assigned_to === null ? (
        <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => apiPost(`${WEBSITE}/conversations/${c.id}/accept`), 'The chat is yours.')}>
          Accept
        </Button>
      ) : null}
      <IconButton icon="star" label={c.is_starred ? 'Unstar' : 'Star'} active={c.is_starred} onClick={() => void run(() => websiteAction(c.id, 'star', { on: !c.is_starred }))} />
      {c.status !== 'closed' ? (
        <>
          <IconButton icon="users" label="Assign to…" onClick={() => setAssigning(!assigning)} />
          <Button size="sm" disabled={busy} onClick={() => void run(() => websiteAction(c.id, 'close'), 'Chat closed.')}>
            Close
          </Button>
        </>
      ) : null}
      {assigning ? (
        <div className="absolute top-9 right-0 z-30 max-h-72 w-60 overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-xl scroll-thin" role="menu">
          <div className="px-3 py-1.5 text-[11.5px] font-semibold text-ink-3 uppercase">Assign to</div>
          {agents.isLoading ? <Spinner /> : null}
          {(agents.data?.agents ?? []).map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-subtle"
              onClick={() => {
                setAssigning(false);
                void run(() => websiteAction(c.id, 'assign', { user_id: a.id }), `Assigned to ${a.name}.`);
              }}
            >
              <Avatar name={a.name} size={22} /> <span className="truncate">{a.name}</span>
              {mine && a.id === c.assigned_to ? <Icon name="check" size={14} className="ml-auto text-primary" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Message({ m, visitor }: { m: WebsiteMessage; visitor: string }) {
  const { openLink } = useTab();
  // "Nuwan joined the chat": a notice, not something anybody said.
  if (m.from === 'system') return <div className="my-2 text-center text-[12px] text-ink-3">{m.body}</div>;
  const ours = m.from !== 'visitor';
  const who = m.from === 'visitor' ? visitor : m.from === 'bot' ? 'Bot' : (m.agent ?? 'Agent');
  return (
    <div className={cx('mt-2 flex gap-3', ours && 'flex-row-reverse')}>
      {!ours ? <Avatar name={visitor} size={30} /> : null}
      <div className={cx('flex max-w-[72%] flex-col', ours && 'items-end')}>
        <div className="mb-0.5 text-[12px] text-ink-3">
          <span className="font-semibold text-ink-2">{who}</span> · {timeLabel(m.at)}
        </div>
        {m.body ? (
          <div className={cx('whitespace-pre-wrap break-words rounded-[14px] px-4 py-2.5 text-[13.5px] leading-relaxed selectable', ours ? (m.from === 'bot' ? 'bg-subtle text-ink' : 'bg-primary text-white') : 'border border-line bg-surface text-ink')}>{m.body}</div>
        ) : null}
        {m.file ? (
          <button type="button" onClick={() => m.file && openLink(m.file.url)} className="mt-1 flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5 text-left hover:bg-subtle">
            <FileBadge name={m.file.filename} />
            <span>
              <span className="block max-w-[240px] truncate text-[13px] font-semibold text-ink">{m.file.filename}</span>
              <span className="block text-[11.5px] text-ink-3">{Math.max(1, Math.round(m.file.size / 1024))} KB</span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Composer({ id, name, onSent }: { id: number; name: string; onSent: () => void }) {
  const draft = useDraft<string>('website-chat', `conversation:${id}`, '');
  const [sending, setSending] = useState(false);
  const [canned, setCanned] = useState(false);
  const responses = useCanned(canned);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  const send = async () => {
    const text = draft.value.trim();
    if (!text) return;
    setSending(true);
    try {
      await apiPost(`${WEBSITE}/conversations/${id}/reply`, { message: text });
      draft.setValue('');
      await draft.clear();
      onSent();
    } catch (e) {
      toast('error', e instanceof ApiError && e.offline ? 'Replying to a visitor needs a connection to WorkSuite.' : errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const typing = () => {
    // The visitor sees "typing…" from this; once every few seconds is plenty.
    const now = Date.now();
    if (now - lastTyping.current < 3_000) return;
    lastTyping.current = now;
    void apiPost(`${WEBSITE}/conversations/${id}/typing`).catch(() => undefined);
  };

  const attach = async (files: FileList | File[] | null) => {
    for (const f of Array.from(files ?? [])) {
      try {
        await websiteAttach(id, f);
        onSent();
      } catch (e) {
        toast('error', `${f.name}: ${errorMessage(e)}`);
      }
    }
  };

  return (
    <div
      className="relative border-t border-line bg-surface px-5 py-3"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void attach(e.dataTransfer.files);
      }}
    >
      {canned ? (
        <div className="absolute right-5 bottom-full left-5 mb-2 max-h-64 overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-xl scroll-thin" role="menu" aria-label="Saved replies">
          {responses.isLoading ? <Spinner /> : null}
          {!responses.isLoading && !(responses.data?.responses.length) ? <div className="px-3 py-2 text-[12.5px] text-ink-3">No saved replies yet. They are managed on the web.</div> : null}
          {(responses.data?.responses ?? []).map((r) => (
            <button
              key={r.id}
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left hover:bg-subtle"
              onClick={() => {
                draft.setValue(draft.value ? `${draft.value}\n${r.body}` : r.body);
                setCanned(false);
              }}
            >
              <span className="block text-[13px] font-semibold text-ink">{r.title}{r.shortcut ? <span className="ml-2 font-mono text-[11.5px] text-ink-3">/{r.shortcut}</span> : null}</span>
              <span className="block truncate text-[12px] text-ink-3">{r.body}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2 rounded-[12px] border border-line bg-surface px-3 py-2 focus-within:border-primary">
        <IconButton icon="paperclip" label="Attach a file" onClick={() => fileInput.current?.click()} />
        <IconButton icon="list-todo" label="Saved replies" active={canned} onClick={() => setCanned(!canned)} />
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => void attach(e.target.files).then(() => { if (fileInput.current) fileInput.current.value = ''; })} />
        <textarea
          value={draft.value}
          onChange={(e) => {
            draft.setValue(e.target.value);
            typing();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={`Reply to ${name}`}
          aria-label="Reply"
          className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13.5px] outline-none"
        />
        <IconButton icon="send" label="Send" onClick={() => void send()} disabled={sending || !draft.value.trim()} className="!text-primary" />
      </div>
    </div>
  );
}

function VisitorPanel({ v, data }: { v: WebsiteVisitor | null; data: WebsiteConversation }) {
  const { openLink } = useTab();
  const rows: Array<[string, string | null | undefined]> = v
    ? [
        ['Email', v.email],
        ['Phone', v.phone],
        ['Company', v.company],
        ['Location', [v.city, v.country].filter(Boolean).join(', ') || null],
        ['Device', [v.browser, v.os, v.device].filter(Boolean).join(' · ') || null],
        ['Language', v.language],
        ['Visits', v.visits ? String(v.visits) : null],
        ['First seen', v.first_seen ? dateLabel(v.first_seen) : null],
        ['Referrer', v.referrer],
        ['Campaign', [v.utm_source, v.utm_campaign].filter(Boolean).join(' / ') || null],
      ]
    : [];
  const journey = data.journey ?? [];
  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface scroll-thin" aria-label="Visitor details">
      <div className="border-b border-line px-4 py-4">
        <div className="text-[14px] font-bold text-ink">{v?.name || v?.label || 'Visitor'}</div>
        {v?.is_blocked ? <Chip tone="danger" className="mt-1">Blocked</Chip> : null}
        {v?.current_url ? (
          <button type="button" className="mt-2 flex w-full items-center gap-1.5 text-left text-[12.5px] text-primary hover:underline" onClick={() => openLink(v.current_url!)}>
            <Icon name="external" size={13} /> <span className="truncate">{v.current_title || v.current_url}</span>
          </button>
        ) : null}
      </div>
      <dl className="px-4 py-3">
        {rows.filter(([, val]) => val).map(([k, val]) => (
          <div key={k} className="py-1.5">
            <dt className="text-[11.5px] font-semibold text-ink-3 uppercase">{k}</dt>
            <dd className="break-words text-[13px] text-ink selectable">{val}</dd>
          </div>
        ))}
      </dl>
      {journey.length ? (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 text-[11.5px] font-semibold text-ink-3 uppercase">Pages visited</div>
          <ol className="space-y-1.5">
            {journey.slice(-12).reverse().map((p, i) => (
              <li key={`${p.at}-${i}`} className="text-[12.5px]">
                <span className="block truncate text-ink">{p.title || p.url || 'Page'}</span>
                <span className="text-[11.5px] text-ink-3">{timeLabel(p.at)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}
