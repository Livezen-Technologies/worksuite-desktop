import {
  PRIORITIES,
  PRIORITY_LABEL,
  TRANSITIONS,
  capForMove,
  isStatus,
  type BulkAction,
  type BulkResult,
  type Caps,
  type Meta,
  type SupportPriority,
  type SupportStatus,
  type Ticket,
} from '@shared/support';
import type { ReactNode } from 'react';
import { text } from '../../core/i18n';
import type { MenuItem, MenuSection } from '../../components/Menu';
import { snoozeChoices } from '../mail/states';
import { bulk } from './api';

/**
 * The ticket list's right-click menu and bulk bar (worksuite-desktop#333): one source for the menu on a row, the menu
 * on a selection, the bulk bar and the keyboard, so all of them offer the same actions with the same words.
 *
 * - The menu is grouped Open · Status · Assign · Priority · Organise · Link · Respond · Other · Danger. What the person
 *   may not do on every ticket picked is left out, not greyed (the desk's caps per organization, `GET meta`); the
 *   current status, priority, assignee and Follow are ticked.
 * - A change goes to `POST tickets/bulk` — one ticket or a hundred, the same call. More than `BATCH` tickets go in
 *   batches with progress, and the list stays usable meanwhile.
 * - Undo puts back what each ticket was (`before` in the server's answer), grouped into as few calls as it takes.
 *   A status goes back as far as the state machine allows: New is only ever the start, so a ticket that was New
 *   comes back Open.
 */

/** Above this many tickets a change runs in the background, in batches of this size. */
export const BATCH = 50;

/** The menu's status words (the issue's): the desk's statuses, in the order an agent reaches for them. */
export const MENU_STATUSES: Array<{ status: SupportStatus; label: string }> = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'pending_customer', label: 'Pending (waiting on customer)' },
  { status: 'pending_internal', label: 'On hold' },
  { status: 'escalated', label: 'Escalated' },
  { status: 'resolved', label: 'Solved' },
  { status: 'closed', label: 'Closed' },
];

/** What the toasts say a status became ("3 tickets marked Solved"). */
export function statusWord(status: SupportStatus): string {
  return MENU_STATUSES.find((s) => s.status === status)?.label ?? status;
}

/** The priority's coloured dot in the menu. */
export const PRIORITY_DOT: Record<SupportPriority, string> = {
  low: 'bg-muted',
  normal: 'bg-blue',
  high: 'bg-amber-strong',
  urgent: 'bg-red',
};

/** "1 ticket", "3 tickets": the list's count and the toasts; `more`: there are more than these ("50+ tickets"). */
export function ticketCount(n: number, more = false): string {
  if (more) return text('{n}+ tickets', { n });
  return n === 1 ? text('1 ticket') : text('{n} tickets', { n });
}

/** A heading with its count: "Resolved · 1 ticket", "Open · 12 tickets" — the title alone while the count is unknown. */
export function countTitle(title: string, count: number | null, more = false): string {
  return count === null ? title : `${title} · ${ticketCount(count, more)}`;
}

/** Split ids into batches of `size`. */
export function batches<T>(ids: readonly T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export interface BulkProgress {
  done: number;
  total: number;
  refused: number;
}

/**
 * A bulk change of any size: in batches of `BATCH` (each a call), telling `onProgress` after each. A batch that fails
 * outright (offline, a 500) counts its tickets as refused with the reason, and the rest carry on.
 */
export async function bulkInBatches(
  action: BulkAction,
  ids: number[],
  fields: Record<string, unknown>,
  onProgress?: (p: BulkProgress) => void,
  send: typeof bulk = bulk,
): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  const parts = batches(ids);
  for (const part of parts) {
    try {
      // Each batch carries the versions of its own tickets only.
      const versions = fields.versions as Record<number, number> | undefined;
      const own = versions ? { ...fields, versions: Object.fromEntries(part.filter((id) => versions[id] !== undefined).map((id) => [id, versions[id]!])) } : fields;
      const r = await send(action, part, own, ids.length);
      out.push(...r.results);
    } catch (e) {
      // A merge is one call; anything else, one batch's refusal.
      if (parts.length === 1) throw e;
      const message = e instanceof Error ? e.message : text('That could not be done. Try again.');
      out.push(...part.map((id) => ({ id, ok: false, code: 'FAILED', message })));
    }
    onProgress?.({ done: out.length, total: ids.length, refused: out.filter((r) => !r.ok).length });
  }
  return out;
}

/** The caps that count for a ticket: its organization's, else what I may do anywhere at the desk. */
export function capsFor(meta: Pick<Meta, 'organizations' | 'can'> | null | undefined, t: Pick<Ticket, 'organization'>): Caps {
  const org = t.organization?.id ?? null;
  return (org !== null ? meta?.organizations?.find((o) => o.id === org)?.can : undefined) ?? meta?.can ?? {};
}

/** May I do this on every ticket picked? An older server that says nothing about caps reads as yes. */
export function mayAll(targets: readonly Pick<Ticket, 'organization'>[], meta: Meta | undefined, cap: keyof Caps): boolean {
  if (!meta || meta.legacy) return true;
  return targets.length > 0 && targets.every((t) => capsFor(meta, t)[cap] === true);
}

/** The moves the state machine allows from a status: the desk's own (`GET meta`'s `next`), else the as-built table. */
function movesFrom(meta: Pick<Meta, 'statuses'> | null | undefined, from: SupportStatus): readonly SupportStatus[] {
  return meta?.statuses?.find((s) => s.key === from)?.next ?? TRANSITIONS[from] ?? [];
}

/**
 * The statuses the menu offers: each ticket's own, and those some ticket picked may move to, as the state machine and
 * my caps allow. None at all when no ticket may be moved anywhere: then there is no Status menu.
 */
export function statusChoices(meta: Meta | null | undefined, targets: readonly Pick<Ticket, 'status' | 'organization'>[]): SupportStatus[] {
  const ok = new Set<SupportStatus>();
  let moves = 0;
  for (const t of targets) {
    ok.add(t.status);
    const caps = capsFor(meta, t);
    for (const to of movesFrom(meta, t.status)) {
      if (meta && !meta.legacy && caps[capForMove(t.status, to)] !== true) continue;
      ok.add(to);
      moves += 1;
    }
  }
  if (!moves) return [];
  return MENU_STATUSES.map((s) => s.status).filter((s) => ok.has(s));
}

/** What the bulk bar offers for the tickets picked: the menu's parts, by the same caps. */
export interface BarCaps {
  status: boolean;
  assign: boolean;
  priority: boolean;
  tag: boolean;
  merge: boolean;
  snooze: boolean;
}

export function barCaps(targets: readonly Ticket[], meta: Meta | undefined): BarCaps {
  const may = (cap: keyof Caps) => mayAll(targets, meta, cap);
  return {
    status: statusChoices(meta, targets).length > 0,
    assign: may('assign') || may('reply'),
    priority: may('edit'),
    tag: may('edit'),
    merge: targets.length > 1 && may('merge'),
    snooze: may('reply'),
  };
}

/** The one value every ticket picked has, or null when they differ — what the menu ticks. */
export function common<T>(targets: readonly Ticket[], of: (t: Ticket) => T): T | null {
  if (!targets.length) return null;
  const first = of(targets[0]!);
  return targets.every((t) => of(t) === first) ? first : null;
}

/** The customers a status change would write to (Solved and Closed send the requester a notice). */
export function notifyCount(targets: readonly Pick<Ticket, 'status' | 'requester'>[], to: SupportStatus): number {
  if (to !== 'resolved' && to !== 'closed') return 0;
  return targets.filter((t) => t.status !== to && !!t.requester?.email).length;
}

/* ── Undo ───────────────────────────────────────────────────────────────── */

export interface UndoCall {
  action: BulkAction;
  ids: number[];
  fields: Record<string, unknown>;
}

/** The status a ticket goes back to: what it was, where the machine allows the move back; else Open; else none. */
export function undoStatus(now: SupportStatus, was: SupportStatus): { status: SupportStatus; override?: boolean } | null {
  if (now === was) return null;
  if (TRANSITIONS[now].includes(was)) return { status: was };
  if (now === 'closed') return { status: 'open', override: true };
  if (TRANSITIONS[now].includes('open')) return { status: 'open' };
  return null;
}

function group(results: readonly BulkResult[], keyOf: (r: BulkResult) => string | null): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of results) {
    if (!r.ok || !r.before) continue;
    const k = keyOf(r);
    if (k === null) continue;
    out.set(k, [...(out.get(k) ?? []), r.id]);
  }
  return out;
}

/** The calls that put back what a bulk change did, from the server's `before`. Empty when nothing can be undone. */
export function undoCalls(action: BulkAction, fields: Record<string, unknown>, results: readonly BulkResult[]): UndoCall[] {
  const calls: UndoCall[] = [];
  const add = (a: BulkAction, ids: number[], f: Record<string, unknown> = {}) => ids.length && calls.push({ action: a, ids, fields: { reason: 'Undo', ...f } });
  const done = results.filter((r) => r.ok);
  switch (action) {
    case 'status': {
      const to = String(fields.status ?? '');
      if (!isStatus(to)) return [];
      for (const [k, ids] of group(done, (r) => {
        const back = undoStatus(to, r.before!.status);
        return back ? JSON.stringify(back) : null;
      }))
        add('status', ids, { ...(JSON.parse(k) as object), notify: false });
      return calls;
    }
    case 'priority':
      for (const [k, ids] of group(done, (r) => r.before!.priority)) add('priority', ids, { priority: k });
      return calls;
    case 'assign':
      // The team goes back too only when the change set one.
      for (const [k, ids] of group(done, (r) => JSON.stringify('team_id' in fields ? [r.before!.assignee_id, r.before!.team_id] : [r.before!.assignee_id]))) {
        const [user, ...team] = JSON.parse(k) as Array<number | null>;
        add('assign', ids, { user_id: user ?? null, ...(team.length ? { team_id: team[0] } : {}) });
      }
      return calls;
    case 'team':
      for (const [k, ids] of group(done, (r) => String(r.before!.team_id ?? ''))) add('team', ids, { team_id: k ? Number(k) : null });
      return calls;
    case 'tag':
    case 'untag': {
      const given = (Array.isArray(fields.tags) ? fields.tags : String(fields.tags ?? '').split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
      for (const [k, ids] of group(done, (r) => {
        const had = new Set(r.before!.tags.map((x) => x.toLowerCase()));
        const changed = given.filter((g) => (action === 'tag' ? !had.has(g) : had.has(g)));
        return changed.length ? changed.join(',') : null;
      }))
        add(action === 'tag' ? 'untag' : 'tag', ids, { tags: k.split(',') });
      return calls;
    }
    case 'snooze':
    case 'unsnooze':
      for (const [k, ids] of group(done, (r) => r.before!.snoozed_until ?? '')) {
        if (!k) add('unsnooze', ids);
        else if (Date.parse(k) > Date.now()) add('snooze', ids, { until: k });
      }
      return calls;
    case 'watch':
      add('unwatch', done.map((r) => r.id));
      return calls;
    case 'unwatch':
      add('watch', done.map((r) => r.id));
      return calls;
    case 'read':
      add('unread', done.map((r) => r.id));
      return calls;
    case 'unread':
      add('read', done.map((r) => r.id));
      return calls;
    case 'delete':
    case 'spam':
      add('restore', done.map((r) => r.id));
      return calls;
    case 'restore':
      add('delete', done.map((r) => r.id));
      return calls;
    case 'merge':
      return [];
  }
}

/**
 * One bulk call as the client plans it: the action's fields beside `ids`, and `versions` (id → the version the screen
 * showed), which refuses a ticket changed meanwhile as `VERSION_CONFLICT`, that ticket only.
 */
export interface BulkInput {
  ids: number[];
  action: BulkAction;
  user_id?: number | null;
  team_id?: number | null;
  status?: string;
  override?: boolean;
  priority?: string;
  tags?: string[];
  primary_id?: number;
  reason?: string;
  versions?: Record<number, number>;
}

/** `POST tickets/bulk`'s answer. */
export interface BulkAnswer {
  results: BulkResult[];
  done: number;
  refused: number;
}

/** A tag as the server keeps it (trimmed, lower-cased). */
export function tagKey(name: string): string {
  return name.trim().toLowerCase().slice(0, 60);
}

/** The actions `undoInputs` can take back. */
const UNDOABLE: readonly BulkAction[] = ['status', 'assign', 'priority', 'tag', 'untag', 'delete'];

/**
 * Undo for a server whose answer carries no `before`: planned from the tickets as the list showed them before the
 * change, one call per earlier value, each with the version the change left the ticket at — so a ticket changed again
 * meanwhile is refused rather than overwritten. Nothing for what cannot be taken back, or when nothing was done.
 */
export function undoInputs(input: BulkInput, before: readonly Ticket[], answer: Pick<BulkAnswer, 'results'>): BulkInput[] {
  if (!UNDOABLE.includes(input.action)) return [];
  const done = new Map(answer.results.filter((r) => r.ok).map((r) => [r.id, r.version ?? 0]));
  const tickets = before.filter((t) => done.has(t.id));
  const groups = new Map<string, { fields: Partial<BulkInput>; ids: number[] }>();
  const add = (key: string, fields: Partial<BulkInput>, id: number) => {
    const g = groups.get(key) ?? { fields, ids: [] };
    g.ids.push(id);
    groups.set(key, g);
  };
  const given = (input.tags ?? []).map(tagKey).filter(Boolean);
  for (const t of tickets) {
    const had = new Set(t.tags.map(tagKey));
    switch (input.action) {
      case 'status':
        // Back over the state machine's one-way moves: the server lets the override through for whoever may.
        if (t.status !== input.status && isStatus(t.status)) add(`s:${t.status}`, { action: 'status', status: t.status, override: true }, t.id);
        break;
      case 'assign': {
        const was = t.assignee?.id ?? null;
        if (was !== (input.user_id ?? null)) add(`a:${was ?? ''}`, { action: 'assign', user_id: was }, t.id);
        break;
      }
      case 'priority':
        if (t.priority !== input.priority) add(`p:${t.priority}`, { action: 'priority', priority: t.priority }, t.id);
        break;
      case 'tag': {
        const added = given.filter((g) => !had.has(g));
        if (added.length) add(`u:${added.join(',')}`, { action: 'untag', tags: added }, t.id);
        break;
      }
      case 'untag': {
        const removed = given.filter((g) => had.has(g));
        if (removed.length) add(`t:${removed.join(',')}`, { action: 'tag', tags: removed }, t.id);
        break;
      }
      case 'delete':
        add('r', { action: 'restore' }, t.id);
        break;
    }
  }
  return [...groups.values()].map((g) => ({
    ...g.fields,
    action: g.fields.action!,
    ids: g.ids,
    // A restore takes no version: the ticket was in the bin.
    ...(g.fields.action === 'restore' ? {} : { versions: Object.fromEntries(g.ids.filter((id) => (done.get(id) ?? 0) > 0).map((id) => [id, done.get(id)!])) }),
  }));
}

/** Why tickets were refused, the reasons grouped with the tickets each one names, three at most: "Changed by somebody else (CFX-001292)". */
export function refusalReasons(results: readonly BulkResult[], refOf: (id: number) => string): string {
  const reasons = new Map<string, string[]>();
  for (const r of results) {
    if (r.ok) continue;
    const why = r.message?.trim() || r.code || text('Refused');
    reasons.set(why, [...(reasons.get(why) ?? []), refOf(r.id)]);
  }
  const listed = [...reasons].slice(0, 3).map(([why, refs]) => `${why} (${refs.length > 3 ? `${refs.slice(0, 3).join(', ')} +${refs.length - 3}` : refs.join(', ')})`);
  const rest = reasons.size - listed.length;
  return listed.join('; ') + (rest > 0 ? text('; {count} more reasons', { count: rest }) : '');
}

/**
 * An answer in one line: "Moved to Open · 5 tickets" when all were done; "… · 3 of 5 done — 2 refused: <why> (<refs>)"
 * when some were refused; "Nothing changed — 2 refused: …" when none was done.
 */
export function bulkSummary(answer: BulkAnswer, what: string, refOf: (id: number) => string): { kind: 'success' | 'warning' | 'error'; text: string } {
  const total = answer.results.length;
  const refused = answer.results.filter((r) => !r.ok).length;
  if (!refused) return { kind: 'success', text: `${what} · ${ticketCount(answer.done)}` };
  const why = refusalReasons(answer.results, refOf);
  if (!answer.done) return { kind: 'error', text: text('Nothing changed — {refused} refused: {why}', { refused, why }) };
  return { kind: 'warning', text: text('{what} · {done} of {total} done — {refused} refused: {why}', { what, done: answer.done, total, refused, why }) };
}

/** What a change says it did ("3 tickets marked Solved"). */
export function doneWords(action: BulkAction, n: number, fields: Record<string, unknown>, names: { assignee?: string | null; team?: string | null } = {}): string {
  const count = ticketCount(n);
  switch (action) {
    case 'status':
      return text('{count} marked {status}', { count, status: text(statusWord(String(fields.status) as SupportStatus)) });
    case 'priority':
      return text('{count} set to {priority}', { count, priority: text(PRIORITY_LABEL[String(fields.priority) as SupportPriority] ?? String(fields.priority)) });
    case 'assign':
      return fields.user_id ? text('{count} assigned to {name}', { count, name: names.assignee ?? text('them') }) : names.team ? text('{count} given to {team}', { count, team: names.team }) : text('{count} unassigned', { count });
    case 'team':
      return names.team ? text('{count} moved to {team}', { count, team: names.team }) : text('{count} taken out of their queue', { count });
    case 'tag':
      return text('{count} tagged', { count });
    case 'untag':
      return text('{count} untagged', { count });
    case 'snooze':
      return text('{count} snoozed', { count });
    case 'unsnooze':
      return text('{count} woken', { count });
    case 'watch':
      return text('Following {count}', { count });
    case 'unwatch':
      return text('No longer following {count}', { count });
    case 'read':
      return text('{count} marked read', { count });
    case 'unread':
      return text('{count} marked unread', { count });
    case 'delete':
      return text('{count} deleted', { count });
    case 'restore':
      return text('{count} restored', { count });
    case 'spam':
      return text('{count} marked as spam', { count });
    case 'merge':
      return text('{count} merged', { count });
  }
}

/* ── the menu ───────────────────────────────────────────────────────────── */

/** What the menu's items do; the Inbox owns the dialogs and the calls. */
export interface TicketMenuHandlers {
  open: () => void;
  openTab: () => void;
  openWindow: () => void;
  apply: (action: BulkAction, fields?: Record<string, unknown>) => void;
  /** Assign to… (people and teams, with search). */
  assignTo: () => void;
  addTag: () => void;
  snoozePick: () => void;
  merge: () => void;
  link: () => void;
  createTask: () => void;
  reply: () => void;
  note: () => void;
  macro: () => void;
  copyId: () => void;
  copyLink: () => void;
  print: () => void;
  exportPdf: () => void;
  remove: () => void;
}

/**
 * The right-click menu for one ticket or a selection (worksuite-desktop#333). `targets` are the tickets it acts on: the
 * row clicked, or every ticket picked when the row is one of them.
 */
export function ticketMenu(targets: readonly Ticket[], ctx: { meta: Meta | undefined; me: number | null; now?: Date; dot?: (p: SupportPriority) => ReactNode }, h: TicketMenuHandlers): MenuSection[] {
  const { meta, me } = ctx;
  const one = targets.length === 1 ? targets[0]! : null;
  const n = targets.length;
  const may = (cap: keyof Caps) => mayAll(targets, meta, cap);
  const sections: MenuSection[] = [];

  sections.push({
    id: 'open',
    items: one
      ? [
          { id: 'open', label: text('Open'), icon: 'eye', shortcut: '↵', onSelect: h.open },
          { id: 'tab', label: text('Open in new tab'), icon: 'external', onSelect: h.openTab },
          { id: 'window', label: text('Open in new window'), icon: 'app-window', onSelect: h.openWindow },
        ]
      : [{ id: 'tab', label: text('Open {count} in tabs', { count: ticketCount(n) }), icon: 'external', onSelect: h.openTab }],
  });

  // Status ▸: the moves allowed; the current one ticked.
  const now = common(targets as Ticket[], (t) => t.status);
  const statuses = statusChoices(meta, targets);
  if (statuses.length) {
    sections.push({
      id: 'status',
      label: n > 1 ? text('Status of {count}', { count: ticketCount(n) }) : text('Status'),
      items: [
        {
          id: 'status',
          label: text('Status'),
          icon: 'circle-dot',
          shortcut: 'E',
          submenu: [
            {
              id: 'statuses',
              items: statuses.map((s) => ({ id: `status-${s}`, label: text(statusWord(s)), radio: true, checked: now === s, onSelect: () => now !== s && h.apply('status', { status: s }) })),
            },
          ],
        },
      ],
    });
  }

  // Assign ▸
  if (may('assign') || may('reply')) {
    const owner = common(targets as Ticket[], (t) => t.assignee?.id ?? null);
    const items: MenuItem[] = [];
    if (me !== null) items.push({ id: 'me', label: n > 1 ? text('Assign {count} to me', { count: ticketCount(n) }) : text('Assign to me'), icon: 'user-plus', checked: owner === me, onSelect: () => owner !== me && h.apply('assign', { user_id: me }) });
    if (may('assign')) {
      items.push({ id: 'to', label: n > 1 ? text('Assign {count} to…', { count: ticketCount(n) }) : text('Assign to…'), icon: 'users', shortcut: 'A', onSelect: h.assignTo });
      items.push({ id: 'unassign', label: text('Unassign'), icon: 'user-x', disabled: targets.every((t) => !t.assignee), onSelect: () => h.apply('assign', { user_id: null }) });
    }
    sections.push({ id: 'assign', label: text('Assign'), items });
  }

  // Priority ▸, with its coloured dot.
  if (may('edit')) {
    const p = common(targets as Ticket[], (t) => t.priority);
    sections.push({
      id: 'priority',
      label: text('Priority'),
      items: [
        {
          id: 'priority',
          label: text('Priority'),
          icon: 'flag',
          shortcut: 'P',
          submenu: [{ id: 'priorities', items: PRIORITIES.map((x) => ({ id: `priority-${x}`, label: text(PRIORITY_LABEL[x]), leading: ctx.dot?.(x), radio: true, checked: p === x, onSelect: () => p !== x && h.apply('priority', { priority: x }) })) }],
        },
      ],
    });
  }

  // Organise
  const organise: MenuItem[] = [];
  if (may('edit')) organise.push({ id: 'tag', label: text('Add tag…'), icon: 'tag', onSelect: h.addTag });
  if (may('assign') && meta?.teams?.length) {
    const orgs = new Set(targets.map((t) => t.organization?.id ?? null));
    const teams = meta.teams.filter((tm) => tm.organization_id === null || orgs.has(tm.organization_id));
    const team = common(targets as Ticket[], (t) => t.team?.id ?? null);
    if (teams.length)
      organise.push({
        id: 'queue',
        label: text('Move to queue / group…'),
        icon: 'inbox',
        submenu: [{ id: 'teams', items: [...teams.map((tm) => ({ id: `team-${tm.id}`, label: tm.name, radio: true, checked: team === tm.id, onSelect: () => team !== tm.id && h.apply('team', { team_id: tm.id }) })), { id: 'team-none', label: text('No queue'), radio: true, checked: team === null, onSelect: () => team !== null && h.apply('team', { team_id: null }) }] }],
      });
  }
  const following = targets.every((t) => t.watching === true);
  organise.push({ id: 'follow', label: following ? text('Unfollow') : text('Follow'), icon: following ? 'eye-off' : 'eye', checked: following, onSelect: () => h.apply(following ? 'unwatch' : 'watch') });
  const unread = targets.some((t) => t.unread > 0);
  organise.push({ id: 'read', label: unread ? text('Mark as read') : text('Mark as unread'), icon: unread ? 'mail-open' : 'mail', onSelect: () => h.apply(unread ? 'read' : 'unread') });
  if (may('reply')) {
    const snoozed = targets.some((t) => !!t.snoozed_until && Date.parse(t.snoozed_until) > (ctx.now ?? new Date()).getTime());
    organise.push({
      id: 'snooze',
      label: text('Snooze until…'),
      icon: 'snooze',
      submenu: [
        {
          id: 'snooze-when',
          items: [
            ...snoozeChoices(ctx.now).map((c) => ({ id: `snooze-${c.id}`, label: c.label, onSelect: () => h.apply('snooze', { until: c.at }) })),
            { id: 'snooze-pick', label: text('Pick a date and time…'), icon: 'calendar', onSelect: h.snoozePick },
            ...(snoozed ? [{ id: 'unsnooze', label: text('Wake now'), icon: 'undo', onSelect: () => h.apply('unsnooze') }] : []),
          ],
        },
      ],
    });
  }
  sections.push({ id: 'organise', label: text('Organise'), items: organise });

  // Link
  const link: MenuItem[] = [];
  if (n > 1 && may('merge')) link.push({ id: 'merge', label: text('Merge {count}…', { count: ticketCount(n) }), icon: 'merge', onSelect: h.merge });
  if (one && may('merge')) link.push({ id: 'merge', label: text('Merge into another ticket…'), icon: 'merge', onSelect: h.merge });
  if (one && may('edit')) link.push({ id: 'link', label: text('Link to…'), description: text('Contact, company, order, tender, task'), icon: 'link', onSelect: h.link });
  if (one) link.push({ id: 'task', label: text('Create task from ticket'), icon: 'tasks', onSelect: h.createTask });
  if (link.length) sections.push({ id: 'link', label: text('Link'), items: link });

  // Respond
  if (one && (may('reply') || may('notes'))) {
    const respond: MenuItem[] = [];
    if (may('reply')) respond.push({ id: 'reply', label: text('Reply'), icon: 'reply', shortcut: 'R', onSelect: h.reply });
    // A note needs "notes", as the composer's Note tab does.
    if (may('notes')) respond.push({ id: 'note', label: text('Add internal note'), icon: 'compose', shortcut: 'N', onSelect: h.note });
    if (may('reply')) respond.push({ id: 'macro', label: text('Apply macro / saved reply…'), icon: 'zap', onSelect: h.macro });
    sections.push({ id: 'respond', label: text('Respond'), items: respond });
  }

  // Other
  sections.push({
    id: 'other',
    label: text('Other'),
    items: [
      { id: 'copy-id', label: n > 1 ? text('Copy ticket IDs') : text('Copy ticket ID'), icon: 'copy', onSelect: h.copyId },
      { id: 'copy-link', label: n > 1 ? text('Copy links') : text('Copy link'), icon: 'link', onSelect: h.copyLink },
      ...(one
        ? [
            { id: 'print', label: text('Print'), icon: 'printer', onSelect: h.print },
            { id: 'pdf', label: text('Export (PDF)'), icon: 'file-text', onSelect: h.exportPdf },
          ]
        : []),
    ],
  });

  // Danger: spam and delete, for whoever may delete (admins), Delete with confirmation.
  if (may('delete')) {
    sections.push({
      id: 'danger',
      items: [
        { id: 'spam', label: text('Mark as spam'), icon: 'spam', danger: true, onSelect: () => h.apply('spam') },
        { id: 'delete', label: n > 1 ? text('Delete {count}…', { count: ticketCount(n) }) : text('Delete…'), icon: 'trash', shortcut: '#', danger: true, onSelect: h.remove },
      ],
    });
  }
  return sections;
}
