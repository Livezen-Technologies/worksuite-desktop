import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { WEBSITE_REPLY_LABEL } from '@shared/website-reply';
import { useCanOpen } from '../../../core/access';
import { ApiError, apiPost } from '../../../core/api';
import { app } from '../../../core/app-state';
import { call, errorMessage, registerDropped } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { bytes, dateLabel, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Avatar, Button, Chip, Empty, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { Composer, type ComposerHandle } from '../Composer';
import { PRIORITIES, quoteAuthor, useAgents, useCanned, useWebsiteConversation, websiteAction, WEBSITE, type WebsiteConversation, type WebsiteMessage, type WebsiteRow, type WebsiteVisitor } from './api';
import type { ReplyTarget } from '../Thread';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';
import { openChatAttachment } from '../AttachmentViewer';
import { openWebsiteChatWindow } from '../window';

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
export function WebsiteThread({ id, row, mini = false }: { id: string; row?: WebsiteRow; mini?: boolean }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const q = useWebsiteConversation(id);
  const data = q.data;
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
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
        <div className={cx('flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface', mini ? 'min-h-12 px-3 py-2' : 'min-h-14 px-3.5 py-[11px]')}>
          <Avatar name={name} size={mini ? 30 : 34} presence={c.status === 'closed' ? null : online ? 'online' : 'away'} />
          <span className={cx('flex flex-1 flex-col', mini ? 'min-w-[120px]' : 'min-w-[150px]')}>
            <b className="truncate text-ink">{name}{v?.company ? ` · ${v.company}` : ''}</b>
            <span className={cx('truncate text-[11.5px] font-semibold', c.visitor_typing ? 'text-primary' : online && c.status !== 'closed' ? 'text-success' : 'text-ink-3')}>
              {c.visitor_typing ? 'Typing…' : c.status === 'closed' ? `Closed${c.closed_at ? ` ${dateLabel(c.closed_at)}` : ''}` : online ? `On the site now${page ? ` · reading ${page}` : ''}` : 'Left the site'}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Controls data={data} row={row} me={me} canReply={canReply} onDone={refresh} compact={mini} />
            {!mini ? (
              <button type="button" aria-label="Open in new window" title="Open in new window" onClick={() => void openWebsiteChatWindow(c.id, name)} className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-line bg-surface text-ink hover:bg-subtle">
                <Icon name="external" size={14} />
              </button>
            ) : null}
          </span>
        </div>
        <div ref={scroller} className={cx('flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto py-3 scroll-thin', mini ? 'px-3' : 'px-4')}>
          {c.started_at ? <div className="self-center text-[11px] text-ink-3">Started a chat on {c.website ?? c.widget ?? 'the website'}{data.journey?.[0]?.url ? pathOf(data.journey[0].url) : ''} · {timeLabel(c.started_at)}</div> : null}
          {data.messages.length === 0 ? <Empty icon="chat" title="No messages yet" hint="The visitor has opened the chat but not written anything." /> : null}
          {data.messages.map((m) => (
            <Message
              key={m.id}
              m={m}
              visitor={name}
              // Answering one message quotes it, for the visitor too (RDC-10).
              onReply={canReply && c.status !== 'closed' && m.from !== 'system' ? () => {
                setReply({ id: m.id, sender_name: quoteAuthor({ from: m.from === 'system' ? 'agent' : m.from, agent: m.agent }, name), snippet: m.body ?? m.file?.filename ?? '' });
                composer.current?.focus();
              } : undefined}
            />
          ))}
          {waiting.map((p) => (
            <div key={p.id} className="flex flex-col items-end gap-1 self-end">
              <div className="max-w-[min(360px,85%)] rounded-[12px_4px_12px_12px] border border-dashed border-[#8C9AD3] bg-[#DDE3F7] px-3 py-2 text-ink dark:bg-selection">{p.label.startsWith(WEBSITE_REPLY_LABEL) ? p.label.slice(WEBSITE_REPLY_LABEL.length) : p.label}</div>
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
            compact={mini}
            group={false}
            reply={reply}
            onClearReply={() => setReply(null)}
            website={{ conversationId: c.id, replies: canned.data?.responses ?? [] }}
          />
        ) : (
          <div className="border-t border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-3">You can read this chat but not reply to it.</div>
        )}
      </section>
      {!mini ? <VisitorPanel v={v} data={data} online={online} onDone={refresh} /> : null}
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

/** The header's actions. `compact`, in a small window (RDC-16): only taking the chat and closing it. */
function Controls({ data, row, me, canReply, onDone, compact = false }: { data: WebsiteConversation; row?: WebsiteRow; me: number | null; canReply: boolean; onDone: () => void; compact?: boolean }) {
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
  const accept =
    !closed && c.assigned_to === null ? (
      <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => apiPost(`${WEBSITE}/conversations/${c.id}/accept`), 'The chat is yours.')}>
        Accept
      </Button>
    ) : null;
  const close = !closed ? (
    <button type="button" disabled={busy} onClick={() => void run(() => websiteAction(c.id, 'close'), 'Chat closed.')} className="h-[30px] rounded-[7px] bg-ink px-2.5 text-[12px] font-bold text-surface hover:opacity-90">
      Close
    </button>
  ) : null;
  if (compact) {
    return (
      <>
        {accept}
        {close}
      </>
    );
  }
  return (
    <>
      {accept}
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
      {close}
    </>
  );
}

/** A visitor's or agent's file opens in the attachment preview, through the app (#38). */
function openWebsiteFile(f: NonNullable<WebsiteMessage['file']>, openLink: (url: string) => void): void {
  const url = f.url.startsWith('/chat/') ? `/api${f.url}` : f.url;
  openChatAttachment({ filename: f.filename, mime: f.mime, size: f.size, is_image: f.is_image, url, download_url: url }, openLink);
}

function Message({ m, visitor, onReply }: { m: WebsiteMessage; visitor: string; onReply?: () => void }) {
  const { openLink } = useTab();
  // "Nuwan joined the chat": a notice, not something anybody said.
  if (m.from === 'system') return <div className="self-center text-center text-[11px] text-ink-3">{m.body} · {timeLabel(m.at)}</div>;
  const ours = m.from === 'agent';
  const shape = ours ? 'self-end rounded-[12px_4px_12px_12px] bg-primary text-white' : m.from === 'bot' ? 'self-start rounded-[4px_12px_12px_12px] bg-subtle text-ink-2 text-[12.5px]' : 'self-start rounded-[4px_12px_12px_12px] border border-line bg-surface text-ink';
  const q = m.reply;
  return (
    <div className={cx('group flex max-w-full flex-col gap-1', ours ? 'items-end self-end' : 'items-start self-start')}>
      {q ? (
        <div className="max-w-[min(320px,80%)] truncate border-l-[3px] border-primary/60 bg-subtle px-2 py-1 text-[11.5px] text-ink-2" title={q.body ?? q.file ?? ''}>
          <b className="text-ink">{quoteAuthor(q, visitor)}</b> · {q.body ?? (q.file ? `📎 ${q.file}` : 'A removed message')}
        </div>
      ) : m.reply_to ? (
        <div className="border-l-[3px] border-line px-2 py-1 text-[11.5px] text-ink-3 italic">A removed message</div>
      ) : null}
      <div className={cx('flex max-w-full items-center gap-1', ours && 'flex-row-reverse')}>
      {m.body ? (
        <div className={cx('max-w-[min(360px,85%)] whitespace-pre-wrap break-words px-3 py-2 leading-[1.5] selectable', shape)} title={`${m.from === 'agent' ? (m.agent ?? 'Agent') : m.from === 'bot' ? 'Automated message' : 'Visitor'} · ${timeLabel(m.at)}`}>
          {m.from === 'bot' ? <b className="block">Automated message{m.agent ? ` · ${m.agent}` : ''}</b> : null}
          {m.body}
        </div>
      ) : null}
      {m.file ? (
        <div className={cx('flex items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-[12px]', ours ? 'self-end' : 'self-start')}>
          <b className="max-w-[220px] truncate text-ink">{m.file.filename}</b>
          <span className="text-ink-3">{bytes(m.file.size)} ·</span>
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => m.file && openWebsiteFile(m.file, openLink)}>Open</button>
        </div>
      ) : null}
      {onReply ? (
        <button type="button" aria-label="Reply to this message" title="Reply" onClick={onReply} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 opacity-0 hover:bg-subtle hover:text-ink focus:opacity-100 group-hover:opacity-100">
          <Icon name="reply" size={13} />
        </button>
      ) : null}
      </div>
    </div>
  );
}

const HEADING = 'text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase';

function VisitorPanel({ v, data, online, onDone }: { v: WebsiteVisitor | null; data: WebsiteConversation; online: boolean; onDone: () => void }) {
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  // A ticket is raised in, and opened by, Support: offered only to whoever has it.
  const support = useCanOpen('support');
  const rows: Array<[string, string | null | undefined]> = v
    ? [
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
  // Every file either side sent in this chat, newest first (CHAT-UI-01, SHARED FILES).
  const files = data.messages.filter((m) => m.file).reverse();
  const { openLink } = useTab();
  const name = v?.name || v?.label || 'Visitor';

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
    <SidePanel id="website-visitor" label="the visitor details" side="right">
      <aside aria-label="Visitor details" className="flex w-[292px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-surface p-3.5 text-[12.5px] scroll-thin">
        <div className="flex flex-col items-center gap-1 border-b border-line pb-3 text-center">
          <Avatar name={name} size={48} presence={data.conversation.status === 'closed' ? null : online ? 'online' : 'away'} />
          <b className="mt-1 flex items-center gap-1.5 text-[14px] text-ink">
            <span className="break-words">{name}</span>
            {v?.is_blocked ? <Chip tone="danger">Blocked</Chip> : null}
          </b>
          {v?.email ? <span className="break-all text-[12px] text-ink-3 selectable">{v.email}</span> : null}
        </div>
        <h3 className={HEADING}>Visitor</h3>
        {rows.filter(([, val]) => val).map(([k, val]) => (
          <div key={k} className="flex gap-2">
            <span className="w-24 shrink-0 text-ink-3">{k}</span>
            <span className="min-w-0 break-words font-semibold text-ink selectable">{val}</span>
          </div>
        ))}
        {journey.length ? (
          <div className="flex flex-col gap-[5px] border-t border-line pt-2">
            <h3 className={HEADING}>Journey</h3>
            <ol className="flex flex-col gap-[3px] text-ink-2">
              {journey.map((p, i) => (
                <li key={`${p.at}-${i}`} className="flex gap-2">
                  <span className="min-w-0 flex-1 break-words">{p.url ? pathOf(p.url) : (p.title ?? 'page')}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{i === journey.length - 1 && online ? 'Reading now' : timeLabel(p.at)}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {files.length ? (
          <div className="flex flex-col gap-[5px] border-t border-line pt-2">
            <h3 className={HEADING}>Shared files · {files.length}</h3>
            {files.slice(0, 8).map((m) => (
              <button key={m.id} type="button" onClick={() => m.file && openWebsiteFile(m.file, openLink)} title={m.from === 'visitor' ? 'Sent by the visitor' : 'Sent to the visitor'} className="flex items-center gap-2 rounded-[6px] text-left hover:text-primary">
                <Icon name="file" size={13} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{m.file?.filename}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{m.file ? bytes(m.file.size) : ''}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-[5px] border-t border-line pt-2">
          <h3 className={HEADING}>Previous chats · {history.length}</h3>
          {history.slice(0, 5).map((h) => (
            <span key={h.id} className="text-ink-2">
              {h.started_at ? dateLabel(h.started_at) : 'Earlier'} · {h.status}{h.rating ? ` · rated ${h.rating}/5` : ''}{h.other_device ? ' · another device' : ''}
            </span>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          {support ? <button type="button" disabled={busy} onClick={() => void ticket()} className="h-8 rounded-[8px] border border-line bg-surface font-semibold text-ink hover:bg-subtle disabled:opacity-60">Raise a support ticket from this chat</button> : null}
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
    </SidePanel>
  );
}
