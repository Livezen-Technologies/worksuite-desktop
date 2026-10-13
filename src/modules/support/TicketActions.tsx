import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { PRIORITY_LABEL, statusLabel, type BulkAction, type BulkResult, type Meta, type SupportPriority, type SupportStatus, type Ticket, type TicketPage, type TicketShow } from '@shared/support';
import { apiGet } from '../../core/api';
import { call, errorMessage, isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { dateLabel, timeLabel, todayInZone, wallToUtc } from '../../core/time';
import { dismissKey, toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Checkbox } from '../../components/Checkbox';
import { ContextMenu } from '../../components/ContextMenu';
import { Icon } from '../../components/Icon';
import type { MenuSection } from '../../components/Menu';
import { Button, Kbd, Modal, Spinner, TextField, cx } from '../../components/ui';
import { K, addLink, agents, errorText, getTicket, listTickets } from './api';
import { BATCH, PRIORITY_DOT, bulkInBatches, bulkSummary, doneWords, notifyCount, refusalReasons, statusWord, ticketCount, ticketMenu, undoCalls, undoInputs, type BulkInput, type BulkProgress, type TicketMenuHandlers, type UndoCall } from './bulk';
import { ticketDeepLink } from './palette';
import { presenceLabel } from './parts';

/**
 * What the ticket list does to tickets (worksuite-desktop#333): the right-click menu, the bulk bar's actions and the
 * keyboard's, with their dialogs — Assign to… (people and teams, searchable), Add tag, Snooze until, Merge (choose the
 * main ticket; tell the requesters, optionally), Link to…, Delete (confirmed) — and the one toast that says what
 * happened, with Undo.
 *
 * A change shows in the list at once (the rows are patched where they are; rows it takes out of the view go), then
 * goes to `POST tickets/bulk`. More than BATCH tickets run in the background in batches, with their progress in a
 * toast, while the list stays usable. A bulk status change to Solved or Closed asks first whether the customers are
 * told ("Send solved notifications to 3 customers?" — Send, or Change quietly). Every change is in each ticket's
 * history and the audit log (the server's).
 */

export interface TicketActionsContext {
  rows: Ticket[];
  meta: Meta | undefined;
  me: number | null;
  onOpen: (id: number) => void;
  onOpenTab: (id: number) => void;
  onOpenWindow: (id: number) => void;
  /** Reply, note, or a saved reply in the reading pane's composer. */
  onCompose: (id: number, mode: 'reply' | 'note', canned?: boolean) => void;
  onNavigate: (route: string) => void;
  /** Tickets a change took out of the list (deleted, spam, snoozed, merged away): out of the selection too. */
  onGone?: (ids: number[]) => void;
}

type Dialog =
  | { kind: 'assign'; ids: number[] }
  | { kind: 'tag'; ids: number[] }
  | { kind: 'snooze'; ids: number[] }
  | { kind: 'merge'; ids: number[] }
  | { kind: 'link'; id: number }
  | { kind: 'delete'; ids: number[] }
  | { kind: 'notify'; ids: number[]; status: SupportStatus; count: number };

/** The changes the list shows at once, before the server answers. */
function patchOf(action: BulkAction, fields: Record<string, unknown>, names: { assignee?: string | null; team?: string | null }): ((t: Ticket) => Ticket | null) | null {
  switch (action) {
    case 'status':
      return (t) => ({ ...t, status: fields.status as SupportStatus });
    case 'priority':
      return (t) => ({ ...t, priority: fields.priority as SupportPriority });
    case 'assign':
      return (t) => ({ ...t, assignee: fields.user_id ? { id: Number(fields.user_id), name: names.assignee ?? null } : null, ...('team_id' in fields ? { team: fields.team_id ? { id: Number(fields.team_id), name: names.team ?? null } : null } : {}) });
    case 'team':
      return (t) => ({ ...t, team: fields.team_id ? { id: Number(fields.team_id), name: names.team ?? null } : null });
    case 'tag':
      return (t) => ({ ...t, tags: [...new Set([...t.tags, ...((fields.tags as string[]) ?? [])])] });
    case 'untag':
      return (t) => ({ ...t, tags: t.tags.filter((x) => !((fields.tags as string[]) ?? []).includes(x)) });
    case 'watch':
    case 'unwatch':
      return (t) => ({ ...t, watching: action === 'watch' });
    case 'read':
      return (t) => ({ ...t, unread: 0 });
    case 'unread':
      return (t) => ({ ...t, unread: Math.max(1, t.unread) });
    case 'unsnooze':
      return (t) => ({ ...t, snoozed_until: null });
    // Out of the view: snoozed, deleted, spam, merged away.
    case 'snooze':
    case 'delete':
    case 'spam':
      return () => null;
    case 'merge':
      return (t) => (t.id === Number(fields.primary_id) ? t : null);
    case 'restore':
      return null;
  }
}

/** Patch every cached list page: the rows these ids are, changed or gone. */
export function patchLists(qc: QueryClient, ids: readonly number[], patch: (t: Ticket) => Ticket | null): void {
  const set = new Set(ids);
  qc.setQueriesData<InfiniteData<TicketPage>>({ queryKey: K.lists }, (d) =>
    d?.pages
      ? {
          ...d,
          pages: d.pages.map((p) => ({ ...p, items: p.items.flatMap((t) => (set.has(t.id) ? ((x) => (x ? [x] : []))(patch(t)) : [t])) })),
        }
      : d,
  );
}

/** A ticket as printed or saved as a PDF: its header, then the conversation, notes marked. */
export function printable(show: TicketShow): string {
  const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const t = show.ticket;
  const facts = [
    [text('Status'), text(statusLabel(t.status))],
    [text('Priority'), text(PRIORITY_LABEL[t.priority] ?? t.priority)],
    [text('Requester'), [t.requester.name, t.requester.email].filter(Boolean).join(' · ')],
    [text('Assignee'), t.assignee?.name ?? text('Unassigned')],
    [text('Opened'), t.created_at ? `${dateLabel(t.created_at)} ${timeLabel(t.created_at)}` : ''],
  ];
  return `<style>body{font:13px/1.5 system-ui,sans-serif;color:#111;margin:32px}h1{font-size:19px;margin:0 0 4px}.ref{color:#555;font-family:monospace}table{border-collapse:collapse;margin:12px 0}td{padding:2px 12px 2px 0;vertical-align:top}.m{border-top:1px solid #ddd;padding:10px 0}.who{font-weight:600}.note{background:#fff8e1;padding:10px}.when{color:#666;font-size:12px}</style>
<div class="ref">${esc(t.reference)}</div><h1>${esc(t.subject)}</h1>
<table>${facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
${show.messages
  .map(
    (m) =>
      `<div class="m${m.internal ? ' note' : ''}"><div class="who">${esc(m.author?.name ?? m.author_name ?? (m.from === 'requester' ? t.requester.name : ''))}${m.internal ? ` · ${esc(text('Internal note'))}` : ''}</div><div class="when">${m.created_at ? esc(`${dateLabel(m.created_at)} ${timeLabel(m.created_at)}`) : ''}</div><div>${esc(m.body).replace(/\n/g, '<br>')}</div></div>`,
  )
  .join('')}`;
}

/**
 * The calls that take a change back, each with the version the change left its tickets at: from the server's `before`
 * where its answer has it, else from the tickets as the list showed them (`undoInputs`).
 */
export function planUndo(action: BulkAction, ids: number[], fields: Record<string, unknown>, was: readonly Ticket[], results: readonly BulkResult[]): UndoCall[] {
  const done = results.filter((r) => r.ok);
  if (done.length && done.every((r) => r.before)) {
    const left = new Map(done.filter((r) => r.version).map((r) => [r.id, r.version!]));
    return undoCalls(action, fields, results).map((c) => {
      const versions = Object.fromEntries(c.ids.filter((id) => left.has(id)).map((id) => [id, left.get(id)!]));
      return c.action === 'restore' || !Object.keys(versions).length ? c : { ...c, fields: { ...c.fields, versions } };
    });
  }
  const { versions: _versions, ...rest } = fields;
  return undoInputs({ ...(rest as Omit<BulkInput, 'ids' | 'action'>), ids, action }, was, { results: [...results] }).map(({ action: a, ids: back, ...f }) => ({ action: a, ids: back, fields: { reason: 'Undo', ...f } }));
}

/** Each background change has a toast of its own. */
let bulkSeq = 0;

export function useTicketActions(ctx: TicketActionsContext) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; sections: MenuSection[]; label: string } | null>(null);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const byId = (ids: readonly number[]) => ids.map((id) => ctx.rows.find((t) => t.id === id)).filter((t): t is Ticket => !!t);

  const refresh = (ids: readonly number[]) => {
    void qc.invalidateQueries({ queryKey: K.lists });
    void qc.invalidateQueries({ queryKey: ['support', 'views'] });
    for (const id of ids) void qc.invalidateQueries({ queryKey: K.ticket(id) });
  };

  const names = (fields: Record<string, unknown>) => ({
    assignee: fields.user_id ? (fields.user_id === ctx.me ? text('you') : (fields.assignee_name as string | undefined) ?? null) : null,
    team: fields.team_id ? (ctx.meta?.teams.find((t) => t.id === Number(fields.team_id))?.name ?? null) : null,
  });

  /** The reference a refusal names: the ticket's, as the list showed it. */
  const refOf = (id: number) => ctx.rows.find((t) => t.id === id)?.reference ?? `#${id}`;

  /** Says what was refused and why, each reason with the tickets it names; "Nothing changed" when none was done. */
  const sayRefused = (results: BulkResult[]) => {
    const refused = results.filter((r) => !r.ok);
    if (!refused.length) return;
    const done = results.length - refused.length;
    if (!done) toast('error', bulkSummary({ results, done, refused: refused.length }, '', refOf).text);
    else toast('error', text('{count} could not be changed: {why}', { count: ticketCount(refused.length), why: refusalReasons(results, refOf) }));
  };

  /** The version each ticket was listed at, so one changed meanwhile is refused rather than overwritten. */
  const versionsOf = (tickets: readonly Ticket[]) => Object.fromEntries(tickets.filter((t) => t.version > 0).map((t) => [t.id, t.version]));

  /** Run a change now: patched in the list, sent (in batches when large), told with Undo. */
  const run = async (action: BulkAction, ids: number[], fields: Record<string, unknown> = {}, opts: { undo?: boolean } = {}) => {
    if (!ids.length) return;
    const n = names(fields);
    // The tickets as they were: an Undo without the server's `before` is planned from these.
    const was = byId(ids);
    // A merge or a restore is not refused for a version; anything else goes with the version each ticket was listed at.
    if (fields.versions === undefined && action !== 'merge' && action !== 'restore' && was.length) fields = { ...fields, versions: versionsOf(was) };
    const patch = patchOf(action, fields, n);
    if (patch) patchLists(qc, ids, patch);
    // Out of the view, out of the selection.
    if (patch && ctx.onGone) {
      const gone = was.filter((t) => patch(t) === null).map((t) => t.id);
      if (gone.length) ctx.onGone(gone);
    }
    const big = ids.length > BATCH;
    const key = big ? `support-bulk-${++bulkSeq}` : 'support-bulk';
    if (big) {
      setProgress({ done: 0, total: ids.length, refused: 0 });
      toast('info', text('Changing {count} in the background… 0 of {total}', { count: ticketCount(ids.length), total: ids.length }), undefined, undefined, { key, sticky: true });
    }
    let results: BulkResult[] = [];
    try {
      results = await bulkInBatches(action, ids, { ...fields, assignee_name: undefined }, (p) => {
        if (!big) return;
        setProgress(p);
        toast('info', text('Changing {count} in the background… {done} of {total}', { count: ticketCount(p.total), done: p.done, total: p.total }), undefined, undefined, { key, sticky: true });
      });
    } catch (e) {
      if (big) dismissKey(key);
      setProgress(null);
      toast('error', errorText(e));
      refresh(ids);
      return;
    }
    setProgress(null);
    refresh(ids);
    const done = results.filter((r) => r.ok).length;
    sayRefused(results);
    if (!done) {
      if (big) dismissKey(key);
      return;
    }
    const undo = opts.undo === false ? [] : planUndo(action, ids, fields, was, results);
    toast(
      'success',
      doneWords(action, done, fields, n),
      undo.length
        ? {
            label: text('Undo'),
            run: () => {
              void (async () => {
                for (const c of undo) await run(c.action, c.ids, c.fields, { undo: false });
              })();
            },
          }
        : undefined,
      // Five seconds to undo; a large change keeps its Undo a while longer, its toast being the record of it.
      big ? 30_000 : 5_000,
      { key },
    );
  };

  /** Apply from the menu, the bar or a key: asks first where it must (notify customers, delete). */
  const apply = (action: BulkAction, ids: number[], fields: Record<string, unknown> = {}) => {
    if (action === 'status' && ids.length > 1) {
      const count = notifyCount(byId(ids), fields.status as SupportStatus);
      if (count > 0) {
        setDialog({ kind: 'notify', ids, status: fields.status as SupportStatus, count });
        return;
      }
    }
    void run(action, ids, fields);
  };

  const copy = (value: string, said: string) =>
    void navigator.clipboard.writeText(value).then(
      () => toast('success', said),
      () => toast('error', text('The clipboard could not be written to.')),
    );

  const print = async (id: number, pdf: boolean) => {
    try {
      const show = await getTicket(id, { peek: true });
      const html = printable(show);
      const title = `${show.ticket.reference} ${show.ticket.subject}`.slice(0, 190);
      if (pdf) {
        const path = await call('print:toPdf', { html, title });
        if (path) toast('success', text('Saved as a PDF.'));
      } else await call('print:print', { html, title });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const handlers = (ids: number[]): TicketMenuHandlers => {
    const first = ids[0]!;
    const tickets = byId(ids);
    return {
      open: () => ctx.onOpen(first),
      openTab: () => ids.slice(0, 10).forEach((id) => ctx.onOpenTab(id)),
      openWindow: () => ctx.onOpenWindow(first),
      apply: (action, fields) => apply(action, ids, fields),
      assignTo: () => setDialog({ kind: 'assign', ids }),
      addTag: () => setDialog({ kind: 'tag', ids }),
      snoozePick: () => setDialog({ kind: 'snooze', ids }),
      merge: () => setDialog({ kind: 'merge', ids }),
      link: () => setDialog({ kind: 'link', id: first }),
      createTask: () => {
        const t = tickets[0];
        ctx.onNavigate(`/tasks?new=1&title=${encodeURIComponent(t ? `${t.reference}: ${t.subject}` : `#${first}`)}`);
      },
      reply: () => ctx.onCompose(first, 'reply'),
      note: () => ctx.onCompose(first, 'note'),
      macro: () => ctx.onCompose(first, 'reply', true),
      copyId: () => copy(tickets.map((t) => t.reference).join('\n'), ids.length > 1 ? text('Ticket IDs copied.') : text('Ticket ID copied.')),
      copyLink: () => copy(ids.map(ticketDeepLink).join('\n'), ids.length > 1 ? text('Links copied.') : text('Link copied.')),
      print: () => void print(first, false),
      exportPdf: () => void print(first, true),
      remove: () => setDialog({ kind: 'delete', ids }),
    };
  };

  const dot = (p: SupportPriority) => <span aria-hidden className={cx('inline-block h-2.5 w-2.5 rounded-full', PRIORITY_DOT[p])} />;
  const sectionsFor = (ids: number[]) => ticketMenu(byId(ids), { meta: ctx.meta, me: ctx.me, dot }, handlers(ids));

  /** The right-click menu at the mouse, for these tickets. */
  const openMenu = (x: number, y: number, ids: number[]) => {
    if (!ids.length) return;
    setMenu({ x, y, sections: sectionsFor(ids), label: ids.length > 1 ? text('Actions for {count}', { count: ticketCount(ids.length) }) : text('Ticket actions') });
  };

  /** One part of the menu on its own (P: priority, Status ▾ on the bar…), at a point. */
  const openPart = (x: number, y: number, ids: number[], part: 'status' | 'priority' | 'assign' | 'more') => {
    if (!ids.length) return;
    const all = sectionsFor(ids);
    let sections: MenuSection[];
    if (part === 'more') sections = all.filter((s) => ['organise', 'link', 'other', 'danger'].includes(s.id));
    else {
      const s = all.find((x) => x.id === part);
      if (!s) return toast('info', text('You cannot change that on these tickets.'));
      sections = s.items.length === 1 && s.items[0]!.submenu ? s.items[0]!.submenu : [s];
    }
    // "Priority for 3 tickets", "Status for CFX-001284": what the menu changes, and on which.
    const what = ids.length > 1 ? ticketCount(ids.length) : (byId(ids)[0]?.reference ?? ticketCount(1));
    const name = { status: text('Status for {what}', { what }), priority: text('Priority for {what}', { what }), assign: text('Assign {what}', { what }), more: text('More actions for {what}', { what }) }[part];
    setMenu({ x, y, sections, label: name });
  };

  const close = () => setDialog(null);
  const dialogs: ReactNode = (
    <>
      {menu ? <ContextMenu x={menu.x} y={menu.y} sections={menu.sections} label={menu.label} width={280} onClose={() => setMenu(null)} /> : null}
      {dialog?.kind === 'assign' ? (
        <AssignDialog
          tickets={byId(dialog.ids)}
          meta={ctx.meta}
          onClose={close}
          onPick={(to) => {
            close();
            if (to.kind === 'person') apply('assign', dialog.ids, { user_id: to.id, assignee_name: to.name });
            else apply('assign', dialog.ids, { user_id: null, team_id: to.id });
          }}
        />
      ) : null}
      {dialog?.kind === 'tag' ? (
        <TagDialog
          count={dialog.ids.length}
          meta={ctx.meta}
          onClose={close}
          onSave={(tags) => {
            close();
            apply('tag', dialog.ids, { tags });
          }}
        />
      ) : null}
      {dialog?.kind === 'snooze' ? (
        <SnoozeDialog
          onClose={close}
          onSave={(until) => {
            close();
            apply('snooze', dialog.ids, { until });
          }}
        />
      ) : null}
      {dialog?.kind === 'merge' ? (
        <MergeDialog
          tickets={byId(dialog.ids)}
          onClose={close}
          onMerge={(primary, others, notify) => {
            close();
            void run('merge', [primary, ...others], { primary_id: primary, notify });
          }}
        />
      ) : null}
      {dialog?.kind === 'link' ? <LinkDialog ticket={byId([dialog.id])[0] ?? null} ticketId={dialog.id} onClose={close} onDone={() => refresh([dialog.id])} /> : null}
      {dialog?.kind === 'delete' ? (
        <Modal
          title={dialog.ids.length > 1 ? text('Delete {count}?', { count: ticketCount(dialog.ids.length) }) : text('Delete this ticket?')}
          labelledBy="support-delete-title"
          width={420}
          onClose={close}
          footer={
            <>
              <Button onClick={close}>{text('Cancel')}</Button>
              <Button
                variant="danger"
                autoFocus
                onClick={() => {
                  close();
                  apply('delete', dialog.ids);
                }}
              >
                {text('Delete')}
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">{text('They go to the trash with their conversation and files. Undo brings them back, and so does Restore in the Trash view.')}</p>
        </Modal>
      ) : null}
      {dialog?.kind === 'notify' ? (
        <Modal
          title={text('Send {status} notifications to {count}?', { status: text(statusWord(dialog.status)).toLowerCase(), count: dialog.count === 1 ? text('1 customer') : text('{n} customers', { n: dialog.count }) })}
          labelledBy="support-notify-title"
          width={460}
          onClose={close}
          footer={
            <>
              <Button onClick={close}>{text('Cancel')}</Button>
              <Button
                onClick={() => {
                  close();
                  void run('status', dialog.ids, { status: dialog.status, notify: false });
                }}
              >
                {text('Change quietly')}
              </Button>
              <Button
                variant="primary"
                autoFocus
                onClick={() => {
                  close();
                  void run('status', dialog.ids, { status: dialog.status, notify: true });
                }}
              >
                {text('Send')}
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">
            {text('Marking {count} {status} tells their customers by email (the survey and any automatic replies). Change quietly makes the change without writing to anybody.', {
              count: ticketCount(dialog.ids.length),
              status: text(statusWord(dialog.status)),
            })}
          </p>
        </Modal>
      ) : null}
    </>
  );

  return { apply, run, openMenu, openPart, sectionsFor, progress, dialogs, assignTo: (ids: number[]) => setDialog({ kind: 'assign', ids }), remove: (ids: number[]) => setDialog({ kind: 'delete', ids }), addTag: (ids: number[]) => setDialog({ kind: 'tag', ids }), snoozePick: (ids: number[]) => setDialog({ kind: 'snooze', ids }), merge: (ids: number[]) => setDialog({ kind: 'merge', ids }) };
}

/* ── the dialogs ────────────────────────────────────────────────────────── */

/** Assign to… — people (with their presence and load) and teams, searched together. */
function AssignDialog({ tickets, meta, onPick, onClose }: { tickets: Ticket[]; meta: Meta | undefined; onPick: (to: { kind: 'person' | 'team'; id: number; name: string }) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const orgs = [...new Set(tickets.map((t) => t.organization?.id ?? null))];
  const org = orgs.length === 1 ? orgs[0]! : null;
  const people = useQuery({ queryKey: K.agents(`org:${org ?? 'any'}`), queryFn: () => agents({ organization: org }), staleTime: 60_000 });
  const term = q.trim().toLowerCase();
  const persons = (people.data ?? []).filter((p) => !term || p.name.toLowerCase().includes(term));
  const teams = (meta?.teams ?? []).filter((t) => (t.organization_id === null || orgs.includes(t.organization_id)) && (!term || t.name.toLowerCase().includes(term)));
  const row = 'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-ink hover:bg-subtle focus:bg-subtle focus:outline-none';
  return (
    <Modal title={tickets.length > 1 ? text('Assign {count} to…', { count: ticketCount(tickets.length) }) : text('Assign to…')} labelledBy="support-assign-title" width={420} onClose={onClose}>
      <TextField autoFocus type="search" aria-label={text('Search people and teams')} placeholder={text('Search people and teams…')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 max-h-[340px] overflow-y-auto scroll-thin">
        {people.isLoading ? <Spinner /> : null}
        {persons.length ? <h3 className="px-2 pt-2 pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{text('People')}</h3> : null}
        {persons.map((p) => (
          <button key={`p${p.id}`} type="button" className={row} onClick={() => onPick({ kind: 'person', id: p.id, name: p.name })}>
            <Icon name="user" size={14} className="text-ink-3" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-[11.5px] text-ink-3">{[presenceLabel(p.presence), p.capacity ? text('{open}/{capacity} open', { open: p.open, capacity: p.capacity }) : text('{open} open', { open: p.open })].join(' · ')}</span>
          </button>
        ))}
        {teams.length ? <h3 className="px-2 pt-2 pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{text('Teams')}</h3> : null}
        {teams.map((t) => (
          <button key={`t${t.id}`} type="button" className={row} onClick={() => onPick({ kind: 'team', id: t.id, name: t.name })}>
            <Icon name="users" size={14} className="text-ink-3" />
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
          </button>
        ))}
        {!people.isLoading && !persons.length && !teams.length ? <p className="p-3 text-center text-[12.5px] text-ink-3">{text('Nobody matches.')}</p> : null}
      </div>
    </Modal>
  );
}

function TagDialog({ count, meta, onSave, onClose }: { count: number; meta: Meta | undefined; onSave: (tags: string[]) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const tags = value
    .split(',')
    .map((x) => x.trim().toLowerCase().slice(0, 40))
    .filter(Boolean);
  const known = [...new Set((meta?.tags ?? []).map((t) => t.name))].slice(0, 200);
  return (
    <Modal
      title={count > 1 ? text('Tag {count}', { count: ticketCount(count) }) : text('Add tag')}
      labelledBy="support-tag-title"
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" disabled={!tags.length} onClick={() => onSave(tags)}>
            {text('Add')}
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        label={text('Tags')}
        hint={text('Separate several with commas.')}
        list="support-bulk-tags"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && tags.length) {
            e.preventDefault();
            onSave(tags);
          }
        }}
      />
      <datalist id="support-bulk-tags">
        {known.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </Modal>
  );
}

/** Snooze until a day and time of my choosing (the quick choices are in the menu). */
function SnoozeDialog({ onSave, onClose }: { onSave: (until: string) => void; onClose: () => void }) {
  const now = useNow(30_000).getTime();
  const today = todayInZone();
  const [day, setDay] = useState(today);
  const [time, setTime] = useState('08:00');
  const [h = '0', m = '0'] = time.split(':');
  const at = wallToUtc(day, Number(h) * 60 + Number(m));
  const past = Date.parse(at) <= now;
  return (
    <Modal
      title={text('Snooze until')}
      labelledBy="support-snooze-title"
      width={380}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" disabled={past} onClick={() => onSave(at)}>
            {text('Snooze')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField type="date" label={text('Day')} value={day} min={today} onChange={(e) => setDay(e.target.value)} />
        <TextField type="time" label={text('Time')} value={time} onChange={(e) => setTime(e.target.value)} error={past ? text('Choose a time still to come.') : null} />
        <p className="text-[12px] text-ink-3">{text('It leaves your working views until then, and comes back at once if the customer writes.')}</p>
      </div>
    </Modal>
  );
}

/**
 * Merge: with two or more picked, choose the main ticket and the others go into it with every message and file; with
 * one, find the ticket it goes into. Their requesters can be told (optional).
 */
function MergeDialog({ tickets, onMerge, onClose }: { tickets: Ticket[]; onMerge: (primary: number, others: number[], notify: boolean) => void; onClose: () => void }) {
  const single = tickets.length === 1 ? tickets[0]! : null;
  const [q, setQ] = useState('');
  const found = useQuery({ queryKey: ['support', 'merge-search', q.trim()], queryFn: ({ signal }) => listTickets({ view: 'all', q: q.trim(), limit: 8 }, signal), enabled: !!single && q.trim().length >= 2 });
  const candidates = single ? (found.data?.items ?? []).filter((t) => t.id !== single.id && !t.deleted_at) : tickets;
  const [primary, setPrimary] = useState<number | null>(single ? null : (tickets[0]?.id ?? null));
  const [notify, setNotify] = useState(false);
  const others = single ? [single.id] : tickets.map((t) => t.id).filter((id) => id !== primary);
  return (
    <Modal
      title={single ? text('Merge {ref} into…', { ref: single.reference }) : text('Merge {count}', { count: ticketCount(tickets.length) })}
      labelledBy="support-merge-title"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" disabled={primary === null || !others.length} onClick={() => primary !== null && onMerge(primary, others, notify)}>
            {text('Merge')}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-[13px] text-ink-2">{single ? text('Find the ticket it goes into. Its messages and files move there, and it becomes read-only.') : text('Choose the main ticket. The others are merged into it, keeping all their messages and files.')}</p>
      {single ? <TextField autoFocus type="search" aria-label={text('Find a ticket')} placeholder={text('Reference or subject…')} value={q} onChange={(e) => setQ(e.target.value)} /> : null}
      <div role="radiogroup" aria-label={text('Main ticket')} className="mt-2 flex max-h-[280px] flex-col gap-1 overflow-y-auto scroll-thin">
        {found.isFetching ? <Spinner /> : null}
        {candidates.map((t) => (
          <label key={t.id} className={cx('flex cursor-pointer items-center gap-2 rounded-[8px] border px-2.5 py-2 text-[13px]', primary === t.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
            <input type="radio" name="support-merge-primary" checked={primary === t.id} onChange={() => setPrimary(t.id)} />
            <span className="font-mono text-[12px] text-ink-2">{t.reference}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{t.subject}</span>
          </label>
        ))}
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px] text-ink">
        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5" />
        <span>
          {text('Tell their requesters')}
          <span className="block text-[12px] text-ink-3">{text('A reply on each ticket merged away says where the conversation continues.')}</span>
        </span>
      </label>
    </Modal>
  );
}

/** Link to… a contact, a company, an order, a tender, a task — any record Drive's record search finds. */
function LinkDialog({ ticket, ticketId, onClose, onDone }: { ticket: Ticket | null; ticketId: number; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const hits = useQuery({
    queryKey: ['support', 'link-search', term],
    queryFn: ({ signal }) => apiGet<{ groups: Array<{ type: string; label: string; records: Array<{ id: number; title: string; detail: string | null }> }> }>('/api/drive/records/search', { q: term }, signal),
    enabled: term.length >= 2,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const link = async (kind: string, id: number, title: string) => {
    setBusy(`${kind}:${id}`);
    try {
      await addLink(ticketId, kind, id);
      toast('success', text('Linked to {what}.', { what: title }));
      onDone();
      onClose();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const groups = useMemo(() => (hits.data?.groups ?? []).filter((g) => g.records?.length), [hits.data]);
  return (
    <Modal title={ticket ? text('Link {ref} to…', { ref: ticket.reference }) : text('Link to…')} labelledBy="support-link-title" width={460} onClose={onClose}>
      <TextField autoFocus type="search" aria-label={text('Search records')} placeholder={text('Contact, company, order, tender, task…')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 max-h-[320px] overflow-y-auto scroll-thin">
        {hits.isFetching ? <Spinner /> : null}
        {groups.map((g) => (
          <div key={g.type}>
            <h3 className="px-2 pt-2 pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{g.label}</h3>
            {g.records.slice(0, 6).map((r) => (
              <button key={r.id} type="button" disabled={busy !== null} onClick={() => void link(g.type, r.id, r.title)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] hover:bg-subtle">
                <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
                {r.detail ? <span className="shrink-0 truncate text-[11.5px] text-ink-3">{r.detail}</span> : null}
              </button>
            ))}
          </div>
        ))}
        {term.length >= 2 && !hits.isFetching && !groups.length ? <p className="p-3 text-center text-[12.5px] text-ink-3">{text('Nothing matches.')}</p> : null}
      </div>
    </Modal>
  );
}

/** The list's keys (the `?` popover). */
export const LIST_KEYS: Array<{ keys: string[]; what: string }> = [
  { keys: ['J', 'K'], what: 'Move down and up the list' },
  { keys: ['X'], what: 'Select the ticket' },
  { keys: ['⇧X'], what: 'Select the range from the last one picked' },
  { keys: [isMac ? '⌘A' : 'Ctrl+A'], what: 'Select every ticket in the view' },
  { keys: [isMac ? '⌘-click' : 'Ctrl+click', '⇧-click'], what: 'Toggle a ticket, or pick a range' },
  { keys: ['E'], what: 'Solve' },
  { keys: ['A'], what: 'Assign' },
  { keys: ['P'], what: 'Priority' },
  { keys: ['#'], what: 'Delete (asks first)' },
  { keys: ['Esc'], what: 'Clear the selection' },
  { keys: ['↵', 'O'], what: 'Open in a tab' },
  { keys: ['R', 'N'], what: 'Reply, or add an internal note' },
  { keys: ['/'], what: 'Search' },
  { keys: ['C'], what: 'New ticket' },
  { keys: [isMac ? '⌘⇧I' : 'Ctrl+Shift+I'], what: 'Show or hide the ticket details' },
  { keys: ['?'], what: 'These shortcuts' },
];

export function ShortcutsPopover({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={text('Keyboard shortcuts')} labelledBy="support-keys-title" width={440} onClose={onClose} footer={<Button onClick={onClose}>{text('Done')}</Button>}>
      <ul role="list" className="divide-y divide-line text-[13px]">
        {LIST_KEYS.map((k) => (
          <li key={k.what} className="flex items-center gap-3 py-1.5">
            <span className="min-w-0 flex-1 text-ink">{text(k.what)}</span>
            {k.keys.map((x) => (
              <Kbd key={x}>{x}</Kbd>
            ))}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
