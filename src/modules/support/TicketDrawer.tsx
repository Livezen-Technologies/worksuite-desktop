import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ticketRoute, type Attachment, type ClientChanges, type Meta, type RelatedOrder, type TicketClient, type TicketEvent, type TicketLink, type TicketRelated, type TicketShow } from '@shared/support';
import { whatsappRoute } from '@shared/channels';
import { ApiError } from '../../core/api';
import { useCanOpen } from '../../core/access';
import { text } from '../../core/i18n';
import { useLocalFirstQuery } from '../../core/local-first-query';
import { dateLabel, stampDayLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { DRAWER_DEFAULT, DetailsDrawer, DrawerSection, DrawerToggle, useDrawer, type Drawer } from '../../components/DetailsDrawer';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Spinner, cx } from '../../components/ui';
import { useTextAi } from '../ai/textTools';
import { K, aiSummary, assistError, clientPath, errorText, findRequesters, linkContact, relatedPath, resendLicence, saveClient, unlinkContact } from './api';
import { Activity, eventWho, eventWords } from './Activity';
import { LEGACY_CHOICE_KEY, LEGACY_WIDTH_KEY, briefInput, fieldError, formatPhone, foundInConversation, lastMessageId, parseBrief, readBrief, writeBrief, type Brief } from './details';
import { openAttachment } from './files';
import { MessageFiles, isPicture } from './MessageFiles';
import { StatusChip } from './parts';
import { Properties } from './Properties';
import { LinkRow, RemotePanel, RequesterPanel, SlaPanel } from './TicketSide';

/**
 * The ticket details drawer (worksuite-desktop#334): the right side panel a ticket's tab and the inbox's reading pane
 * share. It is the shared `DetailsDrawer` that Website chats' visitor panel is too — the same splitter (dragged, or
 * ← → on it; the width kept per person), the same handle and strip, the same section cards — shown and hidden with
 * ⌘⇧I / Ctrl+Shift+I or the header's panel button. On a wide window it opens by itself beside the conversation; on a
 * narrow one it opens over it, on request.
 *
 * Its sections, each folded or not as the person left it, each there only when it has something to show:
 *
 *  A. Summary — the AI brief (2–4 lines, key facts as chips, the next step with "Reply with this", the urgency),
 *     from the same text tools as Website chats and Mail (the model on this computer first, online as the AI
 *     settings allow; the desk's own summary otherwise). Kept on this computer, shown at once, made again when a new
 *     message arrives, and on Refresh. Labelled "AI summary · may be wrong".
 *  B. Client — name, email, phone (Call, WhatsApp), company, tags and notes, edited in place (Enter or a click away
 *     saves, Esc cancels, "Saved"), checked as typed; details found in the conversation offered with Add. Read-only
 *     without contact rights.
 *     Linked contact — the WorkSuite contact, or Create contact / Link to existing; edits change it everywhere.
 *  C. Ticket properties — status, priority, type, assignee, team, category, department, due, tags, source; the SLA
 *     timers; remote support.
 *  D. Related — orders from the store (Resend licence email, Open order), earlier tickets and chats, what it is
 *     linked to. Website activity — the pages read before the chat. Attachments — every file in the thread.
 *  E. Activity — the journal's milestones; Audit log — every entry, a hundred at a time.
 *
 * The client and related parts load from the copy kept on this computer first, then the server
 * (`useLocalFirstQuery`), like the other modules. Every edit is in the ticket's history and the audit log (server).
 */

const DRAWER_ID = 'support.details';
/** The drawer's sections remember whether they are open under this name. */
const SECTIONS = 'support.details';

/**
 * Whether the drawer shows and how, and its toggle — ⌘⇧I / Ctrl+Shift+I while `active` — as the shared drawer has it:
 * beside the conversation from `wideAt` (the person's choice kept), over it on a narrower window.
 */
export function useDetailsDrawer(wideAt: number, active: boolean) {
  return useDrawer(DRAWER_ID, { wideAt, active, legacyKey: LEGACY_CHOICE_KEY });
}

export type DetailsDrawer = Drawer;

/** The header's panel button: shows and hides the drawer. */
export function DrawerButton({ drawer, className }: { drawer: Drawer; className?: string }) {
  return <DrawerToggle drawer={drawer} label={text('the ticket details')} className={className} />;
}

/** One section of the drawer, folded or not as the person left it. */
function Section(props: { id: string; title: string; count?: number; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return <DrawerSection drawer={SECTIONS} {...props} />;
}

export interface TicketDrawerProps {
  drawer: Drawer;
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

/** The journal's milestones, for the timeline: the audit log below it has every entry. */
const MILESTONES = new Set(['opened', 'converted', 'assigned', 'status', 'replied', 'merged', 'split', 'deleted', 'restored', 'acknowledged']);

export function TicketDrawer({ drawer, show, meta, links = [], onResolve, onReply, onOpenLink, onNavigate, onOpenLinked }: TicketDrawerProps) {
  const t = show.ticket;
  const legacy = show.legacy === true;
  const now = useNow(30_000).getTime();
  const client = useLocalFirstQuery<{ client: TicketClient }>({ queryKey: K.client(t.id), path: clientPath(t.id), interval: 60_000, enabled: !legacy, accept: (h) => !!(h as { client?: unknown } | null)?.client });
  const related = useLocalFirstQuery<TicketRelated>({ queryKey: K.related(t.id), path: relatedPath(t.id), interval: 120_000, enabled: !legacy, accept: (h) => Array.isArray((h as TicketRelated | null)?.tickets) });
  const website = client.data?.client.visitor?.website ?? null;
  const r = related.data ?? null;
  const milestones = show.events.filter((e) => MILESTONES.has(e.action));

  return (
    <DetailsDrawer drawer={drawer} title={text('Ticket details')} label={text('the ticket details')} defaultWidth={DRAWER_DEFAULT} legacyWidthKey={LEGACY_WIDTH_KEY}>
      {legacy ? null : <SummarySection show={show} onReply={onReply} />}
      {legacy ? null : <ClientSection show={show} q={client} onNavigate={onNavigate} />}
      {legacy ? null : <ContactSection show={show} q={client} onOpenLink={onOpenLink} />}
      <Section id="properties" title={text('Ticket properties')}>
        <Properties show={show} meta={meta} onResolve={onResolve} website={website} />
        <SlaPanel t={t} now={now} />
        <RemotePanel show={show} />
      </Section>
      <RelatedSection show={show} related={r} relatedLoading={related.isLoading} links={links} onNavigate={onNavigate} onOpenLink={onOpenLink} onOpenLinked={onOpenLinked} />
      {r?.pages?.length ? (
        <Section id="website" title={text('Website activity')} count={r.pages.length}>
          <WebsiteActivity pages={r.pages} />
        </Section>
      ) : null}
      {show.attachments.length ? (
        <Section id="files" title={text('Attachments')} count={show.attachments.length}>
          <ThreadFiles files={show.attachments} />
        </Section>
      ) : null}
      {milestones.length ? (
        <Section id="activity" title={text('Activity')} defaultOpen={false}>
          <ActivityTimeline events={milestones} />
        </Section>
      ) : null}
      {show.events.length ? (
        <Section id="audit" title={text('Audit log')} defaultOpen={false}>
          <Activity ticketId={t.id} events={show.events} />
        </Section>
      ) : null}
    </DetailsDrawer>
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
  // Nothing written yet and nothing to read: no section.
  if (!show.messages.length && !b.brief) return null;
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

/** The client's copy and the ticket's after a change the server took: everything that shows them, at once. */
function useSettleClient(ticketId: number) {
  const qc = useQueryClient();
  return (fresh: { client: TicketClient; ticket?: TicketShow['ticket'] }) => {
    qc.setQueriesData<{ client: TicketClient }>({ queryKey: K.client(ticketId) }, () => ({ client: fresh.client }));
    if (fresh.ticket) qc.setQueryData<TicketShow>(K.ticket(ticketId), (d) => (d ? { ...d, ticket: { ...d.ticket, ...fresh.ticket } } : d));
    void qc.invalidateQueries({ queryKey: K.ticket(ticketId) });
    void qc.invalidateQueries({ queryKey: K.related(ticketId) });
    void qc.invalidateQueries({ queryKey: K.lists });
  };
}

function ClientSection({ show, q, onNavigate }: { show: TicketShow; q: ClientQuery; onNavigate: (route: string) => void }) {
  const t = show.ticket;
  const c = q.data?.client ?? null;
  const canWhatsapp = useCanOpen('whatsapp');
  const editable = c?.can.edit === true && !t.merged_into;
  const settle = useSettleClient(t.id);
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
          {c ? <span className="text-[11px] text-ink-3">{c.contact ? text('Saved to the WorkSuite contact') : text('Saved on this ticket')}</span> : null}
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
    </Section>
  );
}

/**
 * The WorkSuite contact the client is (`contact_id`): shown with Open and, where allowed, Unlink; or, when there is
 * none, Create contact and Link to existing (the contacts that match the requester first). Not there when the server
 * has said nothing yet, or when there is neither a contact nor anything this person may do about it.
 */
function ContactSection({ show, q, onOpenLink }: { show: TicketShow; q: ClientQuery; onOpenLink: (link: string) => void }) {
  const t = show.ticket;
  const c = q.data?.client ?? null;
  const settle = useSettleClient(t.id);
  const [linking, setLinking] = useState(false);
  if (!c || (!c.contact && !c.contact_hidden && !c.can.link_contact)) return null;
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
  const k = c.contact;
  return (
    <Section id="contact" title={text('Linked contact')}>
      {k ? (
        <div className="flex items-center gap-2">
          <Avatar name={k.name || k.email || '?'} size={28} />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-ink">{k.name || k.email}</b>
            <span className="block truncate text-[11px] text-ink-3">{[k.email, k.phone ? formatPhone(k.phone) : null, k.company].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" onClick={() => onOpenLink(k.link)} className="shrink-0 text-[11px] font-semibold text-primary hover:underline">
            {text('WorkSuite contact · Open')}
          </button>
        </div>
      ) : c.contact_hidden ? (
        <p className="text-[11.5px] text-ink-3">{text('Linked to a contact you cannot open')}</p>
      ) : (
        <p className="text-[11.5px] text-ink-3">{text('Not linked to a contact')}</p>
      )}
      {c.can.unlink_contact ? (
        <button type="button" onClick={() => void unlink()} className="self-start text-[11px] text-ink-3 hover:text-ink hover:underline">
          {text('Unlink the contact')}
        </button>
      ) : null}
      {c.can.link_contact ? (
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

/**
 * Every file on the ticket, across the whole thread: pictures as a grid of thumbnails through the thread's own signed
 * links (`MessageFiles`, ‹ › through them in the viewer), other files as chips that open on this computer.
 */
function ThreadFiles({ files }: { files: Attachment[] }) {
  return (
    <section aria-label={text('Files on this ticket')}>
      <MessageFiles files={files} pictures={files.filter(isPicture)} onOpen={(a) => void openAttachment(a)} />
    </section>
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
  // Until the related records come, or from an older server without them: the requester and their other tickets as
  // the desk lists them.
  const fallback = !related && (relatedLoading || !!t.requester.email?.trim() || !!t.requester.name);
  const any = !!related?.orders?.length || !!related?.tickets.length || !!related?.chats?.length || links.length > 0;
  if (!any && !fallback) return null;
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
      {related?.tickets.length ? (
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
      ) : null}
      {fallback ? <RequesterPanel t={t} onOpen={(id) => onNavigate(ticketRoute(id))} onOpenLink={onOpenLink} /> : null}
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
      {links.length ? (
        <div className="flex flex-col gap-1">
          <h4 className={sub}>{text('Linked · {n}', { n: links.length })}</h4>
          {links.map((l) => (
            <LinkRow key={l.id} l={l} onOpen={(x) => (onOpenLinked ? onOpenLinked(x) : x.link && onOpenLink(x.link))} />
          ))}
        </div>
      ) : null}
    </Section>
  );
}

/** The pages the visitor read before and during the chat the ticket came from, oldest first. */
function WebsiteActivity({ pages }: { pages: NonNullable<TicketRelated['pages']> }) {
  return (
    <ol aria-label={text('Pages visited')} className="ml-1 flex flex-col gap-1 border-l-2 border-line pl-2.5">
      {pages.map((p, i) => (
        <li key={`${p.at}-${i}`} className="min-w-0">
          <div className="truncate text-ink-2" title={p.url ?? undefined}>
            {p.title || (p.url ? new URL(p.url, 'https://x').pathname : text('A page'))}
          </div>
          {p.at ? <div className="text-[10.5px] text-ink-3">{timeLabel(p.at)}</div> : null}
        </li>
      ))}
    </ol>
  );
}

/* ── E. Activity ────────────────────────────────────────────────────────── */

/** The journal's milestones, newest first: who raised, assigned, answered and closed it, and when. */
function ActivityTimeline({ events }: { events: TicketEvent[] }) {
  return (
    <ol aria-label={text('Activity timeline')} className="ml-1 flex flex-col gap-2 border-l-2 border-line pl-3">
      {events.slice(0, 30).map((e) => (
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
