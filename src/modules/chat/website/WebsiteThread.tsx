import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { ApiError, apiPost } from '../../../core/api';
import { app } from '../../../core/app-state';
import { call, errorMessage, registerDropped } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { bytes, dateLabel, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Avatar, Button, Chip, Empty, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { Composer, type ComposerHandle } from '../Composer';
import { PRIORITIES, useAgents, useCanned, useWebsiteConversation, websiteAction, WEBSITE, type WebsiteConversation, type WebsiteMessage, type WebsiteRow, type WebsiteVisitor } from './api';
import { Select } from '../../../components/Select';

const control = 'h-[30px] rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink disabled:opacity-60';

/**
 * One website visitor's conversation (WebChatInbox, middle and right). Opening
 * it counts as joining (the server tells the visitor who joined and takes any
 * assignment as seen), the same as on the web. Replying to an unassigned chat
 * claims it.
 *
 * The box is Team Chat's own composer with the website profile (WS-WCHAT
 * ENH-02): the same drafts, tray, paste, camera and emoji; saved replies with
 * "/"; files a visitor cannot receive refused before upload; replies through
 * the outbox, shown here as pending until they are sent.
 */
export function WebsiteThread({ id, row }: { id: string; row?: WebsiteRow }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const q = useWebsiteConversation(id);
  const data = q.data;
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
  const canned = useCanned(true);
  const outbox = useQuery({ queryKey: ['offline', 'pending'], queryFn: () => call('offline:pending') });
  const waiting = (outbox.data ?? []).filter((m: OfflineMutation) => m.module === 'website-chat' && m.entityId === id && m.state !== 'DONE');
  const count = data?.messages.length ?? 0;
  useTabTitle(data ? `Website · ${data.visitor?.name || data.visitor?.label || 'Visitor'}` : 'Website chats');

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [count, data?.conversation.visitor_typing, waiting.length]);

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
  const name = v?.name || v?.label || 'Visitor';
  // On the site: seen in the two minutes before this copy was fetched, as the list decides.
  const online = row?.online ?? (v?.last_seen ? q.dataUpdatedAt - parseTs(v.last_seen).getTime() < 120_000 : false);
  const page = v?.current_url ? pathOf(v.current_url) : null;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <section
        aria-label={`Chat with ${name}`}
        className={cx('relative flex min-w-0 flex-1 flex-col bg-ground', drag && 'ring-2 ring-inset ring-primary/50')}
        // Files dropped from the computer join the tray through the preload's file channel (RDC-14).
        onDragOver={(e) => {
          if (canReply && c.status !== 'closed' && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDrag(true);
          }
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDrag(false);
          void registerDropped(Array.from(e.dataTransfer.files)).then(
            (files) => composer.current?.stage(files),
            (err: unknown) => toast('error', errorMessage(err)),
          );
        }}
      >
        {/* The controls move to a second line rather than squeeze the name away. */}
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3.5 py-[11px]">
          <Avatar name={name} size={34} />
          <span className="flex min-w-[150px] flex-1 flex-col">
            <b className="truncate text-ink">{name}{v?.company ? ` · ${v.company}` : ''}</b>
            <span className={cx('truncate text-[11.5px] font-semibold', c.visitor_typing ? 'text-primary' : online && c.status !== 'closed' ? 'text-success' : 'text-ink-3')}>
              {c.visitor_typing ? 'Typing…' : c.status === 'closed' ? `Closed${c.closed_at ? ` ${dateLabel(c.closed_at)}` : ''}` : online ? `On the site now${page ? ` · reading ${page}` : ''}` : 'Left the site'}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Controls data={data} row={row} me={me} canReply={canReply} onDone={refresh} />
          </span>
        </div>
        <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-4 py-3 scroll-thin">
          {c.started_at ? <div className="self-center text-[11px] text-ink-3">Started a chat on {c.website ?? c.widget ?? 'the website'}{data.journey?.[0]?.url ? pathOf(data.journey[0].url) : ''} · {timeLabel(c.started_at)}</div> : null}
          {data.messages.length === 0 ? <Empty icon="chat" title="No messages yet" hint="The visitor has opened the chat but not written anything." /> : null}
          {data.messages.map((m) => <Message key={m.id} m={m} />)}
          {waiting.map((p) => (
            <div key={p.id} className="flex flex-col items-end gap-1 self-end">
              <div className="max-w-[360px] rounded-[12px_4px_12px_12px] border border-dashed border-[#8C9AD3] bg-[#DDE3F7] px-3 py-2 text-ink dark:bg-selection">{p.label.replace(/^Reply to a website visitor: /, '')}</div>
              <span className="text-[11.5px] font-semibold text-[#9A4A06] dark:text-warning">
                {p.state === 'FAILED' || p.state === 'CONFLICT' ? (
                  <>
                    Not sent — {p.error ?? 'the server refused it'} ·{' '}
                    <button type="button" className="underline" onClick={() => void call('offline:retry', { id: p.id }).then(() => qc.invalidateQueries({ queryKey: ['offline'] }))}>
                      Retry
                    </button>{' '}
                    ·{' '}
                    <button type="button" className="underline" onClick={() => void call('offline:discard', { id: p.id }).then(() => qc.invalidateQueries({ queryKey: ['offline'] }))}>
                      Discard
                    </button>
                  </>
                ) : (
                  'Pending — sends when WorkSuite is back online'
                )}
              </span>
            </div>
          ))}
          {c.visitor_typing ? <div className="self-start text-[12px] text-ink-3">{name.split(' ')[0]} is typing…</div> : null}
        </div>
        {c.status === 'closed' ? (
          <div className="flex items-center justify-between border-t border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-3">
            This chat is closed{c.closed_at ? ` since ${dateLabel(c.closed_at)}` : ''}.
            {canReply ? <Button size="sm" onClick={() => void websiteAction(c.id, 'reopen').then(refresh, (e) => toast('error', errorMessage(e)))}>Reopen</Button> : null}
          </div>
        ) : canReply ? (
          <Composer
            ref={composer}
            roomId={`website-${c.id}`}
            roomName={name}
            group={false}
            reply={null}
            onClearReply={() => undefined}
            website={{ conversationId: c.id, replies: canned.data?.responses ?? [] }}
          />
        ) : (
          <div className="border-t border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-3">You can read this chat but not reply to it.</div>
        )}
      </section>
      <VisitorPanel v={v} data={data} online={online} onDone={refresh} />
    </div>
  );
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

function Controls({ data, row, me, canReply, onDone }: { data: WebsiteConversation; row?: WebsiteRow; me: number | null; canReply: boolean; onDone: () => void }) {
  const c = data.conversation;
  const [busy, setBusy] = useState(false);
  const agents = useAgents(canReply);
  if (!canReply) return null;
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast('success', done);
    } catch (e) {
      toast('error', e instanceof ApiError && e.status === 409 ? 'Someone else has already taken this chat.' : errorMessage(e));
    } finally {
      setBusy(false);
      onDone();
    }
  };
  const priority = c.priority ?? row?.priority ?? 'normal';
  const others = (agents.data?.agents ?? []).filter((a) => a.id !== me);
  const closed = c.status === 'closed';
  return (
    <>
      {!closed && c.assigned_to === null ? (
        <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => apiPost(`${WEBSITE}/conversations/${c.id}/accept`), 'The chat is yours.')}>
          Accept
        </Button>
      ) : null}
      <Select
        aria-label="Assignee"
        disabled={busy || closed}
        value={c.assigned_to === null ? '' : String(c.assigned_to)}
        onChange={(e) => {
          const to = e.target.value ? Number(e.target.value) : null;
          const who = to === me ? 'you' : (agents.data?.agents.find((a) => a.id === to)?.name ?? 'nobody');
          void run(() => websiteAction(c.id, 'assign', { user_id: to }), to === null ? 'Unassigned.' : `Assigned to ${who}.`);
        }}
        className={control}
      >
        {me !== null ? <option value={String(me)}>Assigned to me</option> : null}
        <option value="">Unassigned</option>
        {others.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
        {c.assigned_to !== null && c.assigned_to !== me && !others.some((a) => a.id === c.assigned_to) ? <option value={String(c.assigned_to)}>{row?.agent ?? 'Someone else'}</option> : null}
      </Select>
      <Select aria-label="Priority" disabled={busy || closed} value={priority} onChange={(e) => void run(() => websiteAction(c.id, 'priority', { priority: e.target.value }))} className={control}>
        {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </Select>
      <button type="button" aria-pressed={c.is_starred} disabled={busy} onClick={() => void run(() => websiteAction(c.id, 'star', { on: !c.is_starred }))} className={cx('h-[30px] rounded-[7px] border px-2 text-[12px]', c.is_starred ? 'border-warning bg-warning-bg font-semibold text-[#9A4A06] dark:text-warning' : 'border-line bg-surface text-ink hover:bg-subtle')}>
        {c.is_starred ? '★ Starred' : 'Star'}
      </button>
      {!closed ? (
        <button type="button" disabled={busy} onClick={() => void run(() => websiteAction(c.id, 'close'), 'Chat closed.')} className="h-[30px] rounded-[7px] bg-ink px-2.5 text-[12px] font-bold text-surface hover:opacity-90">
          Close
        </button>
      ) : null}
    </>
  );
}

function Message({ m }: { m: WebsiteMessage }) {
  const { openLink } = useTab();
  // "Nuwan joined the chat": a notice, not something anybody said.
  if (m.from === 'system') return <div className="self-center text-center text-[11px] text-ink-3">{m.body} · {timeLabel(m.at)}</div>;
  const ours = m.from === 'agent';
  const shape = ours ? 'self-end rounded-[12px_4px_12px_12px] bg-primary text-white' : m.from === 'bot' ? 'self-start rounded-[4px_12px_12px_12px] bg-subtle text-ink-2 text-[12.5px]' : 'self-start rounded-[4px_12px_12px_12px] border border-line bg-surface text-ink';
  return (
    <>
      {m.body ? (
        <div className={cx('max-w-[360px] whitespace-pre-wrap break-words px-3 py-2 leading-[1.5] selectable', shape)} title={`${m.from === 'agent' ? (m.agent ?? 'Agent') : m.from === 'bot' ? 'Automated message' : 'Visitor'} · ${timeLabel(m.at)}`}>
          {m.from === 'bot' ? <b className="block">Automated message{m.agent ? ` · ${m.agent}` : ''}</b> : null}
          {m.body}
        </div>
      ) : null}
      {m.file ? (
        <div className={cx('flex items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-[12px]', ours ? 'self-end' : 'self-start')}>
          <b className="max-w-[220px] truncate text-ink">{m.file.filename}</b>
          <span className="text-ink-3">{bytes(m.file.size)} ·</span>
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => m.file && openLink(m.file.url.startsWith('/chat/') ? `/api${m.file.url}` : m.file.url)}>Open</button>
        </div>
      ) : null}
    </>
  );
}

function VisitorPanel({ v, data, online, onDone }: { v: WebsiteVisitor | null; data: WebsiteConversation; online: boolean; onDone: () => void }) {
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows: Array<[string, string | null | undefined]> = v
    ? [
        ['Email', v.email],
        ['Phone', v.phone],
        ['Company', v.company],
        ['Location', [v.city, v.country].filter(Boolean).join(', ') || null],
        ['Device', [v.device, v.os].filter(Boolean).join(' · ') || null],
        ['Browser', v.browser],
        ['Language', v.language],
        ['Current page', v.current_url ? pathOf(v.current_url) : null],
        ['Landing page', v.landing_page ? pathOf(v.landing_page) : null],
        ['Referrer', v.referrer ? v.referrer.replace(/^https?:\/\//, '').replace(/\/$/, '') : null],
        ['Campaign', v.utm_campaign ?? v.utm_source],
        ['Visits', v.visits ? `${v.visits}${v.first_seen ? ` · first ${dateLabel(v.first_seen)}` : ''}` : null],
      ]
    : [];
  const journey = (data.journey ?? []).slice(-8);
  const history = (data.history ?? []).filter((h) => h.id !== data.conversation.id);

  const ticket = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ id: number; reference: string }>('/api/tickets/from-conversation', { conversation_id: data.conversation.id });
      toast('success', `Raised as ${r.reference}.`);
      void call('app:openInBrowser', { path: `/tickets?ticket=${r.id}` });
    } catch (e) {
      const existing = e instanceof ApiError ? (e.data as { ticket?: { id?: number } } | null)?.ticket?.id : undefined;
      if (existing) {
        toast('info', errorMessage(e));
        void call('app:openInBrowser', { path: `/tickets?ticket=${existing}` });
      } else toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside aria-label="Visitor details" className="flex w-[292px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-surface p-3.5 text-[12.5px] scroll-thin">
      <b className="flex items-center gap-2 text-[14px] text-ink">Visitor details {v?.is_blocked ? <Chip tone="danger">Blocked</Chip> : null}</b>
      {rows.filter(([, val]) => val).map(([k, val]) => (
        <div key={k} className="flex gap-2">
          <span className="w-24 shrink-0 text-ink-3">{k}</span>
          <span className="min-w-0 break-words font-semibold text-ink selectable">{val}</span>
        </div>
      ))}
      {journey.length ? (
        <div className="flex flex-col gap-[5px] border-t border-line pt-2">
          <b className="text-ink">Pages this visit</b>
          <span className="break-words text-ink-2">
            {journey.map((p) => (p.url ? pathOf(p.url) : (p.title ?? 'page'))).join(' → ')}
            {online ? ' (reading now)' : ''}
          </span>
        </div>
      ) : null}
      <div className="flex flex-col gap-[5px] border-t border-line pt-2">
        <b className="text-ink">Previous chats · {history.length}</b>
        {history.slice(0, 5).map((h) => (
          <span key={h.id} className="text-ink-2">
            {h.started_at ? dateLabel(h.started_at) : 'Earlier'} · {h.status}{h.rating ? ` · rated ${h.rating}/5` : ''}{h.other_device ? ' · another device' : ''}
          </span>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-1.5 pt-2">
        <button type="button" disabled={busy} onClick={() => void ticket()} className="h-8 rounded-[8px] border border-line bg-surface font-semibold text-ink hover:bg-subtle disabled:opacity-60">Raise a support ticket from this chat</button>
        {data.can?.manage && v && !v.is_blocked ? (
          <button type="button" onClick={() => setBlocking(true)} className="h-8 rounded-[8px] border border-[#F1B8A8] bg-surface font-bold text-danger hover:bg-danger-bg">Block this visitor</button>
        ) : null}
      </div>
      {blocking ? (
        <Modal
          title="Block this visitor?"
          onClose={() => setBlocking(false)}
          width={420}
          footer={
            <>
              <Button onClick={() => setBlocking(false)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setBlocking(false);
                  void websiteAction(data.conversation.id, 'block').then(
                    () => (toast('success', 'Visitor blocked.'), onDone()),
                    (e) => toast('error', errorMessage(e)),
                  );
                }}
              >
                Block
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">{v?.name || v?.label || 'This visitor'} will no longer be able to start chats on your websites. You can unblock them on the web.</p>
        </Modal>
      ) : null}
    </aside>
  );
}
