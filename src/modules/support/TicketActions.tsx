import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { PRIORITIES, PRIORITY_LABEL, statusLabel, type Meta, type SupportPriority, type SupportStatus, type Ticket } from '@shared/support';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { ContextMenu } from '../../components/ContextMenu';
import type { MenuItem, MenuSection } from '../../components/Menu';
import { Button, Modal } from '../../components/ui';
import { BULK_MAX, K, agents, bulkTickets, errorText, transitionQuietly, type BulkAction, type BulkAnswer, type BulkInput } from './api';
import { actionWords, anyCan, bulkSummary, capsFor, joinAnswers, mayEmailRequesters, shared, statusChoices, tagKey, ticketCount, undoInputs } from './bulk';
import { copyTicketLink } from './palette';

/**
 * What can be done to tickets from the inbox's list (#333): the right-click menu on a row (or on the rows picked), the
 * bulk bar's menus, and the list's keys all come here, so each offers the same things in the same words.
 *
 *  - The menu: Open, Open in a new tab; Status ▸, Assign ▸, Priority ▸, Organise ▸ (tags), each with the tickets'
 *    own value ticked; Reply and Add note (the ticket opens at its composer); Merge (two or more); Copy reference and
 *    Copy link; Delete (or Restore, in the bin). Only what the person may do is listed (bulk.ts `capsFor`): a ticket's
 *    organization's permissions, or — for several — anything at least one of them allows, the server refusing the rest.
 *    Snooze, spam and linking are not offered: the desk's API has none of them.
 *  - Every change is one `POST tickets/bulk` with the versions the list showed; the toast says what was done and what
 *    was refused and why ("Moved to Open · 3 of 5 done — 2 refused: …"), and offers Undo where the change can be put
 *    back (status, assignee, priority, tags, delete) — another bulk call restoring what each ticket had.
 *  - Asked first: Resolve or Close (the requesters may be sent the satisfaction survey; "Don't send the survey" resolves
 *    ticket by ticket with `csat: false`, which the bulk endpoint cannot be told), Delete, and Merge (choosing the ticket
 *    the others go into). One ticket to Resolved opens the Resolve dialog instead, with its summary.
 */
export type MenuOnly = 'status' | 'assign' | 'priority' | 'tags';

interface MenuState {
  targets: Ticket[];
  x: number;
  y: number;
  /** One part of the menu on its own: the bulk bar's buttons, and P and # in the list. */
  only?: MenuOnly;
}

interface Ask {
  input: BulkInput;
  targets: Ticket[];
  what: string;
}

export interface TicketActionsOptions {
  meta: Meta | undefined;
  me: number | null;
  /** Read it in the reading pane. */
  onOpen: (t: Ticket) => void;
  /** Its own tab; none where the screen has no tabs. */
  onOpenTab?: ((t: Ticket) => void) | null;
  /** Open it at its composer: a reply or a note. */
  onRespond: (t: Ticket, mode: 'reply' | 'note') => void;
  /** One ticket to Resolved: the Resolve dialog. Without it, it goes the bulk way like the rest. */
  onResolveOne?: ((t: Ticket) => void) | null;
  /** After a change was done to some tickets (a delete or a merge takes them out of the selection). */
  onChanged?: (action: BulkAction, answer: BulkAnswer) => void;
}

export function useTicketActions(o: TicketActionsOptions) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [asking, setAsking] = useState<Ask | null>(null);
  const [tagQuery, setTagQuery] = useState('');

  // The people to give the tickets to: their organization's, asked when a menu with Assign opens.
  const orgIds = menu ? [...new Set(menu.targets.map((t) => t.organization?.id ?? null))] : [];
  const org = orgIds.length === 1 ? (orgIds[0] ?? null) : null;
  const wantPeople = !!menu && (!menu.only || menu.only === 'assign') && anyCan(o.meta, menu.targets, 'assign');
  const people = useQuery({ queryKey: K.agents(`org:${org ?? ''}`), queryFn: () => agents({ organization: org }), enabled: wantPeople, staleTime: 60_000 });

  const refOf = (ts: readonly Ticket[]) => {
    const refs = new Map(ts.map((t) => [t.id, t.reference]));
    return (id: number) => refs.get(id) ?? `#${id}`;
  };
  const refresh = (ids: readonly number[]) => {
    void qc.invalidateQueries({ queryKey: K.lists });
    void qc.invalidateQueries({ queryKey: ['support', 'views'] });
    void qc.invalidateQueries({ queryKey: K.badges });
    for (const id of ids) void qc.invalidateQueries({ queryKey: K.ticket(id) });
  };

  const undo = async (inputs: BulkInput[], targets: Ticket[]) => {
    const answers: BulkAnswer[] = [];
    try {
      for (const i of inputs) answers.push(await bulkTickets(i));
    } catch (e) {
      toast('error', errorText(e));
      return;
    } finally {
      refresh(inputs.flatMap((i) => i.ids));
    }
    const s = bulkSummary(joinAnswers(answers), text('Undone'), refOf(targets));
    toast(s.kind, s.text, undefined, s.kind === 'success' ? undefined : 12_000, { key: 'support-bulk' });
  };

  const send = async (input: BulkInput, targets: Ticket[], what: string, quiet = false): Promise<BulkAnswer | null> => {
    let answer: BulkAnswer;
    try {
      answer = quiet && input.action === 'status' && (input.status === 'resolved' || input.status === 'closed') ? await transitionQuietly(input.ids, input.status, input.versions) : await bulkTickets(input);
    } catch (e) {
      toast('error', errorText(e));
      return null;
    } finally {
      refresh(input.ids);
    }
    const s = bulkSummary(answer, what, refOf(targets));
    const back = undoInputs(input, targets, answer);
    toast(s.kind, s.text, back.length ? { label: text('Undo'), run: () => void undo(back, targets) } : undefined, s.kind === 'success' ? 8_000 : 12_000, { key: 'support-bulk' });
    if (answer.done) o.onChanged?.(input.action, answer);
    return answer;
  };

  /** A change to the tickets: asked first where it must be, then sent. */
  const run = (all: readonly Ticket[], fields: Omit<BulkInput, 'ids' | 'versions'>, extra: { assignee?: string | null } = {}) => {
    if (!all.length) return;
    if (all.length > BULK_MAX) toast('info', text('Only the first {count} tickets are changed at a time.', { count: BULK_MAX }));
    const targets = all.slice(0, BULK_MAX);
    const versioned = fields.action !== 'merge' && fields.action !== 'restore';
    const input: BulkInput = {
      ...fields,
      ids: targets.map((t) => t.id),
      ...(versioned ? { versions: Object.fromEntries(targets.filter((t) => t.version > 0).map((t) => [t.id, t.version])) } : {}),
    };
    const what = actionWords(input, extra);
    const one = targets.length === 1 ? targets[0]! : null;
    if (one && input.action === 'status' && input.status === 'resolved' && o.onResolveOne) return o.onResolveOne(one);
    if (mayEmailRequesters(input) || input.action === 'delete' || input.action === 'merge') return setAsking({ input, targets, what });
    void send(input, targets, what);
  };

  const assignToMe = (ts: readonly Ticket[]) => {
    if (o.me) run(ts, { action: 'assign', user_id: o.me }, { assignee: text('you') });
  };
  const setStatus = (ts: readonly Ticket[], status: SupportStatus) => run(ts, { action: 'status', status });
  const setPriority = (ts: readonly Ticket[], priority: SupportPriority) => run(ts, { action: 'priority', priority });
  const toggleTag = (ts: readonly Ticket[], name: string, on: boolean) => run(ts, { action: on ? 'tag' : 'untag', tags: [tagKey(name)] });
  const merge = (ts: readonly Ticket[]) => run(ts, { action: 'merge', primary_id: ts[0]?.id });

  /** What may be done to these tickets: the checks the menu, the bar and the keys share. */
  const can = (ts: readonly Ticket[]) => {
    const live = ts.filter((t) => !t.deleted_at);
    return {
      status: live.length ? statusChoices(o.meta, live) : [],
      assign: live.length > 0 && anyCan(o.meta, live, 'assign'),
      // Taking an unassigned ticket needs only Reply.
      take: !!o.me && live.length > 0 && live.every((t) => !t.assignee) && anyCan(o.meta, live, 'reply'),
      edit: live.length > 0 && anyCan(o.meta, live, 'edit'),
      merge: live.length > 1 && live.length === ts.length && anyCan(o.meta, live, 'merge'),
      delete: live.length > 0 && anyCan(o.meta, live, 'delete'),
      restore: live.length === 0 && ts.length > 0 && anyCan(o.meta, ts, 'delete'),
    };
  };

  const sections = (m: MenuState): MenuSection[] => {
    const ts = m.targets;
    const one = ts.length === 1 ? ts[0]! : null;
    const may = can(ts);
    const status = shared(ts, (t) => t.status);
    const assignee = shared(ts, (t) => t.assignee?.id ?? null);
    const priority = shared(ts, (t) => t.priority);

    const statusItems: MenuItem[] = may.status.map((s) => ({
      id: `status-${s}`,
      label: text(statusLabel(s)),
      radio: true,
      checked: status === s,
      shortcut: s === 'resolved' ? 'E' : undefined,
      onSelect: () => (status === s ? undefined : setStatus(ts, s)),
    }));
    const assignItems: MenuItem[] = [];
    if ((may.assign || may.take) && o.me) {
      assignItems.push({ id: 'assign-me', label: text('Me'), icon: 'user', radio: true, checked: assignee === o.me, shortcut: 'A', onSelect: () => (assignee === o.me ? undefined : assignToMe(ts)) });
    }
    if (may.assign) {
      if (people.isLoading) assignItems.push({ id: 'assign-loading', label: text('Loading people…'), disabled: true });
      for (const a of people.data ?? []) {
        if (a.id === o.me) continue;
        assignItems.push({ id: `assign-${a.id}`, label: a.name, radio: true, checked: assignee === a.id, onSelect: () => (assignee === a.id ? undefined : run(ts, { action: 'assign', user_id: a.id }, { assignee: a.name })) });
      }
      assignItems.push({ id: 'assign-none', label: text('Unassigned'), radio: true, checked: ts.every((t) => !t.assignee), onSelect: () => (ts.every((t) => !t.assignee) ? undefined : run(ts, { action: 'assign', user_id: null })) });
    }
    const priorities = (o.meta?.priorities?.length ? o.meta.priorities : [...PRIORITIES]).filter((p): p is SupportPriority => (PRIORITIES as readonly string[]).includes(p));
    const priorityItems: MenuItem[] = may.edit ? priorities.map((p) => ({ id: `priority-${p}`, label: text(PRIORITY_LABEL[p]), radio: true, checked: priority === p, onSelect: () => (priority === p ? undefined : setPriority(ts, p)) })) : [];

    // Tags: the desk's for these tickets' organizations, and whatever they carry already; ticked when all carry it.
    const orgs = new Set(ts.map((t) => t.organization?.id ?? null));
    const known = [...new Set([...(o.meta?.tags ?? []).filter((x) => x.organization_id === null || orgs.has(x.organization_id)).map((x) => tagKey(x.name)), ...ts.flatMap((t) => t.tags.map(tagKey))])].filter(Boolean).sort();
    const q = tagKey(tagQuery);
    const tagItems: MenuItem[] = may.edit
      ? known
          .filter((name) => !q || name.includes(q))
          .map((name) => {
            const all = ts.every((t) => t.tags.map(tagKey).includes(name));
            return { id: `tag-${name}`, label: name, checked: all, onSelect: () => toggleTag(ts, name, !all) };
          })
      : [];
    if (may.edit && m.only === 'tags' && q && !known.includes(q)) tagItems.unshift({ id: 'tag-new', label: text('Add tag “{name}”', { name: q }), icon: 'plus', onSelect: () => toggleTag(ts, q, true) });

    if (m.only === 'status') return [{ id: 'status', items: statusItems }];
    if (m.only === 'assign') return [{ id: 'assign', items: assignItems }];
    if (m.only === 'priority') return [{ id: 'priority', items: priorityItems }];
    if (m.only === 'tags') return [{ id: 'tags', items: tagItems }];

    const open: MenuItem[] = one
      ? [
          { id: 'open', label: text('Open'), icon: 'eye', onSelect: () => o.onOpen(one) },
          ...(o.onOpenTab ? [{ id: 'open-tab', label: text('Open in a new tab'), icon: 'external', shortcut: 'Enter', onSelect: () => o.onOpenTab?.(one) }] : []),
        ]
      : [];
    const change: MenuItem[] = [];
    if (statusItems.length) change.push({ id: 'status', label: text('Status'), icon: 'circle-dot', submenu: [{ id: 'status', items: statusItems }] });
    if (assignItems.length) change.push({ id: 'assign', label: text('Assign'), icon: 'user', submenu: [{ id: 'assign', items: assignItems }] });
    if (priorityItems.length) change.push({ id: 'priority', label: text('Priority'), icon: 'flag', shortcut: 'P', submenu: [{ id: 'priority', items: priorityItems }] });
    if (tagItems.length) change.push({ id: 'organise', label: text('Organise'), icon: 'tag', submenu: [{ id: 'tags', label: text('Tags'), items: tagItems }] });
    const caps = one ? capsFor(o.meta, one) : {};
    const respond: MenuItem[] =
      one && !one.deleted_at
        ? [
            ...(caps.reply === true ? [{ id: 'reply', label: text('Reply'), icon: 'reply', shortcut: 'R', onSelect: () => o.onRespond(one, 'reply') }] : []),
            ...(caps.notes === true ? [{ id: 'note', label: text('Add internal note'), icon: 'pen', shortcut: 'N', onSelect: () => o.onRespond(one, 'note') }] : []),
          ]
        : [];
    const link: MenuItem[] = may.merge ? [{ id: 'merge', label: text('Merge {count} tickets…', { count: ts.length }), icon: 'merge', onSelect: () => merge(ts) }] : [];
    const copy: MenuItem[] = one
      ? [
          { id: 'copy-ref', label: text('Copy reference'), icon: 'copy', onSelect: () => void copyText(one.reference) },
          { id: 'copy-link', label: text('Copy link'), icon: 'link', onSelect: () => copyTicketLink(one.id, one.reference) },
        ]
      : [];
    const danger: MenuItem[] = may.delete
      ? [{ id: 'delete', label: one ? text('Delete…') : text('Delete {count} tickets…', { count: ts.length }), icon: 'trash', danger: true, onSelect: () => run(ts, { action: 'delete' }) }]
      : may.restore
        ? [{ id: 'restore', label: text('Restore'), icon: 'undo', onSelect: () => run(ts, { action: 'restore' }) }]
        : [];
    return [
      { id: 'open', items: open },
      { id: 'change', items: change },
      { id: 'respond', items: respond },
      { id: 'link', items: link },
      { id: 'copy', items: copy },
      { id: 'danger', items: danger },
    ];
  };

  const openMenu = (targets: readonly Ticket[], x: number, y: number, only?: MenuOnly) => {
    setTagQuery('');
    setMenu({ targets: [...targets], x, y, only });
  };

  const menuLabel = (m: MenuState) => {
    const many = m.targets.length > 1 ? ticketCount(m.targets.length) : (m.targets[0]?.reference ?? '');
    switch (m.only) {
      case 'status':
        return text('Status for {what}', { what: many });
      case 'assign':
        return text('Assign {what}', { what: many });
      case 'priority':
        return text('Priority for {what}', { what: many });
      case 'tags':
        return text('Tags for {what}', { what: many });
      default:
        return text('Actions for {what}', { what: many });
    }
  };

  const elements: ReactNode = (
    <>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menuLabel(menu)}
          sections={sections(menu)}
          search={menu.only === 'tags' ? { value: tagQuery, onChange: setTagQuery, label: text('Find or add a tag'), placeholder: text('Find or add a tag…') } : undefined}
          empty={menu.only === 'tags' ? text('No tags') : text('Nothing you may do here')}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {asking ? (
        <ConfirmBulk
          ask={asking}
          onClose={() => setAsking(null)}
          onYes={(input, quiet) => {
            setAsking(null);
            const primary = input.action === 'merge' ? asking.targets.find((t) => t.id === input.primary_id)?.reference : null;
            void send(input, asking.targets, primary ? actionWords(input, { primary }) : asking.what, quiet);
          }}
        />
      ) : null}
    </>
  );

  return { openMenu, closeMenu: () => setMenu(null), menuOpen: menu !== null, run, can, assignToMe, setStatus, setPriority, elements };
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast('success', text('Copied {value}', { value }));
  } catch {
    toast('error', text('Could not copy {value}.', { value }));
  }
}

/** Resolve, Close, Delete or Merge, asked before it is done. */
function ConfirmBulk({ ask, onClose, onYes }: { ask: Ask; onClose: () => void; onYes: (input: BulkInput, quiet: boolean) => void }) {
  const { input, targets } = ask;
  const [quiet, setQuiet] = useState(false);
  const [primary, setPrimary] = useState<number>(input.primary_id ?? targets[0]?.id ?? 0);
  const n = targets.length;
  const many = ticketCount(n);
  let title: string;
  let action: string;
  let body: ReactNode;
  if (input.action === 'merge') {
    title = text('Merge {what}', { what: many });
    action = text('Merge');
    body = (
      <>
        <p className="mb-3 text-[13px] text-ink-2">{text('Choose the ticket the others go into. They are closed, and their conversations and requesters move to it. This cannot be undone from here.')}</p>
        <div role="radiogroup" aria-label={text('Merge into')} className="flex max-h-[240px] flex-col gap-1 overflow-y-auto">
          {targets.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] hover:bg-subtle">
              <input type="radio" name="support-merge-primary" checked={primary === t.id} onChange={() => setPrimary(t.id)} />
              <span className="shrink-0 font-mono text-[12px] text-ink-3">{t.reference}</span>
              <span className="truncate text-ink">{t.subject}</span>
            </label>
          ))}
        </div>
      </>
    );
  } else if (input.action === 'delete') {
    title = n === 1 ? text('Delete {ref}?', { ref: targets[0]!.reference }) : text('Delete {what}?', { what: many });
    action = text('Delete');
    body = <p className="text-[13px] text-ink-2">{text('They go to the bin, where whoever may delete tickets can restore them.')}</p>;
  } else {
    const closing = input.status === 'closed';
    title = closing ? text('Close {what}?', { what: many }) : text('Resolve {what}?', { what: many });
    action = closing ? text('Close') : text('Resolve');
    body = (
      <>
        <p className="mb-3 text-[13px] text-ink-2">{text('Each requester may be emailed a satisfaction survey about their ticket, and the desk’s automations may write to them too.')}</p>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Checkbox checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
          {text('Don’t send the satisfaction survey')}
        </label>
      </>
    );
  }
  return (
    <Modal
      title={title}
      labelledBy="support-bulk-confirm-title"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant={input.action === 'delete' ? 'danger' : 'primary'} autoFocus onClick={() => onYes(input.action === 'merge' ? { ...input, primary_id: primary } : input, quiet)}>
            {action}
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
