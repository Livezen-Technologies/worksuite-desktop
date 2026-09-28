import type { SalonOutboxItem, SalonOutboxKind } from '@shared/types';

/**
 * The front desk's outbox, as rules with no database in them (OFF-03…08).
 *
 * What the counter did while WorkSuite was out of reach — a new client, a
 * booking, a check-in — waits here in the order it was done and is sent to
 * `POST desk/outbox` when the line is back. The server judges each item
 * again, under its own locks (R-03); this only decides what is sent, in
 * which order, and what a refusal leaves behind.
 *
 * A client or booking made here has a local id until the server has it, and
 * later items name it as "local:<id>". Local ids are UUIDs: the server keeps
 * a desk's local ids for ever, so a counter that restarted from 1 would book
 * the next walk-in for a client created last week.
 */
export const KINDS: readonly SalonOutboxKind[] = ['client.create', 'visit.book', 'visit.check_in'];

/** At most this many items go in one request (Desk::BATCH). */
export const BATCH = 50;

export const LOCAL_ID = /^[CV]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every "local:<id>" a payload names, however deep. */
export function needsOf(payload: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.startsWith('local:')) out.add(v.slice(6));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(payload);
  return [...out];
}

/** Put a real id wherever a payload names a local one. */
export function substitute<T>(payload: T, localId: string, serverId: number): T {
  const walk = (v: unknown): unknown => {
    if (v === `local:${localId}`) return serverId;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(payload) as T;
}

/**
 * Items held back because something they need was refused — directly, or
 * through a chain (a check-in for a booking for a refused new client).
 */
export function held(items: SalonOutboxItem[]): Set<string> {
  const blocked = new Set(items.filter((i) => i.state === 'refused' && i.local_id).map((i) => i.local_id!));
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of items) {
      if (out.has(i.id) || i.state === 'refused') continue;
      if (i.needs.some((n) => blocked.has(n))) {
        out.add(i.id);
        if (i.local_id && !blocked.has(i.local_id)) blocked.add(i.local_id);
        grew = true;
      }
    }
  }
  return out;
}

/** What to send now: waiting items, in order, not held behind a refusal, at most one batch. */
export function batch(items: SalonOutboxItem[]): SalonOutboxItem[] {
  const h = held(items);
  return [...items]
    .sort((a, b) => a.seq - b.seq)
    .filter((i) => i.state === 'waiting' && !h.has(i.id))
    .slice(0, BATCH);
}

export interface ReplayResult {
  key: string;
  status: 'accepted' | 'duplicate' | 'refused' | 'queued';
  server_id?: number | null;
  message?: string | null;
  next?: SalonOutboxItem['next'];
  choices?: string[];
}

export interface Applied {
  items: SalonOutboxItem[];
  accepted: number;
  duplicates: number;
  refused: SalonOutboxItem[];
  /** A local id the server now has, and its id: for the copy and later items. */
  resolved: Array<{ local_id: string; server_id: number }>;
  /** The server said "not now" to something: stop sending for this round. */
  stop: boolean;
}

/**
 * Fold the server's answer into the outbox. Accepted and already-done items
 * leave; refused ones stay, with what the server said and the choices it
 * offers, until a person decides (OFF-08, AC-28); anything the server did not
 * get to stays waiting under the same key. An item refused only because it
 * named a local id the server did not have yet is sent again once it does.
 */
export function apply(items: SalonOutboxItem[], sent: SalonOutboxItem[], results: ReplayResult[], now: string): Applied {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const gone = new Set<string>();
  const refused: SalonOutboxItem[] = [];
  const resolved: Applied['resolved'] = [];
  let accepted = 0;
  let duplicates = 0;
  let stop = false;
  const next = new Map(items.map((i) => [i.id, { ...i }]));

  for (const s of sent) {
    const r = byKey.get(s.key);
    const item = next.get(s.id)!;
    if (!r) {
      item.attempts += 1;
      continue;
    }
    if (r.status === 'accepted' || r.status === 'duplicate') {
      if (r.status === 'accepted') accepted++;
      else duplicates++;
      gone.add(s.id);
      if (s.local_id && typeof r.server_id === 'number') resolved.push({ local_id: s.local_id, server_id: r.server_id });
    } else if (r.status === 'refused') {
      item.state = 'refused';
      item.message = r.message ?? 'WorkSuite would not do this.';
      item.next = r.next ?? null;
      item.choices = choicesFor(item.kind, item.next, r.choices);
      item.updated_at = now;
      refused.push(item);
    } else {
      item.attempts += 1;
      stop = true;
    }
  }

  for (const id of gone) next.delete(id);
  let out = [...next.values()];

  for (const { local_id, server_id } of resolved) {
    out = out.map((i) => {
      if (!i.needs.includes(local_id)) return i;
      const payload = substitute(i.payload, local_id, server_id);
      const needs = i.needs.filter((n) => n !== local_id);
      /* Refused only for want of this id: it goes again, as a new attempt. */
      const revive = i.state === 'refused' && /needs .*which the server has not accepted|It needs /i.test(i.message ?? '');
      return { ...i, payload, needs, ...(revive ? { state: 'waiting' as const, message: null, next: null, choices: [], key: newKeyFor(i.key) } : {}) };
    });
  }

  return { items: out, accepted, duplicates, refused: refused.filter((r) => !gone.has(r.id)), resolved, stop };
}

const CHOICES = ['take_next', 'time', 'client', 'edit', 'retry', 'drop'] as const;

/**
 * What a person may do about a refusal. The server offers "take the next
 * time" with a time and "edit" without one; a new client refused because
 * WorkSuite already knows someone like them comes with the candidates, and
 * the answer to that is "it is this client". A booking is changed by its
 * time. Sending again is always there (the diary may have changed), and so
 * is dropping it.
 */
export function choicesFor(kind: SalonOutboxKind, next: SalonOutboxItem['next'], given: string[] | undefined): string[] {
  const out = new Set<string>();
  const offered = !!next && 'starts_at' in next;
  if (next && 'candidates' in next && next.candidates.length > 0) out.add('client');
  if (kind === 'visit.book') {
    if (offered) out.add('take_next');
    out.add('time');
  }
  for (const c of given ?? []) {
    const name = c === 'choose_time' ? 'time' : c;
    if (name === 'take_next' || name === 'time' || name === 'client') continue;
    if (name === 'edit' && kind === 'visit.book') continue;
    if ((CHOICES as readonly string[]).includes(name)) out.add(name);
  }
  out.add('retry');
  out.add('drop');
  return CHOICES.filter((c) => out.has(c));
}

/** A fresh key for an item sent again as a new attempt: the desk's prefix, a new UUID. */
export function newKeyFor(key: string): string {
  const prefix = /^(desk\d+)-/.exec(key)?.[1] ?? 'desk';
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

/** Drop an item, and everything that needs it, however indirectly. */
export function dropWithDependents(items: SalonOutboxItem[], id: string): { items: SalonOutboxItem[]; dropped: SalonOutboxItem[] } {
  const target = items.find((i) => i.id === id);
  if (!target) return { items, dropped: [] };
  const gone = new Set([target.id]);
  const locals = new Set(target.local_id ? [target.local_id] : []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of items) {
      if (gone.has(i.id)) continue;
      if (i.needs.some((n) => locals.has(n))) {
        gone.add(i.id);
        if (i.local_id) locals.add(i.local_id);
        grew = true;
      }
    }
  }
  return { items: items.filter((i) => !gone.has(i.id)), dropped: items.filter((i) => gone.has(i.id)) };
}

/**
 * "It is this client": a new client refused because WorkSuite already knows
 * someone with those details becomes that client — the create leaves, and
 * everything that named it names the real client and goes again.
 */
export function adoptClient(items: SalonOutboxItem[], id: string, clientId: number): SalonOutboxItem[] {
  const target = items.find((i) => i.id === id);
  if (!target || target.kind !== 'client.create' || !target.local_id) return items;
  const local = target.local_id;
  return items
    .filter((i) => i.id !== id)
    .map((i) => {
      if (!i.needs.includes(local)) return i;
      const refused = i.state === 'refused';
      return {
        ...i,
        payload: substitute(i.payload, local, clientId),
        needs: i.needs.filter((n) => n !== local),
        ...(refused ? { state: 'waiting' as const, message: null, next: null, choices: [], key: newKeyFor(i.key) } : {}),
      };
    });
}

/** What the desk's heartbeat reports: everything not yet accepted, refused items included (OFF-07). */
export function depth(items: SalonOutboxItem[]): number {
  return items.length;
}
