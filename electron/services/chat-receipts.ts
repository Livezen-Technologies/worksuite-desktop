import { backoffDelay } from '@shared/backoff';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';

const log = logger('chat-receipts');

/**
 * Delivered and read receipts for website chats, by seq and in batches (plan 2.9, WS-WCHAT DLV-08; the server's
 * docs/CHAT_DELIVERY.md "Receipts by seq").
 *
 * What this computer received — a visitor's message announced over realtime, or the newest one an open thread holds —
 * and what is on screen go to the server together, about once a second, as one
 * `POST …/conversations/receipts {items: [{conversation_id, acks, delivered_seq, read_seq, delivered, read}]}` (up
 * to 50 chats a request). Marks only move forward on the server and never pass the visitor's last message, so a seq
 * sent twice, or late, does no harm. A server without the batch (404/405) is sent one `…/conversations/{id}/receipts`
 * per chat instead, with the ids beside the seqs, which every server reads.
 *
 * The other half (the ticks on my own messages) is in the thread: Delivered and Read show only once the visitor's
 * widget acknowledged them (`marks.visitor.delivered_seq` / `read_seq`, or a `chat.widget.delivered` / `read` event),
 * never on send.
 */

export const RECEIPTS_PATH = '/api/chat/widget-admin/conversations';
/** Received seqs are coalesced this long before they go. */
export const ACK_DELAY_MS = 1_000;
/** Most chats in one batch (the server's limit). */
export const MAX_ITEMS = 50;
/** The most seqs one chat sends in a batch: the highest counts, so the rest are only for the server's records. */
const MAX_ACKS = 20;

export interface ReceiptMark {
  conversation_id: number;
  delivered_seq?: number;
  read_seq?: number;
  /** The same marks as message ids, for a server before seqs. */
  delivered?: number;
  read?: number;
}

interface Pending {
  acks: Set<number>;
  delivered_seq: number;
  read_seq: number;
  delivered: number;
  read: number;
}

const positive = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isSafeInteger(v) && v > 0 ? v : null;
};

export class ReceiptBatcher {
  private readonly pending = new Map<number, Pending>();
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private failures = 0;
  /** False once the server said it has no batch endpoint: one request per chat from then on. */
  private batch = true;

  constructor(
    private readonly http: Pick<HttpClient, 'post'>,
    private readonly delayMs = ACK_DELAY_MS,
  ) {}

  /** A message of the visitor's reached this computer (realtime): delivered. */
  ack(conversationId: number, seq: number, messageId?: number | null): void {
    const c = positive(conversationId);
    const s = positive(seq);
    if (!c || !s) return;
    const p = this.entry(c);
    p.acks.add(s);
    const id = positive(messageId);
    if (id) p.delivered = Math.max(p.delivered, id);
    this.soon();
  }

  /** What an open thread has (delivered) and shows (read): from the window. */
  mark(m: ReceiptMark): void {
    const c = positive(m.conversation_id);
    if (!c) return;
    const p = this.entry(c);
    p.delivered_seq = Math.max(p.delivered_seq, positive(m.delivered_seq) ?? 0, positive(m.read_seq) ?? 0);
    p.read_seq = Math.max(p.read_seq, positive(m.read_seq) ?? 0);
    p.delivered = Math.max(p.delivered, positive(m.delivered) ?? 0, positive(m.read) ?? 0);
    p.read = Math.max(p.read, positive(m.read) ?? 0);
    this.soon();
  }

  /**
   * A realtime event, acknowledged when it announces a visitor's message in a chat this person holds: the server
   * counts receipts only for the chat's owner and participants, so nobody else's computer needs to send any.
   */
  fromEvent(e: { type?: unknown; [k: string]: unknown }, holds: (conversationId: number, e: Record<string, unknown>) => boolean): void {
    if (e.type !== 'chat.widget.message' && e.type !== 'message.new') return;
    if (e.type === 'message.new' && e.from !== 'visitor') return;
    const c = positive(e.conversation_id);
    const s = positive(e.seq);
    if (!c || !s || !holds(c, e)) return;
    this.ack(c, s, positive(e.message_id ?? e.id));
  }

  /** Waiting to go: for tests and Diagnostics. */
  size(): number {
    return this.pending.size;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.failures = 0;
  }

  /** Everything waiting, now. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.flushing) return this.flushing;
    this.flushing = this.send().finally(() => {
      this.flushing = null;
      if (this.pending.size) this.soon();
    });
    return this.flushing;
  }

  private entry(c: number): Pending {
    let p = this.pending.get(c);
    if (!p) {
      p = { acks: new Set(), delivered_seq: 0, read_seq: 0, delivered: 0, read: 0 };
      this.pending.set(c, p);
    }
    return p;
  }

  private soon(): void {
    if (this.timer || this.flushing) return;
    const delay = this.failures ? backoffDelay(this.failures - 1, { baseMs: 2_000, maxMs: 60_000, jitter: 0.3 }) : this.delayMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
    this.timer.unref?.();
  }

  private take(): Array<[number, Pending]> {
    const out = [...this.pending.entries()].slice(0, MAX_ITEMS);
    for (const [c] of out) this.pending.delete(c);
    return out;
  }

  /** Put back what did not go, merged over anything that came since. */
  private putBack(items: Array<[number, Pending]>): void {
    for (const [c, p] of items) {
      const now = this.entry(c);
      for (const s of p.acks) now.acks.add(s);
      now.delivered_seq = Math.max(now.delivered_seq, p.delivered_seq);
      now.read_seq = Math.max(now.read_seq, p.read_seq);
      now.delivered = Math.max(now.delivered, p.delivered);
      now.read = Math.max(now.read, p.read);
    }
  }

  private async send(): Promise<void> {
    while (this.pending.size) {
      const items = this.take();
      try {
        if (this.batch) await this.http.post(`${RECEIPTS_PATH}/receipts`, { items: items.map(([c, p]) => body(c, p)) });
        else for (const [c, p] of items) await this.http.post(`${RECEIPTS_PATH}/${c}/receipts`, body(c, p, true));
        this.failures = 0;
      } catch (e) {
        const status = isDesktopError(e) ? (e.status ?? undefined) : undefined;
        if (this.batch && (status === 404 || status === 405)) {
          // A server from before the batch: each chat on its own, now.
          this.batch = false;
          this.putBack(items);
          continue;
        }
        // Refused for good (no permission, a chat gone, a body the server will not take): dropped, not retried.
        if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          log.debug('receipts refused', { status });
          continue;
        }
        this.failures++;
        this.putBack(items);
        return;
      }
    }
  }
}

function body(c: number, p: Pending, single = false): Record<string, unknown> {
  const acks = [...p.acks].sort((a, b) => a - b).slice(-MAX_ACKS);
  const out: Record<string, unknown> = single ? {} : { conversation_id: c };
  if (acks.length) out.acks = acks;
  const deliveredSeq = Math.max(p.delivered_seq, acks.at(-1) ?? 0);
  // One request per chat goes to a server that may not read `acks`: the highest is sent as delivered_seq too.
  if (p.delivered_seq || (single && deliveredSeq)) out.delivered_seq = deliveredSeq;
  if (p.read_seq) out.read_seq = p.read_seq;
  if (p.delivered) out.delivered = p.delivered;
  if (p.read) out.read = p.read;
  return out;
}
