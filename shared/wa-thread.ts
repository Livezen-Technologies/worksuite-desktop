/**
 * Keeping a WhatsApp conversation in step with the server without loading it again (Whatsapp 1.6.0): an answer to
 * `?since=<cursor>` carries only the messages that changed (`delta: true`) and is merged into what is already held —
 * on screen, and in the encrypted copy the main process keeps. A message this app is still sending has a negative id
 * and its own `client_message_id`; the server's copy replaces it when it lands.
 */
export interface WaThreadMessage {
  id: number;
  client_message_id?: string | null;
}

export interface WaThreadShape<M extends WaThreadMessage = WaThreadMessage> {
  messages: M[];
  has_more?: boolean;
  next_before?: number | null;
  cursor?: string | null;
  delta?: boolean;
}

/** A delta answer at this size may have been cut short: load the conversation in full instead. */
export const WA_DELTA_LIMIT = 500;

/** Messages by id, newer replacing older; a server copy replaces the pending one with the same client id. */
export function mergeWaMessages<M extends WaThreadMessage>(base: M[], incoming: M[]): M[] {
  const byId = new Map<number, M>();
  for (const m of base) byId.set(m.id, m);
  const landed = new Set(incoming.map((m) => m.client_message_id).filter(Boolean) as string[]);
  for (const [id, m] of byId) if (id < 0 && m.client_message_id && landed.has(m.client_message_id)) byId.delete(id);
  for (const m of incoming) byId.set(m.id, m);
  // Ours still being sent stay at the end, in the order they were written.
  return [...byId.values()].sort((a, b) => ((a.id < 0) === (b.id < 0) ? Math.abs(a.id) - Math.abs(b.id) : a.id < 0 ? 1 : -1));
}

/** An answer merged into what is held: a delta keeps older pages; a full answer replaces them, keeping only ours in flight. */
export function mergeWaThread<T extends WaThreadShape>(old: T | undefined, next: T): T {
  if (!old) return next;
  if (!next.delta) return { ...next, messages: mergeWaMessages(old.messages.filter((m) => m.id < 0), next.messages) };
  return { ...next, messages: mergeWaMessages(old.messages, next.messages), has_more: old.has_more, next_before: old.next_before };
}

/** An older page (`before=`) put in front of what is held. */
export function prependWaPage<T extends WaThreadShape>(old: T, page: T): T {
  return { ...old, messages: mergeWaMessages(old.messages, page.messages), has_more: page.has_more, next_before: page.next_before ?? null };
}

/** The saved copy keeps the latest messages only, so a long conversation does not grow it without end. */
export function trimWaThread<T extends WaThreadShape>(t: T, keep = 200): T {
  const held = t.messages.filter((m) => m.id > 0);
  if (held.length <= keep) return { ...t, messages: held };
  const kept = held.slice(-keep);
  return { ...t, messages: kept, has_more: true, next_before: kept[0]!.id };
}
