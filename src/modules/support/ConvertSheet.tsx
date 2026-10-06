import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { PRIORITIES, PRIORITY_LABEL, ticketRoute, type ConversionPreview, type ConvertInput, type Meta, type SupportPriority, type SupportStatus } from '@shared/support';
import { app } from '../../core/app-state';
import { isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Kbd, Modal, Spinner, cx } from '../../components/ui';
import { K, NEEDS_NEWER_SERVER, agents, alreadyConverted, conversionPreview, convertChat, errorText, meta, newClientId } from './api';
import { Reference, StatusChip } from './parts';

/** The chat's back-link to its ticket (FR-LCH-08), and what the sheet opens with: shared by the chat's panel and the sheet. */
export function useConversion(conversationId: number, enabled = true) {
  return useQuery({ queryKey: K.conversion(conversationId), queryFn: ({ signal }) => conversionPreview(conversationId, signal), enabled, staleTime: 30_000, retry: false });
}

/** The form's state as the sheet keeps it. */
export interface ConvertForm {
  target: 'new' | number;
  subject: string;
  organization: number | null;
  priority: SupportPriority;
  department: number | null;
  team: number | null;
  category: number | null;
  /** Null: unassigned. */
  assignee: number | null;
  publicIds: number[];
  notify: boolean;
}

/**
 * The sheet's first state from the preview: a visitor with a live ticket at this desk has it suggested — appending
 * rather than raising a duplicate (FR-LCH-06) — and a new ticket is mine, at the priority and in the organization the
 * server proposes.
 */
export function initialForm(p: ConversionPreview, me: number | null): ConvertForm {
  return {
    target: p.candidates[0]?.id ?? 'new',
    subject: p.prefill.subject,
    organization: p.prefill.organization_id,
    priority: p.prefill.priority ?? 'normal',
    department: null,
    team: null,
    category: null,
    assignee: me,
    publicIds: [],
    notify: true,
  };
}

/** What `POST conversions` is sent: a new ticket's fields only for a new ticket. */
export function convertInput(conversationId: number, f: ConvertForm): ConvertInput {
  const base = { conversation_id: conversationId, target: f.target, public_message_ids: f.publicIds, notify_visitor: f.notify };
  if (f.target !== 'new') return base;
  return {
    ...base,
    subject: f.subject.trim() || undefined,
    priority: f.priority,
    organization_id: f.organization,
    department_id: f.department,
    team_id: f.team,
    category_id: f.category,
    assigned_to: f.assignee,
  };
}

const LABEL = 'text-[11.5px] font-bold tracking-[.3px] text-ink-3 uppercase';

/**
 * Website chat → ticket, natively (WS-SUPPORT-SRS-001 D-06, FR-DSK-08, FR-LCH-01…08): the sheet the chat's Raise
 * ticket opens instead of the browser.
 *
 *  - Subject, organization, priority, department, team, category and assignee, as the server proposes them
 *    (`GET conversions/{id}`'s prefill; FR-LCH-05). The requester is the visitor: matched by email to a CRM contact
 *    by the server when there is one, otherwise kept as a guest (FR-CRT-05).
 *  - Append: a visitor with a live ticket at this desk has it offered first — the chat is added to it, not raised
 *    twice — and the agent can choose a new ticket instead (FR-LCH-06).
 *  - The transcript is copied as internal notes, with the visitor's page, location and browser as the first line;
 *    messages ticked Public go to the ticket as public replies (FR-LCH-02/04). The visitor is told the reference in
 *    the chat unless that is unticked.
 *  - Once per chat (FR-LCH-03): a chat already converted opens its ticket; Raise pressed twice is one ticket (the
 *    Idempotency-Key is kept until it is done).
 *  - The result opens the ticket's tab in this window, beside the chat (FR-CRT-03, FR-DSK-08). ⌘↵ / Ctrl+Enter raises.
 */
export function ConvertSheet({ conversationId, onClose, onDone }: { conversationId: number; onClose: () => void; onDone?: (ticket: { id: number; reference: string }) => void }) {
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id ?? 0)) || null;
  const preview = useConversion(conversationId);
  const desk = useQuery({ queryKey: K.meta, queryFn: ({ signal }) => meta(signal), staleTime: 5 * 60_000 });
  const [form, setForm] = useState<ConvertForm | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const p = preview.data;
  const f = form ?? (p ? initialForm(p, me) : null);
  const people = useQuery({ queryKey: K.agents(`org:${f?.organization ?? ''}`), queryFn: () => agents({ organization: f?.organization ?? null }), enabled: !!f && f.target === 'new', staleTime: 60_000 });
  const set = (patch: Partial<ConvertForm>) => {
    if (!f) return;
    key.current = null;
    setForm({ ...f, ...patch });
  };

  const open = (id: number) => {
    navigate(ticketRoute(id));
    onClose();
  };

  const raise = async () => {
    if (!f || busy || (f.target === 'new' && !f.subject.trim())) return;
    setBusy(true);
    key.current ??= newClientId('chat');
    try {
      const r = await convertChat(convertInput(conversationId, f), key.current);
      key.current = null;
      toast('success', r.appended ? text('Added to {ref}.', { ref: r.reference }) : text('Raised as {ref}.', { ref: r.reference }));
      void qc.invalidateQueries({ queryKey: K.conversion(conversationId) });
      void qc.invalidateQueries({ queryKey: K.lists });
      void qc.invalidateQueries({ queryKey: ['support', 'views'] });
      onDone?.({ id: r.id, reference: r.reference });
      open(r.id);
    } catch (e) {
      // Raised already — by me a moment ago, or a colleague: that ticket, once (FR-LCH-03).
      const done = alreadyConverted(e);
      if (done) {
        toast('info', text('This chat is already {ref}.', { ref: done.reference }));
        void qc.invalidateQueries({ queryKey: K.conversion(conversationId) });
        open(done.id);
      } else toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const raiseKeys = isMac ? '⌘↵' : 'Ctrl+↵';
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      void raise();
    }
  };

  let body;
  if (preview.isLoading) body = <Spinner />;
  else if (preview.error) {
    body = (preview.error as Error).message === NEEDS_NEWER_SERVER ? <LegacyRaise conversationId={conversationId} onClose={onClose} onDone={onDone} /> : <ErrorNote error={preview.error} onRetry={() => void preview.refetch()} />;
  } else if (p?.ticket) {
    body = (
      <div role="status" className="flex items-center gap-2 rounded-[10px] border border-line bg-subtle px-3 py-3 text-[13px] text-ink-2">
        {text('This chat is already ticket')} <Reference className="font-semibold text-ink">{p.ticket.reference}</Reference>
        <StatusChip status={p.ticket.status as SupportStatus} />
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => open(p.ticket!.id)}>
          {text('Open')}
        </Button>
      </div>
    );
  } else if (p && f) body = <ConvertFields p={p} f={f} set={set} desk={desk.data ?? null} people={people.data ?? []} me={me} />;

  const ready = !!p && !p.ticket && !!f;
  return (
    <div onKeyDown={onKey}>
      <Modal
        title={text('Raise ticket from website chat')}
        labelledBy="support-convert-title"
        onClose={onClose}
        width={620}
        footer={
          ready ? (
            <>
              <Button onClick={onClose}>{text('Cancel')}</Button>
              <Button variant="primary" icon="life-buoy" loading={busy} disabled={f!.target === 'new' && !f!.subject.trim()} onClick={() => void raise()} aria-keyshortcuts={isMac ? 'Meta+Enter' : 'Control+Enter'}>
                {f!.target === 'new' ? text('Raise ticket') : text('Add to ticket')}
                <Kbd tone="accent" aria-hidden>
                  {raiseKeys}
                </Kbd>
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>{text('Close')}</Button>
          )
        }
      >
        <div className="flex max-h-[64vh] flex-col gap-3 overflow-y-auto pr-1 scroll-thin">{body}</div>
      </Modal>
    </div>
  );
}

function ConvertFields({ p, f, set, desk, people, me }: { p: ConversionPreview; f: ConvertForm; set: (patch: Partial<ConvertForm>) => void; desk: Meta | null; people: Array<{ id: number; name: string }>; me: number | null }) {
  const isNew = f.target === 'new';
  const inOrg = <T extends { organization_id: number | null }>(list: T[] | undefined) => (list ?? []).filter((x) => f.organization === null || x.organization_id === null || x.organization_id === f.organization);
  const orgs = desk?.organizations ?? [];
  const visitor = [p.visitor.name, p.visitor.email, p.visitor.company].filter(Boolean).join(' · ') || text('Visitor');
  const lastId = [...p.transcript].reverse().find((m) => m.from === 'agent')?.id ?? null;
  const togglePublic = (id: number, on: boolean) => set({ publicIds: on ? [...new Set([...f.publicIds, id])] : f.publicIds.filter((x) => x !== id) });
  const opt = (list: Array<{ id: number; name: string }>, none: string) => [{ value: '', label: none }, ...list.map((x) => ({ value: String(x.id), label: x.name }))];
  return (
    <>
      <p className="text-[12.5px] text-ink-2">
        <span className={LABEL}>{text('Requester')}</span> <b className="text-ink">{visitor}</b>
        <span className="block text-[11.5px] text-ink-3">{text('Matched to a CRM contact by email when there is one; otherwise kept as a guest.')}</span>
      </p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className={cx(LABEL, 'mb-1')}>{text('Ticket')}</legend>
        {p.candidates.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-[13px] text-ink">
            <input type="radio" name="convert-target" checked={f.target === c.id} onChange={() => set({ target: c.id })} />
            {text('Add to')} <Reference>{c.reference}</Reference> <span className="truncate">{c.subject}</span>
            <StatusChip status={c.status} />
          </label>
        ))}
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="radio" name="convert-target" checked={isNew} onChange={() => set({ target: 'new' })} />
          {text('Create a new ticket')}
        </label>
        {p.candidates.length ? <span className="text-[11.5px] text-ink-3">{text('The visitor has an open ticket here: adding to it avoids a duplicate.')}</span> : null}
      </fieldset>
      {isNew ? (
        <div className="grid grid-cols-2 gap-2.5">
          <label className="col-span-2 flex flex-col gap-1">
            <span className={LABEL}>{text('Subject')}</span>
            <input autoFocus value={f.subject} onChange={(e) => set({ subject: e.target.value })} className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
          </label>
          {orgs.length > 1 ? (
            <Select label={text('Organization')} value={f.organization === null ? '' : String(f.organization)} options={opt(orgs, text('Choose…'))} onValueChange={(v) => set({ organization: v ? Number(v) : null, department: null, team: null, category: null, assignee: me })} />
          ) : null}
          <div role="radiogroup" aria-label={text('Priority')} className="col-span-2 flex gap-1">
            {PRIORITIES.map((pr) => (
              <button key={pr} type="button" role="radio" aria-checked={f.priority === pr} onClick={() => set({ priority: pr })} className={cx('h-7 flex-1 rounded-[7px] border text-[12px] font-semibold', f.priority === pr ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2')}>
                {text(PRIORITY_LABEL[pr])}
              </button>
            ))}
          </div>
          <Select label={text('Department')} value={f.department === null ? '' : String(f.department)} options={opt(inOrg(desk?.departments), text('No department'))} onValueChange={(v) => set({ department: v ? Number(v) : null })} />
          <Select label={text('Team')} value={f.team === null ? '' : String(f.team)} options={opt(inOrg(desk?.teams), text('No team'))} onValueChange={(v) => set({ team: v ? Number(v) : null })} />
          <Select label={text('Category')} value={f.category === null ? '' : String(f.category)} options={opt(inOrg(desk?.categories), text('No category'))} onValueChange={(v) => set({ category: v ? Number(v) : null })} />
          <Select
            label={text('Assignee')}
            value={f.assignee === null ? '' : String(f.assignee)}
            options={[{ value: '', label: text('Unassigned') }, ...(me ? [{ value: String(me), label: text('Me') }] : []), ...people.filter((x) => x.id !== me).map((x) => ({ value: String(x.id), label: x.name }))]}
            onValueChange={(v) => set({ assignee: v ? Number(v) : null })}
          />
        </div>
      ) : null}
      <section aria-label={text('Transcript')} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className={LABEL}>{text('Transcript · {n} messages', { n: p.transcript.length })}</span>
          {lastId ? (
            <button type="button" onClick={() => togglePublic(lastId, !f.publicIds.includes(lastId))} className="ml-auto text-[12px] font-semibold text-primary">
              {f.publicIds.includes(lastId) ? text('Keep last reply internal') : text('Make last reply public')}
            </button>
          ) : null}
        </div>
        <p className="text-[11.5px] text-ink-3">{text('Copied as internal notes, with the page and browser first. Ticked messages go to the ticket as public replies.')}</p>
        <ol className="flex flex-col gap-1 rounded-[10px] border border-line bg-subtle p-2">
          {p.transcript.map((m) => (
            <li key={m.id} className="flex items-start gap-2 text-[12.5px]">
              <Checkbox aria-label={text('Public: {who} at {time}', { who: m.name, time: timeLabel(m.at) })} checked={f.publicIds.includes(m.id)} onChange={(e) => togglePublic(m.id, e.target.checked)} />
              <span className="min-w-0 flex-1">
                <b className="text-ink">{m.name}</b> <span className="text-ink-3">{timeLabel(m.at)}</span>
                <span className="block break-words whitespace-pre-wrap text-ink-2">{m.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
      <label className="flex items-center gap-2 text-[13px] text-ink">
        <Checkbox checked={f.notify} onChange={(e) => set({ notify: e.target.checked })} />
        {text('Tell the visitor the reference in the chat')}
      </label>
    </>
  );
}

/** A server without the v1 API: the as-built conversion, which takes nothing but the chat — and the ticket opens here. */
function LegacyRaise({ conversationId, onClose, onDone }: { conversationId: number; onClose: () => void; onDone?: (t: { id: number; reference: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const raise = async () => {
    setBusy(true);
    try {
      const r = await convertChat({ conversation_id: conversationId, target: 'new' }, newClientId('chat'));
      toast('success', text('Raised as {ref}.', { ref: r.reference }));
      onDone?.(r);
      navigate(ticketRoute(r.id));
      onClose();
    } catch (e) {
      const done = alreadyConverted(e) ?? ((e as { data?: { ticket?: { id?: number; reference?: string } } }).data?.ticket?.id ? { id: (e as { data: { ticket: { id: number } } }).data.ticket.id, reference: '' } : null);
      if (done) {
        navigate(ticketRoute(done.id));
        onClose();
      } else toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 text-[13px] text-ink-2">
      <p>{text('Your WorkSuite server raises the ticket from the whole chat, without these choices. It opens here once raised.')}</p>
      <Button variant="primary" icon="life-buoy" loading={busy} onClick={() => void raise()} className="self-start">
        {text('Raise ticket')}
      </Button>
    </div>
  );
}
