import { PRIORITY_LABEL, TRANSITIONS, capForMove, isStatus, statusLabel, type CapName, type Caps, type Meta, type SupportStatus, type Ticket } from '@shared/support';
import { text } from '../../core/i18n';
import type { BulkAction, BulkAnswer, BulkInput } from './api';

/**
 * The inbox's actions on several tickets at once (#333, FR-WSP-04): what a person may do to the tickets picked, what
 * the answer of `POST tickets/bulk` says, and how a change is taken back. The screens are TicketActions.tsx (the
 * right-click menu, the confirmations) and BulkBar.tsx; this is what they share, free of React.
 *
 * Permissions are the desk's own, per organization (`GET meta`'s `organizations[].can`, else its `can`): an action is
 * offered when it may be done to the ticket (one ticket) or to at least one of them (several) — the server checks each
 * ticket again and refuses the rest, one by one, and the summary says which and why.
 */

/** What I may do to this ticket: its organization's caps, else the desk's. */
export function capsFor(meta: Pick<Meta, 'organizations' | 'can'> | null | undefined, t: Pick<Ticket, 'organization'>): Caps {
  const org = t.organization?.id;
  const own = org === undefined ? undefined : meta?.organizations?.find((o) => o.id === org)?.can;
  return own ?? meta?.can ?? {};
}

/** Whether the cap is held for any of the tickets. */
export function anyCan(meta: Pick<Meta, 'organizations' | 'can'> | null | undefined, ts: readonly Pick<Ticket, 'organization'>[], cap: CapName): boolean {
  return ts.some((t) => capsFor(meta, t)[cap] === true);
}

/** The moves the state machine allows from a status (`GET meta`'s `next`, else the as-built table). */
function movesFrom(meta: Pick<Meta, 'statuses'> | null | undefined, from: SupportStatus): readonly SupportStatus[] {
  return meta?.statuses?.find((s) => s.key === from)?.next ?? TRANSITIONS[from] ?? [];
}

/** The statuses at least one of the tickets may be moved to, in the desk's order, with every one's own status. */
export function statusChoices(meta: Pick<Meta, 'statuses' | 'organizations' | 'can'> | null | undefined, ts: readonly Pick<Ticket, 'status' | 'organization'>[]): SupportStatus[] {
  const order = meta?.statuses?.length ? meta.statuses.map((s) => s.key) : (Object.keys(TRANSITIONS) as SupportStatus[]);
  const ok = new Set<SupportStatus>();
  let moves = 0;
  for (const t of ts) {
    ok.add(t.status);
    const can = capsFor(meta, t);
    for (const to of movesFrom(meta, t.status)) {
      if (can[capForMove(t.status, to)] !== true) continue;
      ok.add(to);
      moves += 1;
    }
  }
  // Nothing any of them may move to: no status menu at all.
  if (!moves) return [];
  return order.filter((s) => ok.has(s));
}

/** The value every ticket shares, or null when they differ. */
export function shared<T>(ts: readonly Ticket[], get: (t: Ticket) => T): T | null {
  if (!ts.length) return null;
  const first = get(ts[0]!);
  return ts.every((t) => get(t) === first) ? first : null;
}

/** "1 ticket", "12 tickets"; `more`: there are more than these ("50+ tickets"). */
export function ticketCount(n: number, more = false): string {
  if (more) return text('{count}+ tickets', { count: n });
  return n === 1 ? text('1 ticket') : text('{count} tickets', { count: n });
}

/** The list's heading line: "Resolved · 1 ticket", "Open · 12 tickets" — the title alone while the count is unknown. */
export function countTitle(title: string, count: number | null, more = false): string {
  return count === null ? title : `${title} · ${ticketCount(count, more)}`;
}

/** A tag as the server keeps it (`TicketService` lower-cases and trims, to 60). */
export function tagKey(name: string): string {
  return name.trim().toLowerCase().slice(0, 60);
}

/** What a change says it did: "Moved to Resolved", "Assigned to Nimal", "Priority: High"… */
export function actionWords(input: Pick<BulkInput, 'action' | 'status' | 'priority' | 'tags' | 'user_id'>, extra: { assignee?: string | null; primary?: string | null } = {}): string {
  switch (input.action) {
    case 'status':
      return text('Moved to {status}', { status: text(statusLabel(input.status)) });
    case 'assign':
      return input.user_id ? text('Assigned to {name}', { name: extra.assignee ?? text('somebody') }) : text('Unassigned');
    case 'priority':
      return text('Priority: {priority}', { priority: text(PRIORITY_LABEL[input.priority as keyof typeof PRIORITY_LABEL] ?? String(input.priority)) });
    case 'tag':
      return text('Tagged {tags}', { tags: (input.tags ?? []).map((t) => `“${t}”`).join(', ') });
    case 'untag':
      return text('Untagged {tags}', { tags: (input.tags ?? []).map((t) => `“${t}”`).join(', ') });
    case 'delete':
      return text('Deleted');
    case 'restore':
      return text('Restored');
    case 'merge':
      return extra.primary ? text('Merged into {ref}', { ref: extra.primary }) : text('Merged');
  }
  return '';
}

/**
 * The answer in words, for the toast: "Moved to Resolved · 5 tickets" when all were done; "Moved to Resolved · 3 of 5
 * done — 2 refused: You may not move this ticket to resolved (CFX-001284, CFX-001292)" when some were refused, the
 * reasons grouped, three at most; "Nothing changed — 2 refused: …" when none was done.
 */
export function bulkSummary(answer: BulkAnswer, what: string, refOf: (id: number) => string): { kind: 'success' | 'warning' | 'error'; text: string } {
  const total = answer.results.length;
  const refused = answer.results.filter((r) => !r.ok);
  if (!refused.length) return { kind: 'success', text: `${what} · ${ticketCount(answer.done)}` };
  const reasons = new Map<string, string[]>();
  for (const r of refused) {
    const why = r.message?.trim() || r.code || text('Refused');
    reasons.set(why, [...(reasons.get(why) ?? []), refOf(r.id)]);
  }
  const listed = [...reasons].slice(0, 3).map(([why, refs]) => `${why} (${refs.length > 3 ? `${refs.slice(0, 3).join(', ')} +${refs.length - 3}` : refs.join(', ')})`);
  const rest = reasons.size - listed.length;
  const why = listed.join('; ') + (rest > 0 ? text('; {count} more reasons', { count: rest }) : '');
  if (!answer.done) return { kind: 'error', text: text('Nothing changed — {refused} refused: {why}', { refused: refused.length, why }) };
  return { kind: 'warning', text: text('{what} · {done} of {total} done — {refused} refused: {why}', { what, done: answer.done, total, refused: refused.length, why }) };
}

/** The actions Undo can take back: each restores what the tickets had (delete by restoring them). */
export const UNDOABLE: readonly BulkAction[] = ['status', 'assign', 'priority', 'tag', 'untag', 'delete'];

/**
 * The calls that put back what the done tickets had before: one per earlier value (three tickets that were Open and two
 * that were Pending are two calls), each with the version the change left it at, so a ticket changed again meanwhile
 * is refused rather than overwritten. Nothing for an action Undo cannot take back, or when nothing was done.
 */
export function undoInputs(input: BulkInput, before: readonly Ticket[], answer: BulkAnswer): BulkInput[] {
  if (!UNDOABLE.includes(input.action)) return [];
  const done = new Map(answer.results.filter((r) => r.ok).map((r) => [r.id, r.version ?? 0]));
  const tickets = before.filter((t) => done.has(t.id));
  if (!tickets.length) return [];
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
        // Back over the state machine's one-way moves (Resolved → Open needs "reopen"): the server lets the override
        // through only for whoever holds that permission.
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

/** Several answers as one (an Undo of three groups is one summary). */
export function joinAnswers(answers: readonly BulkAnswer[]): BulkAnswer {
  const results = answers.flatMap((a) => a.results);
  const done = results.filter((r) => r.ok).length;
  return { results, done, refused: results.length - done };
}

/**
 * Whether the change could write to the requesters: moving to Resolved or Closed can send each one the satisfaction
 * survey (`Csat`, sent after a ticket is resolved or closed unless it was told not to), so it is asked first.
 */
export function mayEmailRequesters(input: Pick<BulkInput, 'action' | 'status'>): boolean {
  return input.action === 'status' && (input.status === 'resolved' || input.status === 'closed');
}
