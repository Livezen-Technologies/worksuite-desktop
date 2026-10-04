import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { OfflineMutation } from '@shared/types';
import { WEBSITE_REPLY_LABEL, websiteDraftKey } from '@shared/website-reply';
import { useCanOpen } from '../../../core/access';
import { text } from '../../../core/i18n';
import { navigate } from '../../../core/tabs';
import { ApiError, apiPost } from '../../../core/api';
import { app } from '../../../core/app-state';
import { call, errorMessage, on, registerDropped } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { dateLabel, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Avatar, Button, Chip, Empty, ErrorNote, Modal, Spinner, TextField, cx } from '../../../components/ui';
import { Composer, type ComposerHandle } from '../Composer';
import { callLive, PRIORITIES, quoteAuthor, readBy, tagList, typingWords, useAgents, useCanned, useWebsiteConversation, visitorHas, websiteAction, WEBSITE, type WebsiteConversation, type WebsiteMessage, type WebsiteRow, type WebsiteVisitor } from './api';
import { usePageVisible, useLiveStatus } from './live';
import { useViewing } from './viewing';
import type { ReplyTarget } from '../Thread';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';
import { WEBSITE_CAPS } from '../kit/caps';
import type { MessageHandlers } from '../kit/MessageActions';
import { MessageList, PendingBubble, TypingLine } from '../kit/MessageList';
import { byTime, dwell, eventsForThread, fromWebsiteMessage, fromWidgetEvent, pathOf } from '../kit/model';
import { SharedFiles, sharedFilesOf, type SharedFile } from '../kit/SharedFiles';
import { useNow } from '../../calls/parts';
import { openWebsiteChatWindow } from '../window';
import { InThisChat, InviteDialog, NoteBox, TeamFaces, TransferDialog, useDeclined } from './Team';
import { CallBar } from './CallBar';
import { CallbackCard, isPending } from './Callbacks';

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
  // The composer writes to the visitor, or a note only staff see (TEAM-60).
  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const { active: tabActive, query: tabQuery } = useTab();
  // From the ringing card's Transfer (#225), or a visitor's Invite a colleague (#231): the chat opens with that dialog up.
  const [dialog, setDialog] = useState<'invite' | 'transfer' | null>(() => (tabQuery?.get('transfer') === '1' ? 'transfer' : tabQuery?.get('invite') === '1' ? 'invite' : null));
  const declined = useDeclined(Number(id), me, q.data?.team);
  // Typing and receipts, live (ENH-WCHAT-04): reading counts while this tab is in front and the window can be seen.
  const pageVisible = usePageVisible();
  const live = useLiveStatus(Number(id), q.data, q.dataUpdatedAt, me, tabActive && pageVisible);
  // In front in the main window: a visitor writing again here raises no card (#230). The mini chat window does not count.
  useViewing(Number(id), !mini && tabActive && pageVisible);
  const canned = useCanned(true);
  const outbox = useQuery({ queryKey: ['offline', 'pending'], queryFn: () => call('offline:pending') });
  const waiting = (outbox.data ?? []).filter((m: OfflineMutation) => m.module === 'website-chat' && m.entityId === id && m.state !== 'DONE');
  const count = data?.messages.length ?? 0;
  useTabTitle(data ? `Website · ${data.visitor?.name || data.visitor?.label || 'Visitor'}` : 'Website chats');

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [count, live.visitorTyping, waiting.length]);

  // Removed from the chat by its owner or a supervisor (TEAM-07): what I was writing to the visitor goes too.
  useEffect(
    () =>
      on<{ type: string; conversation_id?: number; what?: string; text?: string }>('realtime:event', (e) => {
        if (e.type !== 'chat.widget.participants' || e.what !== 'removed' || e.conversation_id !== Number(id)) return;
        toast('info', e.text ?? 'You were removed from the chat.');
        void call('offline:deleteDraft', websiteDraftKey(Number(id))).catch(() => undefined);
        setTab('reply');
        void qc.invalidateQueries({ queryKey: ['website'] });
      }),
    [id, qc],
  );

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
  const t = data.team ?? null;
  const noting = tab === 'note' && !!t?.can.note;
  // Messages and the visitor's page visits in one timeline, through the kit's adapters (C-02; #229).
  const replyOpen = canReply && c.status !== 'closed';
  const items = byTime([
    ...data.messages.map((m) =>
      fromWebsiteMessage(m, {
        me,
        visitor: name,
        canReply: replyOpen,
        // Sent, delivered or read by the visitor, on the team's messages; who read the visitor's latest (LIVE-08).
        status: data.marks && m.from === 'agent' && m.visibility !== 'internal' ? visitorHas(m.id, data.marks) : undefined,
        footer: data.marks ? footerFor(m, data, me) : null,
      }),
    ),
    ...eventsForThread(data.events, c.started_at).map((e, i) => fromWidgetEvent(e, i)),
  ]);
  const handlers: MessageHandlers = {
    // Answering one message quotes it, for the visitor too (RDC-10).
    onReply: (k) => {
      const m = data.messages.find((x) => x.id === k.id);
      if (!m) return;
      setReply({ id: m.id, sender_name: quoteAuthor({ from: m.from === 'system' ? 'agent' : m.from, agent: m.agent }, name), snippet: m.body ?? m.file?.filename ?? '' });
      composer.current?.focus();
    },
    // Delete for the visitor too, within the window (#229).
    onDelete: (k) => {
      void apiPost(`${WEBSITE}/conversations/${c.id}/messages/${k.id}/delete`, {}).then(
        () => {
          toast('success', text('Message deleted for everyone.'));
          void qc.invalidateQueries({ queryKey: ['website', 'conversation', String(c.id)] });
        },
        (e) => toast('error', errorMessage(e)),
      );
    },
  };

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
            <span className={cx('truncate text-[11.5px] font-semibold', live.visitorTyping ? 'text-primary' : online && c.status !== 'closed' ? 'text-success' : 'text-ink-3')}>
              {live.visitorTyping ? 'Typing…' : c.status === 'closed' ? `Closed${c.closed_at ? ` ${dateLabel(c.closed_at)}` : ''}` : online ? `On the site now${page ? ` · reading ${page}` : ''}` : 'Left the site'}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {t ? <TeamFaces people={t.people} /> : null}
            {/* Invite and Transfer, beside Close (TEAM-UI-01). */}
            {!mini && t?.can.invite && c.status !== 'closed' ? (
              <button type="button" onClick={() => setDialog('invite')} className="flex h-[30px] items-center gap-1 rounded-[7px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink hover:bg-subtle">
                <Icon name="user-plus" size={13} /> Invite
              </button>
            ) : null}
            {!mini && t?.can.transfer && c.status !== 'closed' ? (
              <button type="button" onClick={() => setDialog('transfer')} className="flex h-[30px] items-center gap-1 rounded-[7px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink hover:bg-subtle">
                <Icon name="transfers" size={13} /> Transfer
              </button>
            ) : null}
            {/* Offer the visitor a call that rings only me (VOICE-15). */}
            {!mini && data.can_call && c.status !== 'closed' && !callLive(data.call) ? (
              <button type="button" title="The visitor sees a call button; starting the call rings only you" onClick={() => void apiPost(`${WEBSITE}/conversations/${c.id}/offer-call`, {}).then(() => { toast('success', 'Call offered'); refresh(); }, (e) => toast('error', errorMessage(e)))} className="flex h-[30px] items-center gap-1 rounded-[7px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink hover:bg-subtle">
                <Icon name="phone" size={13} /> Offer call
              </button>
            ) : null}
            <Controls data={data} row={row} me={me} canReply={canReply} onDone={refresh} compact={mini} />
            {!mini ? (
              <button type="button" aria-label="Open in new window" title="Open in new window" onClick={() => void openWebsiteChatWindow(c.id, name)} className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-line bg-surface text-ink hover:bg-subtle">
                <Icon name="external" size={14} />
              </button>
            ) : null}
          </span>
        </div>
        {/* A voice call in this chat (ENH-WCHAT-05): over the transcript, which goes on under it. */}
        <CallBar data={data} me={me} visitor={name} onInvite={!mini && t?.can.invite ? () => setDialog('invite') : undefined} onTransfer={!mini && t?.can.transfer ? () => setDialog('transfer') : undefined} onDone={refresh} />
        {/* The callback the visitor asked for, with everything about it and the actions on it (#223). */}
        {data.callback && isPending(data.callback) && !mini ? <CallbackCard b={data.callback} /> : null}
        {/* They went on to WhatsApp from the widget, and their message was matched to this chat (#224). */}
        {data.whatsapp?.length && !mini ? (
          <div className="mx-4 mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
            <Icon name="message-circle" size={12} className="text-success" />
            {data.whatsapp.map((w) => (
              <button key={w.chat_id} type="button" onClick={() => navigate(`/chat?channel=whatsapp&wa=${w.chat_id}`)} className="font-semibold text-primary hover:underline">
                {text('Continued on WhatsApp · {account}', { account: w.account })}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={scroller} className={cx('min-h-0 flex-1 overflow-y-auto py-3 scroll-thin', mini ? 'px-3' : 'px-4')}>
          {c.started_at ? <div className="mb-1 text-center text-[11px] text-ink-3">Started a chat on {c.website ?? c.widget ?? 'the website'}{data.journey?.[0]?.url ? pathOf(data.journey[0].url) : ''} · {timeLabel(c.started_at)}</div> : null}
          {data.messages.length === 0 ? <Empty icon="chat" title="No messages yet" hint="The visitor has opened the chat but not written anything." /> : null}
          {/* The shared chat kit (C-02, RDC-11, LIVE-12; #229): Team Chat's bubbles, meta, ticks and attachments, with what a visitor cannot receive turned off. */}
          <MessageList items={items} caps={{ ...WEBSITE_CAPS, deleteForVisitorMinutes: 15 }} look="page" handlers={handlers} />
          {waiting.map((p) => (
            <PendingBubble
              key={p.id}
              label={p.label.startsWith(WEBSITE_REPLY_LABEL) ? p.label.slice(WEBSITE_REPLY_LABEL.length) : p.label}
              failed={p.state === 'FAILED' || p.state === 'CONFLICT'}
              error={p.error}
              waiting="Pending — sends when WorkSuite is back online"
              onRetry={() => void call('offline:retry', { id: p.id }).then(() => qc.invalidateQueries({ queryKey: ['offline'] }))}
              onDiscard={() => void call('offline:discard', { id: p.id }).then(() => qc.invalidateQueries({ queryKey: ['offline'] }))}
            />
          ))}
          {live.visitorTyping ? <TypingLine>{text('{name} is typing…', { name })}</TypingLine> : null}
          {live.staffTyping.length ? <TypingLine side="right">{typingWords(live.staffTyping)}</TypingLine> : null}
        </div>
        {declined ? (
          // An invitation or transfer this person sent came back (TEAM-24, WF-T2).
          <div role="status" className="flex items-center gap-2 border-t border-line bg-selection px-3.5 py-2 text-[12.5px] text-ink">
            <Icon name="info" size={14} className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1">{declined.text}</span>
            {declined.retry && t?.can[declined.retry] ? <button type="button" onClick={() => setDialog(declined.retry)} className="shrink-0 font-semibold text-primary hover:underline">Try someone else</button> : null}
          </div>
        ) : null}
        {t?.can.note && c.status !== 'closed' && canReply ? (
          <div role="tablist" aria-label="Write" className="flex gap-1 border-t border-line bg-surface px-3 pt-1.5 text-[12px] font-semibold">
            {([['reply', 'Reply to visitor'], ['note', 'Internal note']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-t-[7px] border-b-2 px-2.5 py-1', tab === k ? (k === 'note' ? 'border-[#C88A12] text-[#7A4308] dark:text-warning' : 'border-primary text-primary') : 'border-transparent text-ink-3 hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {c.status !== 'closed' && noting ? (
          <NoteBox conversationId={c.id} onSent={refresh} compact={mini} />
        ) : c.status === 'closed' ? (
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
            website={{ conversationId: c.id, replies: canned.data?.responses ?? [], maxUploadKb: c.max_upload_kb }}
          />
        ) : (
          <div className="border-t border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-3">You can read this chat but not reply to it.</div>
        )}
      </section>
      {!mini ? (
        <VisitorPanel v={v} data={data} online={online} canReply={canReply} files={sharedFilesOf(items)} onDone={refresh}>
          {t ? <InThisChat data={data} me={me} onInvite={() => setDialog('invite')} onTransfer={() => setDialog('transfer')} onClose={() => void websiteAction(c.id, 'close').then(refresh, (e) => toast('error', errorMessage(e)))} onDone={refresh} /> : null}
        </VisitorPanel>
      ) : null}
      {dialog === 'invite' ? <InviteDialog conversationId={c.id} me={me} onClose={() => setDialog(null)} onDone={refresh} /> : null}
      {dialog === 'transfer' ? <TransferDialog conversationId={c.id} me={me} onClose={() => setDialog(null)} onDone={refresh} /> : null}
    </div>
  );
}

/**
 * The line under a message (LIVE-08): under the team's latest, how far the visitor has it — Sent, Delivered, or Read
 * and when; under the visitor's latest, who of the team has read it.
 */
function footerFor(m: WebsiteMessage, data: WebsiteConversation, me: number | null): string | null {
  const marks = data.marks;
  if (!marks || m.visibility === 'internal') return null;
  const team = data.messages.filter((x) => (x.from === 'agent' || x.from === 'bot') && x.visibility !== 'internal').at(-1);
  const visitor = data.messages.filter((x) => x.from === 'visitor').at(-1);
  if (team && m.id === team.id) {
    const s = visitorHas(m.id, marks);
    return s === 'read' ? `Read${marks.visitor.read_at ? ` ${timeLabel(marks.visitor.read_at)}` : ''}` : s === 'delivered' ? 'Delivered' : 'Sent';
  }
  if (visitor && m.id === visitor.id) {
    const who = readBy(m.id, marks, me);
    return who.length ? `Read by ${who.join(', ')}` : null;
  }
  return null;
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

const HEADING = 'text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase';
const CARD = 'flex flex-col gap-[7px] rounded-[12px] border border-line bg-surface px-3 py-2.5';

/** The visitor's clock now, from their browser's time zone (UX-DRW-01); nothing for a zone this computer does not know. */
export function visitorLocalTime(tz: string | null | undefined, now: number): string | null {
  if (!tz) return null;
  try {
    return new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  } catch {
    return null;
  }
}

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

/** One page on the journey: where, when, and how long it held them. */
interface Stop {
  url: string | null;
  title: string | null;
  at: string;
  seconds: number | null;
}

/**
 * The visitor details drawer (UX-DRW-01, X-UI-05; #229): a card stack — who they are with presence and time on the
 * site, Email and Block; how to reach them and their local time; Site, Device, Visits and Came from; this visit's
 * journey with dwell times and where the chat started; the chat's tags; and the files shared, as a grid.
 */
function VisitorPanel({ v, data, online, canReply, files, onDone, children }: { v: WebsiteVisitor | null; data: WebsiteConversation; online: boolean; canReply: boolean; files: SharedFile[]; onDone: () => void; children?: ReactNode }) {
  const [blocking, setBlocking] = useState(false);
  // For how long, and why (GATE-08, SEC-10): a week unless somebody chooses otherwise; '' is until lifted.
  const [blockFor, setBlockFor] = useState('7');
  const [blockWhy, setBlockWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [tagging, setTagging] = useState<string | null>(null);
  // A ticket is raised in, and opened by, Support: offered only to whoever has it.
  const support = useCanOpen('support');
  const mail = useCanOpen('mail');
  const now = useNow(30_000);
  const c = data.conversation;
  const name = v?.name || v?.label || 'Visitor';
  const history = (data.history ?? []).filter((h) => h.id !== c.id);

  // This visit's pages, with how long each held them; an older server sends only the journey, without dwell.
  const visit = eventsForThread(data.events, c.started_at).filter((e) => e.kind === 'page_view');
  const stops: Stop[] = visit.length ? visit : (data.journey ?? []).map((j) => ({ ...j, seconds: null }));
  const recent = stops.slice(-8).reverse();
  const startedAt = c.started_at ? parseTs(c.started_at).getTime() : Number.NaN;
  const chatStop = Number.isNaN(startedAt) ? -1 : recent.findIndex((p) => parseTs(p.at).getTime() <= startedAt + 1000);
  const arrived = stops.length ? parseTs(stops[0]!.at).getTime() : Number.NaN;
  const onSite = online && !Number.isNaN(arrived) ? dwell(Math.max(0, (now - arrived) / 1000)) : null;
  const local = visitorLocalTime(v?.timezone, now);
  const cameFrom = v?.referrer ? hostOf(v.referrer) : (v?.utm_source ?? v?.utm_campaign ?? null);
  const tags = tagList(c.tags);

  const facts: Array<[string, string | null | undefined]> = v
    ? [
        ['Site', c.website ?? c.widget],
        ['Device', [v.browser, v.os].filter(Boolean).join(' · ') || v.device],
        ['Visits', v.visits ? `${v.visits}${visit.length ? ` · ${visit.length === 1 ? text('1 page') : text('{n} pages', { n: visit.length })}` : ''}${v.first_seen ? ` · first ${dateLabel(v.first_seen)}` : ''}` : null],
        ['Came from', cameFrom],
        ['Language', v.language],
        ['Campaign', v.referrer ? (v.utm_campaign ?? v.utm_source) : null],
      ]
    : [];

  const saveTags = (next: string[]) =>
    void websiteAction(c.id, 'tag', { tags: next.join(',') }).then(
      () => onDone(),
      (e) => toast('error', errorMessage(e)),
    );

  const email = () => {
    if (!v?.email) return;
    if (mail) navigate(`/mail?compose=1&to=${encodeURIComponent(v.email)}`);
    else void call('app:openExternal', { url: `mailto:${v.email}` });
  };

  const ticket = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ id: number; reference: string }>('/api/tickets/from-conversation', { conversation_id: c.id });
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

  const action = 'flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface text-[11.5px] font-semibold text-ink hover:bg-subtle';
  return (
    <SidePanel id="website-visitor" label="the visitor details" side="right">
      <aside aria-label="Visitor details" className="flex w-[240px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-ground px-3 py-3.5 text-[12px] scroll-thin">
        <h3 className={HEADING}>Visitor</h3>
        <div className={cx(CARD, 'items-center pt-3.5 text-center')}>
          <Avatar name={name} size={52} presence={c.status === 'closed' ? null : online ? 'online' : 'away'} />
          <b className="flex items-center gap-1.5 text-[14px] text-ink">
            <span className="break-words">{name}</span>
            {v?.is_blocked ? <Chip tone="danger">Blocked</Chip> : null}
          </b>
          {v?.company ? <span className="-mt-1 text-[11.5px] text-ink-3">{v.company}</span> : null}
          <span className={cx('-mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold', online ? 'text-success' : 'text-ink-3')}>
            <span className={cx('h-1.5 w-1.5 rounded-full', online ? 'bg-success' : 'bg-ink-3')} />
            {online ? (onSite ? text('On the site · {time}', { time: onSite }) : text('On the site')) : text('Left the site')}
          </span>
          {v?.email || (data.can?.manage && v && !v.is_blocked) ? (
            <div className="mt-0.5 flex gap-1.5 self-stretch">
              {v?.email ? (
                <button type="button" onClick={email} className={action} title={text('Write to {email}', { email: v.email })}>
                  <Icon name="mail" size={13} className="text-ink-2" /> {text('Email')}
                </button>
              ) : null}
              {data.can?.manage && v && !v.is_blocked ? (
                <button type="button" aria-label="Block this visitor" onClick={() => setBlocking(true)} className={cx(action, 'text-danger hover:bg-danger-bg')}>
                  <Icon name="user-x" size={13} /> {text('Block')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {v?.email || v?.phone || v?.city || v?.country ? (
          <div className={CARD}>
            {v.email ? (
              <div className="flex items-center gap-2">
                <Icon name="mail" size={14} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink selectable" title={v.email}>{v.email}</span>
                <button type="button" aria-label={text('Copy email')} title={text('Copy email')} onClick={() => void navigator.clipboard.writeText(v.email!).then(() => toast('success', text('Copied.')))} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
                  <Icon name="copy" size={13} />
                </button>
              </div>
            ) : null}
            {v.phone ? (
              <div className="flex items-center gap-2">
                <Icon name="phone" size={14} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink selectable">{v.phone}</span>
              </div>
            ) : null}
            {v.city || v.country ? (
              <div className="flex items-center gap-2">
                <Icon name="map-pin" size={14} className="shrink-0 text-ink-3" />
                <span className="min-w-0 text-ink-2">
                  <span>{[v.city, v.country].filter(Boolean).join(', ')}</span>
                  {local ? <span className="text-ink-3"> · {text('{time} local', { time: local })}</span> : null}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {facts.some(([, val]) => val) ? (
          <div className={CARD}>
            {facts.filter(([, val]) => val).map(([k, val]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="shrink-0 text-ink-3">{k}</span>
                <span className="min-w-0 truncate text-right font-semibold text-ink-2 selectable" title={val ?? undefined}>{val}</span>
              </div>
            ))}
          </div>
        ) : null}
        {children}
        {recent.length ? (
          <div className={CARD}>
            <div className="flex items-center">
              <h3 className={cx(HEADING, 'flex-1')}>Journey</h3>
              <span className="text-[11px] text-ink-3">{text('this visit')}</span>
            </div>
            <ol className="ml-1 flex flex-col gap-2 border-l-2 border-line pl-3">
              {recent.map((p, i) => {
                const current = i === 0 && online;
                const first = i === recent.length - 1;
                const when = current ? text('Reading now') : p.seconds !== null ? dwell(p.seconds) : timeLabel(p.at);
                const notes = [when, i === chatStop ? text('chat started here') : null, first && v?.referrer ? text('Arrived from {site}', { site: hostOf(v.referrer) }) : null].filter(Boolean).join(' · ');
                return (
                  <li key={`${p.at}-${i}`} className="relative">
                    <div className={cx('truncate', current ? 'font-bold text-primary' : 'text-ink-2')} title={p.url ?? p.title ?? undefined}>
                      {p.url ? pathOf(p.url) : (p.title ?? 'page')}
                    </div>
                    <div className="text-[11px] text-ink-3">{notes}</div>
                    <span aria-hidden="true" className={cx('absolute top-[4px] -left-[17px] rounded-full', current ? 'h-2 w-2 bg-primary shadow-[0_0_0_3px_var(--color-selection)]' : 'h-1.5 w-1.5 -translate-x-px bg-[#C3CCF6] dark:bg-primary/50')} />
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
        <div className={CARD}>
          <h3 className={HEADING}>Tags</h3>
          <div className="flex flex-wrap gap-[5px]">
            {tags.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-[8px] bg-selection px-2 py-0.5 text-[11px] font-semibold text-primary">
                {t}
                {canReply ? (
                  <button type="button" aria-label={text('Remove tag {tag}', { tag: t })} onClick={() => saveTags(tags.filter((x) => x !== t))} className="text-primary/70 hover:text-primary">
                    <Icon name="x" size={10} />
                  </button>
                ) : null}
              </span>
            ))}
            {canReply ? (
              tagging === null ? (
                <button type="button" onClick={() => setTagging('')} className="rounded-[8px] border border-dashed border-line px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink">
                  + {text('Tag')}
                </button>
              ) : (
                <input
                  autoFocus
                  aria-label={text('New tag')}
                  value={tagging}
                  maxLength={40}
                  onChange={(e) => setTagging(e.target.value)}
                  onBlur={() => setTagging(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setTagging(null);
                    if (e.key === 'Enter' && tagging.trim()) {
                      saveTags([...tags, tagging.trim().replace(/,/g, ' ')]);
                      setTagging(null);
                    }
                  }}
                  className="h-6 w-24 rounded-[8px] border border-primary bg-surface px-1.5 text-[11px] outline-none"
                />
              )
            ) : !tags.length ? (
              <span className="text-[11px] text-ink-3">{text('No tags')}</span>
            ) : null}
          </div>
        </div>
        {files.length ? (
          <div className={CARD}>
            <h3 className={HEADING}>Shared files · {files.length}</h3>
            <SharedFiles files={files} />
          </div>
        ) : null}
        <div className={CARD}>
          <h3 className={HEADING}>Previous chats · {history.length}</h3>
          {history.slice(0, 5).map((h) => (
            <span key={h.id} className="text-ink-2">
              {h.started_at ? dateLabel(h.started_at) : 'Earlier'} · {h.status}{h.rating ? ` · rated ${h.rating}/5` : ''}{h.other_device ? ' · another device' : ''}
            </span>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          {support ? <button type="button" disabled={busy} onClick={() => void ticket()} className="h-8 rounded-[8px] border border-line bg-surface font-semibold text-ink hover:bg-subtle disabled:opacity-60">Raise a support ticket from this chat</button> : null}
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
                    void websiteAction(data.conversation.id, 'block', { reason: blockWhy.trim() || null, ...(blockFor ? { days: Number(blockFor) } : {}) }).then(
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
            <p className="text-[13px] text-ink-2">{v?.name || v?.label || 'This visitor'} will no longer be able to start chats on your websites until the block ends. You can lift it sooner on the web, under Website chats › Blocked visitors.</p>
            <div className="mt-3 grid gap-3">
              <Select
                label="For"
                value={blockFor}
                options={[{ value: '1', label: 'A day' }, { value: '7', label: 'A week' }, { value: '30', label: 'A month' }, { value: '', label: 'Until somebody lifts it' }]}
                onValueChange={(v) => setBlockFor(String(v))}
              />
              <TextField label="Reason" placeholder="Spam, abuse…" maxLength={190} value={blockWhy} onChange={(e) => setBlockWhy(e.target.value)} />
            </div>
          </Modal>
        ) : null}
      </aside>
    </SidePanel>
  );
}
