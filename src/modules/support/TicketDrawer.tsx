import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ticketRoute, type ClientChanges, type Meta, type RelatedOrder, type TicketClient, type TicketLink, type TicketRelated, type TicketShow } from '@shared/support';
import { whatsappRoute } from '@shared/channels';
import { ApiError } from '../../core/api';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useLocalFirstQuery } from '../../core/local-first-query';
import { useStore } from '../../core/store';
import { dateLabel, stampDayLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { recallSection, rememberSection } from '../../components/Collapsible';
import { Icon } from '../../components/Icon';
import { ResizeDivider, useResizableWidth } from '../../components/ResizeDivider';
import { SidePanel } from '../../components/SidePanel';
import { Avatar, Button, FileBadge, Spinner, cx } from '../../components/ui';
import { useTextAi } from '../ai/textTools';
import { PANEL_CARD as CARD, PANEL_HEADING as HEADING } from '../chat/website/rowParts';
import { K, aiSummary, assistError, attachmentLink, clientPath, errorText, findRequesters, linkContact, relatedPath, resendLicence, saveClient, unlinkContact } from './api';
import { eventWho, eventWords } from './Activity';
import { DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN, briefInput, drawerState, fieldError, formatPhone, foundInConversation, lastMessageId, parseBrief, readBrief, readChoice, writeBrief, writeChoice, type Brief, type DrawerChoice } from './details';
import { openAttachment } from './files';
import { StatusChip } from './parts';
import { Properties } from './Properties';
import { LinkRow, RemotePanel, RequesterPanel, SlaPanel } from './TicketSide';

/**
 * The ticket details drawer (worksuite-desktop#334): the right side panel a ticket's tab and the inbox's reading pane
 * share, built from Website chats' own side panel — the same `SidePanel` (its handle and strip), the same splitter
 * (`ResizeDivider`, the width kept on this computer), the same card look (`PANEL_CARD`, `PANEL_HEADING`). ⌘⇧I /
 * Ctrl+Shift+I or the header's panel button shows and hides it. On a wide window it opens by itself beside the
 * conversation; on a narrow one it opens over it, on request.
 *
 * Its sections, each folded or not as the person left it:
 *
 *  A. Summary — the AI brief (2–4 lines, key facts as chips, the next step with "Reply with this", the urgency),
 *     from the same text tools as Website chats and Mail (the model on this computer first, online as the AI
 *     settings allow; the desk's own summary otherwise). Kept on this computer, shown at once, made again when a new
 *     message arrives, and on Refresh. Labelled "AI summary · may be wrong".
 *  B. Client — name, email, phone (Call, WhatsApp), company, tags and notes, edited in place (Enter or a click away
 *     saves, Esc cancels, "Saved"), checked as typed; details found in the conversation offered with Add; the linked
 *     WorkSuite contact, or Create contact / Link to existing — edits change the contact everywhere. Read-only
 *     without contact rights.
 *  C. Ticket properties — status, priority, type, assignee, team, category, department, due, tags, source; the SLA
 *     timers; remote support.
 *  D. Related — orders from the store (Resend licence email, Open order), earlier tickets and chats, the pages read
 *     before the chat, what it is linked to, and its files as a grid.
 *  E. Activity — the journal: who did what, when.
 *
 * The client and related parts load from the copy kept on this computer first, then the server
 * (`useLocalFirstQuery`), like the other modules. Every edit is in the ticket's history and the audit log (server).
 */

/** The window's width, as it changes. */
function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/**
 * Whether the drawer shows and how, and its toggle — ⌘⇧I / Ctrl+Shift+I while `active`. On a wide window the choice
 * is kept; on a narrow one it opens over the conversation, this time.
 */
export function useDetailsDrawer(wideAt: number, active: boolean) {
  const width = useWindowWidth();
  const [choice, setChoice] = useState<DrawerChoice>(() => readChoice());
  const [askedNarrow, setAskedNarrow] = useState(false);
  const { open, overlay } = drawerState(width, wideAt, choice, askedNarrow);
  const setOpen = useCallback(
    (next: boolean) => {
      if (overlay) setAskedNarrow(next);
      else {
        const v: DrawerChoice = next ? 'open' : 'closed';
        writeChoice(v);
        setChoice(v);
      }
    },
    [overlay],
  );
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'i' || !e.shiftKey || e.altKey || !(isMac ? e.metaKey : e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(!open);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, open, setOpen]);
  return { open, overlay, setOpen, toggle: () => setOpen(!open) };
}

export type DetailsDrawer = ReturnType<typeof useDetailsDrawer>;

/** The header's panel button: shows and hides the drawer. */
export function DrawerButton({ drawer, className }: { drawer: DetailsDrawer; className?: string }) {
  const label = drawer.open ? text('Hide the ticket details') : text('Show the ticket details');
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${isMac ? '⌘⇧I' : 'Ctrl+Shift+I'})`}
      aria-pressed={drawer.open}
      aria-keyshortcuts={isMac ? 'Meta+Shift+I' : 'Control+Shift+I'}
      onClick={drawer.toggle}
      className={cx('inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors', drawer.open ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink', className)}
    >
      <Icon name={drawer.open ? 'panel-right-close' : 'panel-right-open'} size={17} />
    </button>
  );
}

/** One section of the drawer, folded or not as the person left it (Collapsible's memory), in the panel's card look. */
function Section({ id, title, action, children, defaultOpen = true }: { id: string; title: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const key = `support.details.${id}`;
  const [open, setOpen] = useState(() => recallSection(uid, key) ?? defaultOpen);
  const bodyId = `support-details-${id}`;
  return (
    <section aria-label={title} className={cx(CARD, 'gap-2')}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            rememberSection(uid, key, !open);
            setOpen(!open);
          }}
          className={cx(HEADING, 'flex flex-1 items-center gap-1 text-left hover:text-ink')}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          {title}
        </button>
        {open ? action : null}
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-2">
        {open ? children : null}
      </div>
    </section>
  );
}

export interface TicketDrawerProps {
  drawer: DetailsDrawer;
  show: TicketShow;
  meta: Meta | undefined;
  links?: TicketLink[];
  onResolve: () => void;
  /** "Reply with this": the next step into the composer. */
  onReply?: (body: string) => void;
  onOpenLink: (link: string) => void;
  onNavigate: (route: string) => void;
  onOpenLinked?: (l: TicketLink) => void;
}

export function TicketDrawer({ drawer, show, meta, links = [], onResolve, onReply, onOpenLink, onNavigate, onOpenLinked }: TicketDrawerProps) {
  const size = useResizableWidth('support.details', { defaultWidth: DRAWER_DEFAULT, min: DRAWER_MIN, max: () => Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, window.innerWidth - 560)) });
  const t = show.ticket;
  const legacy = show.legacy === true;
  const now = useNow(30_000).getTime();
  const client = useLocalFirstQuery<{ client: TicketClient }>({ queryKey: K.client(t.id), path: clientPath(t.id), interval: 60_000, enabled: !legacy, accept: (h) => !!(h as { client?: unknown } | null)?.client });
  const related = useLocalFirstQuery<TicketRelated>({ queryKey: K.related(t.id), path: relatedPath(t.id), interval: 120_000, enabled: !legacy, accept: (h) => Array.isArray((h as TicketRelated | null)?.tickets) });
  const website = client.data?.client.visitor?.website ?? null;

  if (!drawer.open) {
    // Beside the conversation, the panel's strip brings it back; over it, the header's button does.
    return drawer.overlay ? null : <SidePanel id="support.details" side="right" label={text('the ticket details')} open={false} onOpenChange={drawer.setOpen}>{null}</SidePanel>;
  }

  const body = (
    <aside aria-label={text('Ticket details')} className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-ground px-3 py-3.5 text-[12px] scroll-thin" style={{ width: size.width }}>
      {legacy ? null : <SummarySection show={show} onReply={onReply} />}
      {legacy ? null : <ClientSection show={show} q={client} onNavigate={onNavigate} onOpenLink={onOpenLink} />}
      <Section id="properties" title={text('Ticket properties')}>
        <Properties show={show} meta={meta} onResolve={onResolve} website={website} />
        <SlaPanel t={t} now={now} />
        <RemotePanel show={show} />
      </Section>
      <RelatedSection show={show} related={related.data ?? null} relatedLoading={related.isLoading} links={links} onNavigate={onNavigate} onOpenLink={onOpenLink} onOpenLinked={onOpenLinked} />
      <Section id="activity" title={text('Activity')} defaultOpen={false}>
        <ActivityTimeline show={show} />
      </Section>
    </aside>
  );

  if (drawer.overlay) {
    return (
      <>
        <div aria-hidden data-support-scrim onMouseDown={() => drawer.setOpen(false)} className="absolute inset-0 z-30 bg-scrim/40" />
        <div
          className="absolute inset-y-0 right-0 z-30 flex shadow-[-12px_0_32px_-16px_rgb(0_0_0/.45)]"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              drawer.setOpen(false);
            }
          }}
        >
          <ResizeDivider state={size} side="left" label={text('Resize the ticket details')} />
          {body}
        </div>
      </>
    );
  }
  return (
    <SidePanel id="support.details" side="right" label={text('the ticket details')} open onOpenChange={drawer.setOpen}>
      <div className="relative flex h-full min-h-0 shrink-0">
        <ResizeDivider state={size} side="left" label={text('Resize the ticket details')} />
        {body}
      </div>
    </SidePanel>
  );
}

/* ── A. Summary ─────────────────────────────────────────────────────────── */

/**
 * The AI brief of a ticket, kept on this computer and made again when a message arrives: the person's own AI first
 * (local or online, as Settings › AI Assistant says), the desk's server summary otherwise.
 */
export function useTicketBrief(show: TicketShow, enabled: boolean) {
  const ai = useTextAi();
  const t = show.ticket;
  const upTo = lastMessageId(show.messages);
  const [brief, setBrief] = useState<Brief | null>(() => readBrief(t.id));
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const input = briefInput(show.messages, t.requester.name);

  const run = useCallback(
    async (force: boolean) => {
      setState({ busy: true, error: null });
      try {
        let next: Brief;
        if (ai.engine) {
          const r = await ai.run('brief', input).done;
          next = { ...parseBrief(r.text), upTo, at: new Date().toISOString(), engine: r.engine };
        } else {
          const s = await aiSummary(t.id, force);
          next = { ...parseBrief(s.text), upTo, at: s.at ?? new Date().toISOString(), engine: 'server' };
        }
        writeBrief(t.id, next);
        setBrief(next);
        setState({ busy: false, error: null });
      } catch (e) {
        setState({ busy: false, error: e instanceof ApiError ? assistError(e) : errorText(e) });
      }
    },
    // The inputs that matter are named; `ai.run` is a new function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ai.engine, input, upTo, t.id],
  );

  // Out of date — never made, or a newer message — and the AI has said what it can do: made again, a moment later.
  const stale = !brief || brief.upTo < upTo;
  useEffect(() => {
    if (!enabled || !stale || !ai.settled || !upTo) return;
    const timer = setTimeout(() => void run(false), 800);
    return () => clearTimeout(timer);
  }, [enabled, stale, ai.settled, upTo, run]);

  return { brief, busy: state.busy, error: state.error, stale, refresh: () => void run(true), why: ai.engine ? null : ai.why };
}

function SummarySection({ show, onReply }: { show: TicketShow; onReply?: (body: string) => void }) {
  const b = useTicketBrief(show, true);
  const canReply = show.can.reply === true && !show.ticket.merged_into && !!onReply;
  return (
    <Section
      id="summary"
      title={text('Summary')}
      action={
        <button type="button" onClick={b.refresh} disabled={b.busy} aria-label={text('Refresh the summary')} title={text('Refresh the summary')} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-50">
          <Icon name={b.busy ? 'spinner' : 'refresh'} size={13} className={b.busy ? 'animate-spin-slow' : undefined} />
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-[5px] bg-[#EDE9FE] px-1.5 py-px text-[10.5px] font-bold text-[#6D28D9] dark:bg-[#2A1F4A] dark:text-[#C4B5FD]">AI</span>
        <span className="text-[11px] text-ink-3">{text('AI summary · may be wrong')}</span>
        {b.brief?.urgency ? (
          <span data-urgency className="ml-auto rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-ink">
            {b.brief.urgency}
          </span>
        ) : null}
      </div>
      {b.brief ? (
        <>
          <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-ink selectable">{b.brief.summary}</p>
          {b.brief.facts.length ? (
            <ul aria-label={text('Key facts')} className="flex flex-wrap gap-1">
              {b.brief.facts.map((f) => (
                <li key={f} className="rounded-[8px] bg-selection px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
          {b.brief.next ? (
            <div className="flex flex-col gap-1 rounded-[8px] border border-dashed border-line p-2">
              <span className="text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase">{text('Next step')}</span>
              <span className="text-[12.5px] text-ink">{b.brief.next}</span>
              {canReply ? (
                <Button size="sm" variant="ghost" icon="reply" className="self-start" onClick={() => onReply!(b.brief!.next!)}>
                  {text('Reply with this')}
                </Button>
              ) : null}
            </div>
          ) : null}
          <span className="text-[10.5px] text-ink-3">
            {b.busy ? text('Updating…') : b.stale ? text('New messages since this summary') : text('Updated {when}', { when: `${dateLabel(b.brief.at)} ${timeLabel(b.brief.at)}` })}
          </span>
        </>
      ) : b.busy ? (
        <Spinner label={text('Reading the conversation…')} className="p-2" />
      ) : !show.messages.length ? (
        <p className="text-[12px] text-ink-3">{text('Nothing to summarise yet.')}</p>
      ) : null}
      {b.error ? (
        <p role="status" className="text-[11.5px] text-ink-3">
          {b.error}{' '}
          <button type="button" onClick={b.refresh} className="font-semibold text-primary hover:underline">
            {text('Try again')}
          </button>
        </p>
      ) : null}
    </Section>
  );
}

/* ── B. Client ──────────────────────────────────────────────────────────── */

type ClientQuery = ReturnType<typeof useLocalFirstQuery<{ client: TicketClient }>>;

/** A field edited in place: click, type, Enter or a click away saves, Esc puts it back; checked as typed; "Saved". */
function InlineField({
  label,
  value,
  shown,
  placeholder,
  editable,
  check,
  multiline = false,
  onSave,
  after,
}: {
  label: string;
  value: string | null;
  shown?: ReactNode;
  placeholder: string;
  editable: boolean;
  check?: (v: string) => string | null;
  multiline?: boolean;
  onSave: (v: string) => Promise<string | null>;
  after?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    if (draft === null) return;
    const v = draft.trim();
    if (v === (value ?? '').trim()) return setDraft(null);
    const why = check?.(v) ?? null;
    if (why) return setError(text(why));
    setBusy(true);
    const refused = await onSave(v);
    setBusy(false);
    if (refused) return setError(refused);
    setDraft(null);
    setError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const id = `support-client-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="w-[64px] shrink-0 text-ink-3">{label}</span>
        {draft !== null ? (
          multiline ? (
            <textarea
              id={id}
              autoFocus
              aria-label={label}
              aria-invalid={error ? true : undefined}
              value={draft}
              rows={3}
              disabled={busy}
              onChange={(e) => (setDraft(e.target.value), setError(null))}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setDraft(null);
                  setError(null);
                } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void commit();
                }
              }}
              className={cx('min-w-0 flex-1 rounded-[7px] border bg-surface px-1.5 py-1 text-[12px] text-ink outline-none', error ? 'border-danger' : 'border-primary')}
            />
          ) : (
            <input
              id={id}
              autoFocus
              aria-label={label}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              value={draft}
              disabled={busy}
              onChange={(e) => (setDraft(e.target.value), setError(null))}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setDraft(null);
                  setError(null);
                }
              }}
              className={cx('h-7 min-w-0 flex-1 rounded-[7px] border bg-surface px-1.5 text-[12px] text-ink outline-none', error ? 'border-danger' : 'border-primary')}
            />
          )
        ) : editable ? (
          <button type="button" onClick={() => setDraft(value ?? '')} aria-label={text('{field}: {value} — change', { field: label, value: value || text('none') })} className={cx('min-w-0 flex-1 truncate rounded-[6px] px-1 py-0.5 text-left font-semibold hover:bg-subtle', value ? 'text-ink' : 'font-normal text-ink-3')}>
            {value ? (shown ?? value) : placeholder}
          </button>
        ) : (
          <span className={cx('min-w-0 flex-1 truncate px-1 font-semibold selectable', value ? 'text-ink' : 'font-normal text-ink-3')}>{value ? (shown ?? value) : '—'}</span>
        )}
        {busy ? <Icon name="spinner" size={12} className="animate-spin-slow text-ink-3" /> : saved ? <span className="shrink-0 text-[11px] font-semibold text-success">{text('Saved')}</span> : null}
        {draft === null ? after : null}
      </div>
      {error ? (
        <span id={`${id}-error`} role="alert" className="pl-[72px] text-[11px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function ClientSection({ show, q, onNavigate, onOpenLink }: { show: TicketShow; q: ClientQuery; onNavigate: (route: string) => void; onOpenLink: (link: string) => void }) {
  const qc = useQueryClient();
  const t = show.ticket;
  const c = q.data?.client ?? null;
  const canWhatsapp = useCanOpen('whatsapp');
  const [linking, setLinking] = useState(false);
  const editable = c?.can.edit === true && !t.merged_into;
  const settle = (fresh: { client: TicketClient; ticket?: TicketShow['ticket'] }) => {
    qc.setQueriesData<{ client: TicketClient }>({ queryKey: K.client(t.id) }, () => ({ client: fresh.client }));
    if (fresh.ticket) qc.setQueryData<TicketShow>(K.ticket(t.id), (d) => (d ? { ...d, ticket: { ...d.ticket, ...fresh.ticket } } : d));
    void qc.invalidateQueries({ queryKey: K.ticket(t.id) });
    void qc.invalidateQueries({ queryKey: K.related(t.id) });
    void qc.invalidateQueries({ queryKey: K.lists });
  };
  /** Saves one change; the server's word on a field it refused, or null. */
  const save = async (changes: ClientChanges): Promise<string | null> => {
    try {
      settle(await saveClient(t.id, changes, t.version || undefined));
      return null;
    } catch (e) {
      const fields = e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as Record<string, string>) : {};
      const first = Object.values(fields).find((x) => typeof x === 'string');
      if (first) return first;
      toast('error', errorText(e));
      return errorText(e);
    }
  };
  const link = async (to: { contact_id: number } | { create: true }) => {
    try {
      settle(await linkContact(t.id, to));
      setLinking(false);
      toast('success', 'create' in to ? text('Contact created and linked.') : text('Linked to the contact.'));
    } catch (e) {
      toast('error', errorText(e));
    }
  };
  const unlink = async () => {
    try {
      settle(await unlinkContact(t.id));
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  const found = c ? foundInConversation(show.messages, c) : [];
  const name = c?.contact?.name ?? c?.requester.name ?? t.requester.name;
  const email = c?.contact?.email ?? c?.requester.email ?? t.requester.email;
  const phone = c?.contact?.phone ?? c?.requester.phone ?? t.requester.phone;
  const v = c?.visitor;
  return (
    <Section id="client" title={text('Client')}>
      {q.isLoading && !c ? <Spinner className="p-2" /> : null}
      <div className="flex items-center gap-2">
        <Avatar name={name || email || '?'} size={32} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px] text-ink">{name || email || text('Unknown')}</b>
          {c?.contact ? (
            <button type="button" onClick={() => onOpenLink(c.contact!.link)} className="text-[11px] font-semibold text-primary hover:underline">
              {text('WorkSuite contact · Open')}
            </button>
          ) : (
            <span className="text-[11px] text-ink-3">{c?.contact_hidden ? text('Linked to a contact you cannot open') : text('Not linked to a contact')}</span>
          )}
        </div>
      </div>
      <InlineField label={text('Name')} value={name} placeholder={text('Add a name')} editable={editable} check={(x) => fieldError('name', x)} onSave={(x) => save({ name: x })} />
      <InlineField label={text('Email')} value={email} placeholder={text('Add an email')} editable={editable} check={(x) => fieldError('email', x)} onSave={(x) => save({ email: x || null })} />
      <InlineField
        label={text('Phone')}
        value={phone}
        shown={formatPhone(phone)}
        placeholder={text('Add a phone number')}
        editable={editable}
        check={(x) => fieldError('phone', x)}
        onSave={(x) => save({ phone: x || null })}
        after={
          phone ? (
            <span className="flex shrink-0 gap-0.5">
              <button
                type="button"
                aria-label={text('Call {number}', { number: formatPhone(phone) })}
                title={text('Call')}
                onClick={() => void import('../phone/dial').then(({ placeCall }) => placeCall(phone, { contactId: c?.contact?.id ?? null, name })).catch((e: unknown) => toast('error', errorText(e)))}
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink"
              >
                <Icon name="phone" size={13} />
              </button>
              {canWhatsapp ? (
                <button type="button" aria-label={text('WhatsApp {number}', { number: formatPhone(phone) })} title="WhatsApp" onClick={() => onNavigate(whatsappRoute({ to: phone }))} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
                  <Icon name="message-circle" size={13} />
                </button>
              ) : null}
            </span>
          ) : null
        }
      />
      {c?.contact ? (
        <>
          <InlineField label={text('Company')} value={c.contact.company} placeholder={text('Optional')} editable={editable} onSave={(x) => save({ company: x || null })} />
          <TagsField tags={c.contact.tags} editable={editable} onSave={(tags) => save({ tags })} />
          <InlineField label={text('Notes')} value={c.contact.notes} placeholder={text('Private notes for staff')} editable={editable} multiline onSave={(x) => save({ notes: x || null })} />
        </>
      ) : null}
      {v && (v.language || v.timezone || v.country) ? (
        <div className="flex items-center gap-2">
          <span className="w-[64px] shrink-0 text-ink-3">{text('Where')}</span>
          <span className="min-w-0 flex-1 truncate px-1 text-ink-2">{[v.city, v.country].filter(Boolean).join(', ') || v.timezone}{v.language ? ` · ${v.language.toUpperCase()}` : ''}</span>
        </div>
      ) : null}
      {editable && found.length ? (
        <ul aria-label={text('Found in conversation')} className="flex flex-col gap-1 rounded-[8px] bg-subtle p-2">
          {found.map((f) => (
            <li key={`${f.field}:${f.value}`} className="flex items-center gap-1.5 text-[11.5px]">
              <Icon name="sparkles" size={12} className="shrink-0 text-[#7C3AED]" />
              <span className="min-w-0 flex-1 truncate text-ink-2">
                {text('Found in conversation:')} <b className="text-ink">{f.shown}</b>
              </span>
              <button type="button" onClick={() => void save({ [f.field]: f.value }).then((why) => why && toast('error', why))} className="shrink-0 font-semibold text-primary hover:underline">
                {text('Add')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {c && !c.can.edit ? <p className="text-[11px] text-ink-3">{text('Read-only: changing the client needs the contacts edit permission.')}</p> : null}
      {c?.can.unlink_contact ? (
        <button type="button" onClick={() => void unlink()} className="self-start text-[11px] text-ink-3 hover:text-ink hover:underline">
          {text('Unlink the contact')}
        </button>
      ) : null}
      {c?.can.link_contact ? (
        linking ? (
          <LinkContact matches={c.matches} onPick={(id) => void link({ contact_id: id })} onCancel={() => setLinking(false)} />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {c.can.create_contact ? (
              <Button size="sm" icon="user-plus" onClick={() => void link({ create: true })}>
                {text('Create contact')}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon="link" onClick={() => setLinking(true)}>
              {text('Link to existing')}
              {c.matches.length ? <span className="rounded-full bg-selection px-1.5 text-[10.5px] text-primary">{c.matches.length}</span> : null}
            </Button>
          </div>
        )
      ) : null}
    </Section>
  );
}

function TagsField({ tags, editable, onSave }: { tags: string[]; editable: boolean; onSave: (tags: string[]) => Promise<string | null> }) {
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <div className="flex items-start gap-2">
      <span className="w-[64px] shrink-0 pt-0.5 text-ink-3">{text('Tags')}</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-1">
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-[8px] bg-selection px-2 py-0.5 text-[11px] font-semibold text-primary">
            {tag}
            {editable ? (
              <button type="button" aria-label={text('Remove tag {tag}', { tag })} onClick={() => void onSave(tags.filter((x) => x !== tag))} className="text-primary/70 hover:text-primary">
                <Icon name="x" size={10} />
              </button>
            ) : null}
          </span>
        ))}
        {editable ? (
          typing === null ? (
            <button type="button" onClick={() => setTyping('')} className="rounded-[8px] border border-dashed border-line px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink">
              + {text('Tag')}
            </button>
          ) : (
            <input
              autoFocus
              aria-label={text('New client tag')}
              value={typing}
              maxLength={40}
              onChange={(e) => setTyping(e.target.value)}
              onBlur={() => setTyping(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setTyping(null);
                if (e.key === 'Enter' && typing.trim()) {
                  void onSave([...tags, typing.trim().replace(/,/g, ' ')]);
                  setTyping(null);
                }
              }}
              className="h-6 w-24 rounded-[8px] border border-primary bg-surface px-1.5 text-[11px] outline-none"
            />
          )
        ) : !tags.length ? (
          <span className="text-[11px] text-ink-3">—</span>
        ) : null}
      </span>
    </div>
  );
}

/** Link to existing: the contacts that match the requester first, then any found by a search of Contacts. */
function LinkContact({ matches, onPick, onCancel }: { matches: TicketClient['matches']; onPick: (id: number) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const found = useQuery({ queryKey: K.lookup(`contact:${q}`), queryFn: ({ signal }) => findRequesters(q, signal), enabled: q.trim().length >= 2, staleTime: 30_000 });
  const hits = [...matches.map((m) => ({ id: m.id, name: m.name, detail: m.email ?? m.phone })), ...(found.data ?? []).filter((h) => h.kind === 'contact' && !matches.some((m) => m.id === h.id)).map((h) => ({ id: h.id, name: h.name ?? h.email ?? `#${h.id}`, detail: h.email ?? h.phone }))];
  return (
    <div className="flex flex-col gap-1 rounded-[8px] border border-line p-2">
      <input autoFocus type="search" aria-label={text('Find a contact')} placeholder={text('Find a contact…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} className="h-7 rounded-[7px] border border-line bg-surface px-2 text-[12px] outline-none focus:border-primary" />
      {hits.map((h) => (
        <button key={h.id} type="button" onClick={() => onPick(h.id)} className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left hover:bg-subtle">
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{h.name}</span>
          {h.detail ? <span className="shrink-0 truncate text-[11px] text-ink-3">{h.detail}</span> : null}
        </button>
      ))}
      {found.isFetching ? <Spinner className="p-1" /> : null}
      <button type="button" onClick={onCancel} className="self-end text-[11px] text-ink-3 hover:underline">
        {text('Cancel')}
      </button>
    </div>
  );
}

/* ── D. Related ─────────────────────────────────────────────────────────── */

function OrderCard({ o, ticketId, canReply, onOpenLink }: { o: RelatedOrder; ticketId: number; canReply: boolean; onOpenLink: (link: string) => void }) {
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    try {
      await resendLicence(ticketId, o.id);
      toast('success', text('The licence email for order {n} is on its way.', { n: o.store_number ?? o.number ?? '' }));
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const paid = o.payment_status === 'paid';
  return (
    <li className="flex flex-col gap-1 rounded-[8px] border border-line bg-surface p-2">
      <div className="flex items-center gap-1.5">
        <Icon name="cart" size={13} className="text-ink-3" />
        <b className="text-ink">{text('Order {n}', { n: o.store_number ?? o.number ?? `#${o.id}` })}</b>
        {o.date ? <span className="text-[11px] text-ink-3">· {dateLabel(o.date)}</span> : null}
      </div>
      {o.products.length ? <span className="text-ink-2">{o.products.join(', ')}</span> : null}
      <div className="flex flex-wrap gap-1">
        {o.payment_status ? <span className={cx('rounded-[6px] px-1.5 py-px text-[10.5px] font-semibold', paid ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning-ink')}>{paid ? text('Paid') : o.payment_status}</span> : null}
        <span className={cx('rounded-[6px] px-1.5 py-px text-[10.5px] font-semibold', o.licence === 'active' ? 'bg-success-bg text-success' : o.licence === 'revoked' ? 'bg-danger-bg text-danger' : 'bg-subtle text-ink-3')}>
          {o.licence === 'active' ? text('Licence sent') : o.licence === 'revoked' ? text('Licence revoked') : text('No licence key')}
        </span>
        {o.total !== null ? <span className="text-[11px] text-ink-3">{`${o.currency ?? ''} ${o.total.toLocaleString()}`.trim()}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {o.can_resend && canReply ? (
          <Button size="sm" icon="send" loading={busy} onClick={() => void resend()}>
            {text('Resend licence email')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon="external" onClick={() => onOpenLink(o.link)}>
          {text('Open order')}
        </Button>
      </div>
    </li>
  );
}

/** One file as a tile: a picture's own thumbnail (its short-lived link), else the file's badge. */
function FileTile({ a }: { a: TicketShow['attachments'][number] }) {
  const image = /^image\//.test(a.mime ?? '') && a.scan_status !== 'infected';
  const link = useQuery({ queryKey: ['support', 'attachment-link', a.id], queryFn: () => attachmentLink(a.id), enabled: image, staleTime: 5 * 60_000, retry: false });
  return (
    <button type="button" onClick={() => void openAttachment(a)} title={text('Open {name}', { name: a.name })} className="flex aspect-square min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[8px] border border-line bg-surface p-1 hover:border-primary">
      {image && link.data?.url ? <img src={link.data.url} alt="" className="h-full w-full rounded-[6px] object-cover" /> : <FileBadge name={a.name} size={28} />}
      {image && link.data?.url ? null : <span className="w-full truncate text-center text-[10px] text-ink-3">{a.name}</span>}
    </button>
  );
}

function RelatedSection({
  show,
  related,
  relatedLoading,
  links,
  onNavigate,
  onOpenLink,
  onOpenLinked,
}: {
  show: TicketShow;
  related: TicketRelated | null;
  relatedLoading: boolean;
  links: TicketLink[];
  onNavigate: (route: string) => void;
  onOpenLink: (link: string) => void;
  onOpenLinked?: (l: TicketLink) => void;
}) {
  const t = show.ticket;
  const sub = 'text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase';
  return (
    <Section id="related" title={text('Related')}>
      {related?.orders?.length ? (
        <div className="flex flex-col gap-1">
          <h4 className={sub}>{text('Orders')}</h4>
          <ul className="flex flex-col gap-1.5">
            {related.orders.map((o) => (
              <OrderCard key={o.id} o={o} ticketId={t.id} canReply={show.can.reply === true} onOpenLink={onOpenLink} />
            ))}
          </ul>
        </div>
      ) : null}
      {related ? (
        related.tickets.length ? (
          <div className="flex flex-col gap-1">
            <h4 className={sub}>{text('Previous tickets · {n}', { n: related.tickets.length })}</h4>
            {related.tickets.map((x) => (
              <button key={x.id} type="button" onClick={() => onNavigate(ticketRoute(x.id))} className="flex min-w-0 items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left hover:bg-subtle">
                <span className="shrink-0 font-mono text-[11px] text-ink-2">{x.reference}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{x.subject}</span>
                <StatusChip status={x.status} className="py-0 text-[10px]" />
              </button>
            ))}
          </div>
        ) : null
      ) : (
        // An older server, or until the related records come: the requester's other tickets as the desk lists them.
        <RequesterPanel t={t} onOpen={(id) => onNavigate(ticketRoute(id))} onOpenLink={onOpenLink} />
      )}
      {related?.chats?.length ? (
        <div className="flex flex-col gap-1">
          <h4 className={sub}>{text('Previous chats · {n}', { n: related.chats.length })}</h4>
          {related.chats.map((c) => (
            <button key={c.id} type="button" onClick={() => onNavigate(`/chat?view=website&website=${c.id}`)} className="flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left text-ink-2 hover:bg-subtle">
              <Icon name="message-circle" size={12} className="text-ink-3" />
              <span className="min-w-0 flex-1 truncate">{[c.started_at ? `${stampDayLabel(c.started_at, 'short')}` : null, c.website].filter(Boolean).join(' · ') || text('Website chat')}</span>
              <span className="shrink-0 text-[11px] text-ink-3">{c.status}</span>
            </button>
          ))}
        </div>
      ) : null}
      {related?.pages?.length ? (
        <div className="flex flex-col gap-1">
          <h4 className={sub}>{text('Website activity')}</h4>
          <ol className="ml-1 flex flex-col gap-1 border-l-2 border-line pl-2.5">
            {related.pages.map((p, i) => (
              <li key={`${p.at}-${i}`} className="min-w-0">
                <div className="truncate text-ink-2" title={p.url ?? undefined}>
                  {p.title || (p.url ? new URL(p.url, 'https://x').pathname : text('A page'))}
                </div>
                {p.at ? <div className="text-[10.5px] text-ink-3">{timeLabel(p.at)}</div> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {links.length ? (
        <div className="flex flex-col gap-1">
          <h4 className={sub}>{text('Linked · {n}', { n: links.length })}</h4>
          {links.map((l) => (
            <LinkRow key={l.id} l={l} onOpen={(x) => (onOpenLinked ? onOpenLinked(x) : x.link && onOpenLink(x.link))} />
          ))}
        </div>
      ) : null}
      {show.attachments.length ? (
        <section aria-label={text('Files on this ticket')} className="flex flex-col gap-1">
          <h4 className={sub}>{text('Attachments · {n}', { n: show.attachments.length })}</h4>
          <div className="grid grid-cols-3 gap-1.5">
            {show.attachments.slice(0, 12).map((a) => (
              <FileTile key={a.id} a={a} />
            ))}
          </div>
        </section>
      ) : null}
      {!related?.orders?.length && !related?.tickets.length && !related?.chats?.length && !related?.pages?.length && !links.length && !show.attachments.length && !relatedLoading ? <p className="text-[11.5px] text-ink-3">{text('Nothing related yet.')}</p> : null}
    </Section>
  );
}

/* ── E. Activity ────────────────────────────────────────────────────────── */

function ActivityTimeline({ show }: { show: TicketShow }) {
  const events = show.events.slice(0, 30);
  if (!events.length) return <p className="text-[11.5px] text-ink-3">{text('Nothing has happened yet.')}</p>;
  return (
    <ol aria-label={text('Activity timeline')} className="ml-1 flex flex-col gap-2 border-l-2 border-line pl-3">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span aria-hidden className="absolute top-[5px] -left-[17px] h-1.5 w-1.5 rounded-full bg-[#C3CCF6] dark:bg-primary/50" />
          <div className="text-ink-2">
            <b className="text-ink">{eventWho(e)}</b> {eventWords(e)}
          </div>
          {e.created_at ? <div className="text-[10.5px] text-ink-3">{`${stampDayLabel(e.created_at, 'short')} ${timeLabel(e.created_at)}`}</div> : null}
        </li>
      ))}
    </ol>
  );
}
