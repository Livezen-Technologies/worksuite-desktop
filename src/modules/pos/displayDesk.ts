import type { CustomerCard, customersByPhone } from './desk';
import { maskName, safeMasked, type DisplayMatch, type Message } from './display';

/**
 * The register's side of the customer display's phone entry (worksuite-desktop#294): what it does with what the
 * customer does at the display. Kept apart from the screen, so the rules are tested without one.
 *
 * - **A number typed**: looked up through the till's door (online, on a server that does it); the display is answered
 *   with the matches as WorkSuite masked them — an id and "Has*****a M." each, nothing more — or none, or why not.
 * - **A match confirmed**: only one the register itself sent for that number. Its card is read (the register's, never
 *   the display's) and the customer is put on the sale; the cashier is told, and may accept or change it.
 * - **A new number**: only one the register looked up and found no one for. The cashier is asked to create the
 *   customer, the number filled in.
 * - **"Not me" / "Not you?"**: the customer is taken off the sale.
 */
export type DisplayNotice = { kind: 'confirmed'; masked: string } | { kind: 'new'; phone: string } | { kind: 'failed'; message: string } | { kind: 'notMe' };

export interface DisplayDeskDeps {
  /** The server looks numbers up (`display_phone`, `customers`) and answers now (online). */
  enabled: () => boolean;
  lookup: typeof customersByPhone;
  read: (id: number) => Promise<CustomerCard>;
  /** Put the customer on the sale on screen. */
  attach: (c: CustomerCard) => void;
  /** Take the customer off the sale on screen; false when there was none. */
  detach: () => boolean;
  reply: (m: Extract<Message, { type: 'phoneResult' }>) => void;
  notice: (n: DisplayNotice) => void;
}

const E164 = /^\+[1-9]\d{6,14}$/;
const KEEP = 20;

export function createDisplayDesk(d: DisplayDeskDeps): (m: Message) => Promise<void> {
  /** The numbers looked up, by the display's ticket: the number, and the matches sent for it. */
  const asked = new Map<string, { phone: string; matches: Map<number, string> }>();

  return async (m: Message): Promise<void> => {
    if (m.type === 'phone') {
      if (typeof m.ticket !== 'string' || !m.ticket || m.ticket.length > 40 || typeof m.phone !== 'string' || !E164.test(m.phone)) return;
      if (!d.enabled()) {
        d.reply({ type: 'phoneResult', ticket: m.ticket, result: { kind: 'error', reason: 'offline' } });
        return;
      }
      const entry = { phone: m.phone, matches: new Map<number, string>() };
      asked.set(m.ticket, entry);
      while (asked.size > KEEP) asked.delete(asked.keys().next().value!);
      try {
        const r = await d.lookup(m.phone);
        if ('refused' in r) {
          d.reply({ type: 'phoneResult', ticket: m.ticket, result: r.refused === 'throttled' ? { kind: 'error', reason: 'throttled' } : { kind: 'none' } });
          return;
        }
        const items: DisplayMatch[] = r.items.slice(0, 5).flatMap((x) => {
          const masked = safeMasked(x.masked);
          return masked ? [{ id: x.id, masked }] : [];
        });
        for (const x of items) entry.matches.set(x.id, x.masked);
        d.reply({ type: 'phoneResult', ticket: m.ticket, result: items.length ? { kind: 'matches', items } : { kind: 'none' } });
      } catch {
        d.reply({ type: 'phoneResult', ticket: m.ticket, result: { kind: 'error', reason: 'failed' } });
      }
      return;
    }
    if (m.type === 'confirm') {
      const a = typeof m.ticket === 'string' ? asked.get(m.ticket) : undefined;
      const masked = a?.matches.get(m.id);
      // Only a match this register sent for that number: the display cannot name anybody else.
      if (!a || !masked || !d.enabled()) return;
      asked.delete(m.ticket);
      try {
        const card = await d.read(m.id);
        d.attach(card);
        d.notice({ kind: 'confirmed', masked: maskName(card.name) });
      } catch (e) {
        d.notice({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (m.type === 'newNumber') {
      const a = typeof m.ticket === 'string' ? asked.get(m.ticket) : undefined;
      // Only a number looked up here and found for no one.
      if (!a || a.phone !== m.phone || a.matches.size > 0) return;
      asked.delete(m.ticket);
      d.notice({ kind: 'new', phone: a.phone });
      return;
    }
    if (m.type === 'notMe') {
      if (d.detach()) d.notice({ kind: 'notMe' });
    }
  };
}
