import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ticketIdOf, ticketRoute, type Message, type TicketLink, type TicketShow } from '@shared/support';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage, isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { stampDayLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { useStickToBottom } from '../../components/useStickToBottom';
import { Avatar, Button, Empty, ErrorNote, IconButton, Kbd, Spinner, cx } from '../../components/ui';
import { K, assign, assistError, discardHeld, errorText, getTicket, insertArticle, links, messagesBefore, meta, releaseHeld, take, ticketIdForReference, transition, unwatch, watch } from './api';
import { useTicketCommands } from './palette';
import { Activity } from './Activity';
import { Assist, kbInsertText, type AssistTab } from './Assist';
import { Composer, type ComposerMode, type InsertRequest } from './Composer';
import { openAttachment } from './files';
import { usePollInterval, useSupportLive } from './live';
import { ChannelIcon, OriginLink, PriorityChip, Reference, SlaChip, StatusChip, channelLabel } from './parts';
import { Collision, useTicketPresence } from './presence';
import { useMarkRead } from './reading';
import { OutboxBar } from './Outbox';
import { ResolveDialog } from './ResolveDialog';
import { FileRow, LinkRow, connectRustDesk } from './TicketSide';
import { WIDE_TAB } from './details';
import { DrawerButton, TicketDrawer, useDetailsDrawer } from './TicketDrawer';
import { EditableSubject } from './Subject';
import { Thread, type HeldAction } from './Thread';

/** A ticket's key as its route names it: its id, or a reference looked up once. */
export function useTicketId(key: string): { id: number | null; resolving: boolean; missing: boolean } {
  const direct = ticketIdOf(key);
  const ref = useQuery({ queryKey: K.ref(key), queryFn: ({ signal }) => ticketIdForReference(key, signal), enabled: direct === null, staleTime: Infinity });
  if (direct !== null) return { id: direct, resolving: false, missing: false };
  return { id: ref.data ?? null, resolving: ref.isLoading, missing: ref.isSuccess && ref.data === null };
}

type View = 'conversation' | 'activity' | 'linked' | 'files';

/** A key typed into an editor, or with a dialog in front: not the tab's. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]');
}

/**
 * One ticket in a tab of its own (D-02, FR-DSK-01): opened from the inbox, a deep link
 * (`worksuite://support/ticket/{id}`) or a notification, and brought forward — not opened twice — when it is asked
 * for while open (core/tabs.ts). Tabs come back on relaunch; ⌘W closes one, ⌘⇧] and ⌘⇧[ go to the next and the
 * previous.
 *
 * The conversation (or the journal, the links, the files) with the composer under it, and at the side the
 * properties, the SLA, the requester, the files, what it is linked to and remote support. While the tab is in front
 * it says I am here — every 30 s, typing, and `left` when it closes or goes behind another tab — shows who else is
 * (FR-COM-11), and marks what was shown read. Realtime hints refresh it (live.ts); without the gateway it asks every
 * 30 s.
 */
export function TicketTab({ ticketKey, active }: { ticketKey: string; active: boolean }) {
  useSupportLive();
  const { id, resolving, missing } = useTicketId(ticketKey);
  const poll = usePollInterval();
  const q = useQuery({ queryKey: K.ticket(id ?? 0), queryFn: ({ signal }) => getTicket(id!, { peek: true }, signal), enabled: id !== null, refetchInterval: poll });
  useTabTitle(q.data?.ticket.reference ?? ticketKey);
  useMarkRead(id, q.data, active);

  if (missing || (q.error instanceof ApiError && q.error.status === 404)) {
    return <Empty icon="life-buoy" title={text('Ticket not found')} hint={text('It may have been deleted, merged, or it is not in your organizations.')} />;
  }
  if (resolving || q.isLoading) return <Spinner />;
  if (q.error) {
    return (
      <div className="p-4">
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  return q.data ? <TicketView show={q.data} active={active} /> : null;
}

function TicketView({ show, active }: { show: TicketShow & { offline?: boolean }; active: boolean }) {
  const qc = useQueryClient();
  const { navigate, openLink } = useTab();
  const t = show.ticket;
  const legacy = show.legacy === true;
  const metaQ = useQuery({ queryKey: K.meta, queryFn: ({ signal }) => meta(signal), staleTime: 5 * 60_000 });
  const linksQ = useQuery({ queryKey: K.links(t.id), queryFn: ({ signal }) => links(t.id, signal), enabled: !legacy, staleTime: 60_000 });
  const me = Number(useStore(app, (s) => s.auth?.user?.id ?? 0)) || null;
  const now = useNow(30_000).getTime();
  const [view, setView] = useState<View>('conversation');
  const [typing, setTyping] = useState<ComposerMode | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ mode: ComposerMode; n: number } | null>(null);
  const [earlier, setEarlier] = useState<Message[]>([]);
  const [hasEarlier, setHasEarlier] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The KB & AI panel (D-10): ⌘J opens and closes it; what it gives goes into the composer through `insert`.
  const [assist, setAssist] = useState<{ open: boolean; tab: AssistTab; search: number }>({ open: false, tab: 'kb', search: 0 });
  const [insert, setInsert] = useState<InsertRequest | null>(null);
  const toInsert = (r: Omit<InsertRequest, 'n'>) => {
    setView('conversation');
    setInsert((x) => ({ ...r, n: (x?.n ?? 0) + 1 }));
  };
  const toggleAssist = () => setAssist((a) => ({ ...a, open: !a.open }));
  const present = useTicketPresence(t.id, { here: active, typing });
  const drawer = useDetailsDrawer(WIDE_TAB, active);
  const messages = [...earlier.filter((m) => !show.messages.some((x) => x.id === m.id)), ...show.messages];
  const { scroller, content, unseen, toEnd, onScroll } = useStickToBottom(`${view}:${messages.length}`);
  const readOnly = !!t.merged_into || !!t.deleted_at;
  const canResolve = !readOnly && show.transitions.includes('resolved');

  // R, N and E, as in the inbox (FR-WSP-06), while this tab is in front.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || readOnly) return;
      const k = e.key.toLowerCase();
      if (k === 'r' || k === 'n') {
        e.preventDefault();
        setView('conversation');
        setFocusRequest((f) => ({ mode: k === 'r' ? 'reply' : 'note', n: (f?.n ?? 0) + 1 }));
      } else if (k === 'e' && canResolve) {
        e.preventDefault();
        setResolveOpen(true);
      }
    };
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // ⌘J / Ctrl+J: the KB & AI panel, before the shell's (the assistant's) — only while this tab is in front.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'j' || e.shiftKey || e.altKey || !(isMac ? e.metaKey : e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleAssist();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // ⌘K: this ticket's actions while its tab is in front (D-08), as its buttons allow them.
  const composing = !readOnly && (show.can.reply === true);
  useTicketCommands(active, {
    id: t.id,
    reference: t.reference,
    take: readOnly
      ? null
      : !t.assignee && show.can.reply
        ? { label: text('Assign {ref} to me', { ref: t.reference }), run: () => void act('take', () => take(t.id, t.version || undefined), text('{ref} is yours.', { ref: t.reference })) }
        : t.assignee && me && t.assignee.id !== me && show.can.assign
          ? { label: text('Reassign {ref} to me (from {name})', { ref: t.reference, name: t.assignee.name ?? '' }), run: () => void act('take', () => assign(t.id, { user_id: me, version: t.version || undefined }), text('{ref} is yours.', { ref: t.reference })) }
          : null,
    resolve: canResolve ? () => setResolveOpen(true) : null,
    canned: composing
      ? () => {
          setView('conversation');
          setFocusRequest((f) => ({ mode: 'reply', n: (f?.n ?? 0) + 1, canned: true }));
        }
      : null,
    assist: toggleAssist,
    kbLink: composing ? () => setAssist((a) => ({ open: true, tab: 'kb', search: a.search + 1 })) : null,
    insertArticle: composing
      ? (a, mode) =>
          void insertArticle(t.id, a.id, mode).then(
            (r) => toInsert({ text: kbInsertText(mode, r), how: 'insert' }),
            (e: unknown) => toast('error', assistError(e)),
          )
      : null,
  });

  const watching = !!me && (t.watchers ?? []).some((w) => w.id === me);
  const linkList: TicketLink[] = linksQ.data ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.ticket(t.id) });
    void qc.invalidateQueries({ queryKey: K.lists });
    void qc.invalidateQueries({ queryKey: ['support', 'views'] });
  };
  const act = async (key: string, run: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await run();
      toast('success', done);
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  // A reply held from an unverified sender (#336): into the conversation, or out of review.
  const onHeld = (m: Message, action: HeldAction) =>
    void act(`held-${m.id}`, () => (action === 'release' ? releaseHeld(t.id, m.id) : discardHeld(t.id, m.id)), action === 'release' ? text('Released into the conversation') : text('Discarded'));
  const loadEarlier = async () => {
    const first = messages[0];
    if (!first) return;
    setBusy('earlier');
    try {
      const r = await messagesBefore(t.id, first.id);
      setEarlier((x) => [...r.messages, ...x]);
      setHasEarlier(r.has_more);
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const openLinked = (l: TicketLink) => {
    if (l.module === 'support' && l.entity === 'ticket') navigate(ticketRoute(l.entity_id));
    else openLink(l.link);
  };
  const opened = t.opened_at ?? t.created_at;
  const views: Array<{ id: View; label: string; count: number }> = [
    { id: 'conversation', label: text('Conversation'), count: messages.length },
    { id: 'activity', label: text('Activity'), count: show.events.length },
    ...(legacy ? [] : [{ id: 'linked' as const, label: text('Linked'), count: linkList.length }]),
    { id: 'files', label: text('Files'), count: show.attachments.length },
  ];

  return (
    <div className="relative flex h-full min-h-0 bg-ground">
      <div className="flex min-w-0 flex-1 flex-col">
        <OutboxBar />
        <header className="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-5 pt-3">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-ink-3">
            <button type="button" onClick={() => navigate('/support')} className="shrink-0 hover:text-ink hover:underline">
              {text('Support')}
            </button>
            <span aria-hidden>/</span>
            <Reference className="font-semibold text-ink">{t.reference}</Reference>
            <ChannelIcon source={t.source} />
            <span className="min-w-0 truncate">
              {[channelLabel(t.source), opened ? text('opened {when}', { when: `${stampDayLabel(opened, 'short')}, ${timeLabel(opened)}` }) : null, t.organization?.name].filter(Boolean).join(' · ')}
            </span>
            <OriginLink origin={t.origin} />
            <Collision present={present} className="ml-auto" />
          </div>
          <EditableSubject show={show} level="h1" />
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={t.status} />
            <PriorityChip priority={t.priority} />
            {t.assignee ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <Avatar name={t.assignee.name} size={20} />
                {t.assignee.name}
              </span>
            ) : (
              <span className="text-[12.5px] text-ink-3">{text('Unassigned')}</span>
            )}
            <SlaChip sla={t.sla} now={now} long />
            {t.confidential ? <span className="rounded-[6px] bg-danger-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-danger">{text('Confidential')}</span> : null}
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {!readOnly && !t.assignee && show.can.reply ? (
                <Button size="sm" icon="user-plus" loading={busy === 'take'} onClick={() => void act('take', () => take(t.id, t.version || undefined), text('{ref} is yours.', { ref: t.reference }))}>
                  {text('Take it')}
                </Button>
              ) : null}
              {!readOnly && !legacy && me ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={watching ? 'eye-off' : 'eye'}
                  aria-pressed={watching}
                  loading={busy === 'watch'}
                  onClick={() => void act('watch', () => (watching ? unwatch(t.id, me) : watch(t.id)), watching ? text('You no longer follow {ref}.', { ref: t.reference }) : text('You follow {ref}: you are told when it changes.', { ref: t.reference }))}
                >
                  {watching ? text('Following') : text('Follow')}
                </Button>
              ) : null}
              {t.rustdesk_uri ? (
                <Button size="sm" icon="monitor" title={text('Connect to the requester’s computer with RustDesk')} onClick={() => connectRustDesk(t.rustdesk_uri)}>
                  {text('Remote')}
                </Button>
              ) : null}
              {!readOnly && show.transitions.includes('escalated') ? (
                <Button size="sm" icon="arrow-up" loading={busy === 'escalate'} onClick={() => void act('escalate', () => transition(t.id, { status: 'escalated', version: t.version || undefined }), text('{ref} escalated.', { ref: t.reference }))}>
                  {text('Escalate')}
                </Button>
              ) : null}
              {canResolve ? (
                <Button size="sm" variant="primary" icon="check" aria-keyshortcuts="E" onClick={() => setResolveOpen(true)}>
                  {text('Resolve')}
                </Button>
              ) : null}
              {legacy ? null : (
                <Button size="sm" variant={assist.open ? 'secondary' : 'ghost'} icon="sparkles" aria-pressed={assist.open} aria-keyshortcuts={isMac ? 'Meta+J' : 'Control+J'} onClick={toggleAssist}>
                  {text('KB & AI')}
                  <Kbd aria-hidden>{isMac ? '⌘J' : 'Ctrl+J'}</Kbd>
                </Button>
              )}
              <DrawerButton drawer={drawer} />
              <IconButton icon="globe" label={text('Open on the web: merge, split and the rest of the desk')} onClick={() => void call('app:openInBrowser', { path: `/tickets?ticket=${t.id}` }).catch((e: unknown) => toast('error', errorMessage(e)))} />
            </span>
          </div>
          {t.merged_into ? (
            <p role="status" className="rounded-[8px] bg-warning-bg px-3 py-1.5 text-[12.5px] text-warning-ink">
              {text('Merged into {ref}: this ticket is read-only.', { ref: t.merged_into.reference })}{' '}
              <button type="button" className="font-semibold underline" onClick={() => navigate(ticketRoute(t.merged_into!.id))}>
                {text('Open {ref}', { ref: t.merged_into.reference })}
              </button>
            </p>
          ) : t.deleted_at ? (
            <p role="status" className="rounded-[8px] bg-warning-bg px-3 py-1.5 text-[12.5px] text-warning-ink">
              {text('This ticket is in the trash: it is read-only until it is brought back.')}
            </p>
          ) : null}
          <div role="tablist" aria-label={text('Ticket')} className="-mb-px flex gap-4">
            {views.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={view === x.id}
                onClick={() => setView(x.id)}
                className={cx('flex h-9 items-center gap-1.5 border-b-2 text-[13px] font-semibold', view === x.id ? 'border-primary text-ink' : 'border-transparent text-ink-3 hover:text-ink')}
              >
                {x.label}
                <span className="rounded-full bg-subtle px-1.5 text-[11px] text-ink-3 tabular-nums">{x.count}</span>
              </button>
            ))}
          </div>
        </header>
        <div className="relative min-h-0 flex-1">
          <div role="tabpanel" aria-label={views.find((x) => x.id === view)?.label} ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-5 py-4 scroll-thin">
            <div ref={content}>
              {view === 'conversation' ? (
                <>
                  {(hasEarlier ?? show.has_earlier) ? (
                    <div className="flex justify-center pb-3">
                      <Button size="sm" variant="ghost" loading={busy === 'earlier'} onClick={() => void loadEarlier()}>
                        {text('Show earlier messages')}
                      </Button>
                    </div>
                  ) : null}
                  <Thread messages={messages} attachments={show.attachments} lastRead={show.last_read_message_id} me={me} source={(hasEarlier ?? show.has_earlier) ? null : t.source} requester={t.requester?.name} onOpenAttachment={(a) => void openAttachment(a)} ticketId={t.id} onHeld={onHeld} />
                  {legacy ? <p className="pt-3 text-center text-[11.5px] text-ink-3">{text('Your WorkSuite server is older: read markers, files and who else is here show once it is updated.')}</p> : null}
                </>
              ) : view === 'activity' ? (
                <Activity ticketId={t.id} events={show.events} />
              ) : view === 'linked' ? (
                linkList.length ? (
                  <ul aria-label={text('Linked')} className="flex flex-col gap-1">
                    {linkList.map((l) => (
                      <li key={l.id} className="rounded-[10px] border border-line bg-surface px-2 py-1">
                        <LinkRow l={l} onOpen={openLinked} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty icon="link" title={text('Not linked to anything')} hint={text('Links to other tickets, deals, invoices and assets are made on the web for now.')} />
                )
              ) : show.attachments.length ? (
                <ul aria-label={text('Files')} className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
                  {show.attachments.map((a) => (
                    <li key={a.id} className="rounded-[10px] border border-line bg-surface p-1">
                      <FileRow a={a} />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon="paperclip" title={text('No files on this ticket')} hint={text('Drop files on the composer, or paste a screenshot, to attach them to a reply or a note.')} />
              )}
            </div>
          </div>
          {view === 'conversation' && unseen ? (
            <button type="button" onClick={toEnd} className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-semibold text-primary shadow-md">
              {text('New messages below')}
            </button>
          ) : null}
        </div>
        {/* Kept while another view is shown: what is typed, and the files still going up, stay with it. */}
        {!readOnly ? <Composer ticket={t} can={show.can} transitions={show.transitions} legacy={legacy} hidden={view !== 'conversation'} focusRequest={focusRequest} insertRequest={insert} onTyping={setTyping} onSent={() => toEnd()} /> : null}
      </div>
      {assist.open && !legacy ? <Assist show={show} tab={assist.tab} onTab={(tab) => setAssist((a) => ({ ...a, tab }))} searchRequest={assist.search} onInsert={toInsert} onClose={() => setAssist((a) => ({ ...a, open: false }))} /> : null}
      {/* The details drawer (#334): Website chats' side panel, its splitter and cards; ⌘⇧I. */}
      <TicketDrawer
        drawer={drawer}
        show={show}
        meta={metaQ.data}
        links={linkList}
        onResolve={() => setResolveOpen(true)}
        onReply={composing ? (body) => toInsert({ text: body, how: 'insert', mode: 'reply' }) : undefined}
        onOpenLink={openLink}
        onNavigate={navigate}
        onOpenLinked={openLinked}
      />
      {resolveOpen ? <ResolveDialog ticket={t} onClose={() => setResolveOpen(false)} /> : null}
    </div>
  );
}
