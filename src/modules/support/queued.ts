import type { OfflineMutation } from '@shared/types';
import type { AssignInput, MessageInput, TicketChanges, TicketFull, TransitionInput } from '@shared/support';
import type { Change } from './Properties';

/**
 * The support outbox's reading of the offline queue (D-09, FR-DSK-07, FR-TKT-10): which queued changes are the desk's,
 * what each one is, and — for one the server refused because the ticket changed while I was offline — what I chose
 * against what the ticket now has.
 */
export type OutboxKind = 'reply' | 'note' | 'status' | 'assign' | 'fields';

export interface OutboxItem {
  m: OfflineMutation;
  kind: OutboxKind;
  ticketId: number;
  /** "CFX-001284" (or "#1284" when the reference was not known). */
  reference: string;
}

/** The desk's queued changes, in the order they go. */
export function outboxItems(all: OfflineMutation[] | undefined): OutboxItem[] {
  return (all ?? []).filter((m) => m.module === 'support' && m.state !== 'DONE').map(outboxItem);
}

export function outboxItem(m: OfflineMutation): OutboxItem {
  const path = m.path;
  const ticketId = Number(m.entityId ?? /\/tickets\/(\d+)/.exec(path)?.[1] ?? 0);
  const reference = m.label.split(' · ').slice(1).join(' · ') || `#${ticketId}`;
  const kind: OutboxKind = /\/messages$/.test(path) ? (m.label.startsWith('Internal note') ? 'note' : 'reply') : /\/transition$/.test(path) ? 'status' : /\/assign$/.test(path) ? 'assign' : 'fields';
  return { m, kind, ticketId, reference };
}

export const OUTBOX_KIND_LABEL: Record<OutboxKind, string> = {
  reply: 'Reply to requester',
  note: 'Internal note',
  status: 'Status change',
  assign: 'Assignment',
  fields: 'Property change',
};

/** The changes a queued write makes to the ticket's properties (none for a message). */
export function changesOf(kind: OutboxKind, body: unknown): Change[] {
  if (!body || typeof body !== 'object') return [];
  if (kind === 'status') return [{ kind: 'status', to: (body as TransitionInput).status }];
  if (kind === 'assign') return [{ kind: 'assignee', to: (body as AssignInput).user_id ?? null }];
  if (kind !== 'fields') return [];
  return Object.entries(body as Record<string, unknown>)
    .filter(([k]) => k !== 'version')
    .map(([field, to]) => ({ kind: 'field', field: field as keyof TicketChanges, to: to as TicketChanges[keyof TicketChanges] }));
}

/** The text of a queued message, to show and edit. */
export function messageOf(body: unknown): MessageInput | null {
  return body && typeof body === 'object' && typeof (body as MessageInput).body === 'string' ? (body as MessageInput) : null;
}

/** The ticket as the server had it when it refused the change (`VERSION_CONFLICT`'s `errors.ticket`). */
export function theirsOf(response: unknown): TicketFull | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as { errors?: { ticket?: unknown }; ticket?: unknown; code?: string };
  const t = r.errors?.ticket ?? r.ticket;
  return t && typeof t === 'object' && typeof (t as TicketFull).version === 'number' ? (t as TicketFull) : null;
}

/** Tags added on both sides are kept without asking (D-09: "Tags merged automatically"): the server's and mine. */
export function mergeTags(theirs: string[], mine: string[]): { tags: string[]; added: string[] } {
  const added = mine.filter((t) => !theirs.includes(t));
  return { tags: [...theirs, ...added], added };
}
