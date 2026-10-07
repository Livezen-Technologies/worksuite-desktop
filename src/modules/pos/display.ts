import { useCallback, useEffect, useRef, useState } from 'react';
import { createStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { closeDisplay, openDisplay } from './api';
import { deductionOf, type PricedCart } from './pricing';

/**
 * What the customer display shows, sent from the register over a BroadcastChannel: both are windows of this app, on
 * its own origin and session, so the cart never leaves the computer and no IPC channel is needed for it. The display
 * says hello when it opens and the register answers with where the sale stands.
 *
 * worksuite-desktop#294: the channel goes both ways. The display tells the register whether its screen takes touch,
 * and passes on what the customer does at it — a phone number typed, the match they confirmed, "not me", a new number
 * for the cashier. The REGISTER looks the number up (through the till's door, in the main process) and sends the
 * display only masked names (`maskName`, "Has*****a M."): no whole name, e-mail, address or purchase ever reaches the
 * display. `publish` masks every customer name itself, whoever calls it.
 */
export interface DisplayLine {
  name: string;
  quantity: number;
  /** One unit's price (#294); an older register's line has none. */
  price?: number;
  total: number;
}

/** The figures under the cart. */
export interface DisplayTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/**
 * Phase 2 adds, where the sale names a CRM customer: a greeting with their masked name, their tier and points — never
 * their contact details — and what promotions saved. #294 adds the payment as it is taken and whether the customer
 * may give their phone number at the display (`phone`: the server looks numbers up, and WorkSuite answers).
 */
export type DisplayState =
  | { kind: 'idle'; shop: string | null }
  | ({
      kind: 'cart';
      shop: string | null;
      currency: string;
      lines: DisplayLine[];
      provisional: boolean;
      customer?: string;
      tier?: string;
      points?: number;
      phone?: boolean;
    } & DisplayTotals)
  | ({ kind: 'pay'; shop: string | null; currency: string; lines: DisplayLine[]; paid: number; due: number; change: number; customer?: string } & DisplayTotals)
  | { kind: 'paid'; shop: string | null; currency: string; total: number; paid: number; change: number; customer?: string; points?: { earned: number; balance: number | null } };

/** A priced cart as the display shows it: each line's quantity, name, unit price and total, and the figures under them. Pure. */
export function displayCart(c: PricedCart): { lines: DisplayLine[] } & DisplayTotals {
  return {
    lines: c.lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.unit_price, total: l.total })),
    subtotal: c.subtotal,
    discount: deductionOf(c),
    tax: c.tax,
    total: c.total,
  };
}

/** A customer as the display may show them: masked, at most this long. */
export interface DisplayMatch {
  id: number;
  masked: string;
}

/** What the register answers to a number typed at the display. */
export type PhoneResult = { kind: 'matches'; items: DisplayMatch[] } | { kind: 'none' } | { kind: 'error'; reason: 'offline' | 'throttled' | 'failed' };

/** Register → display, and display → register. */
export type Message =
  | { type: 'state'; state: DisplayState }
  | { type: 'hello' }
  /** The cashier asks the customer for their number: the display opens its numpad. */
  | { type: 'ask' }
  | { type: 'phoneResult'; ticket: string; result: PhoneResult }
  /** The display: whether its screen takes touch. */
  | { type: 'touch'; touch: boolean }
  /** The display: a number typed (E.164), the match confirmed, a new number for the cashier, "not me". */
  | { type: 'phone'; ticket: string; phone: string }
  | { type: 'confirm'; ticket: string; id: number }
  | { type: 'newNumber'; ticket: string; phone: string }
  | { type: 'notMe' };

const NAME = 'worksuite-pos-display';
const MASK_MAX = 40;

/**
 * A name as the customer display may show it — the server's rule (`Customers::maskName`): the first name's first
 * three letters, a star for each letter between, its last letter, the last name's initial. "Hasarinda Mendis" is
 * "Has*****a M."; a shorter first name shows less ("Nimal" "Ni**l", "Ann" "A**"). Pure.
 */
export function maskName(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return '***';
  const first = [...words[0]!];
  const n = first.length;
  let shown: string;
  if (n <= 1) shown = `${first.join('')}*`;
  else if (n <= 4) shown = first[0]! + '*'.repeat(n - 1);
  else if (n <= 6) shown = first.slice(0, 2).join('') + '*'.repeat(n - 3) + first[n - 1]!;
  else shown = first.slice(0, 3).join('') + '*'.repeat(Math.min(8, n - 4)) + first[n - 1]!;
  const lastWord = words.length > 1 ? [...words[words.length - 1]!] : [];
  return lastWord.length ? `${shown} ${lastWord[0]!.toLocaleUpperCase()}.` : shown;
}

/** A masked name from WorkSuite, checked: one that does not look masked is masked here. Pure. */
export function safeMasked(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim().slice(0, MASK_MAX);
  return s.includes('*') ? s : maskName(s);
}

/** The state as it may leave the register: any customer's name masked. Pure. */
export function forDisplay(state: DisplayState): DisplayState {
  return 'customer' in state && state.customer ? { ...state, customer: maskName(state.customer) } : state;
}

/** What the display last said of its screen: whether the customer can touch it (the register's "ask" needs it). */
export const displayTouch = createStore<{ touch: boolean }>({ touch: false });

/*
 * The register's end, opened only by the register's calls (`publish`, `tellDisplay`, `onDisplay`) — never on import:
 * the display window imports this file too, and a second end there would answer its own hello.
 */
let channel: BroadcastChannel | null = null;
let last: DisplayState = { kind: 'idle', shop: null };
const listeners = new Set<(m: Message) => void>();

function open(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(NAME);
  // (Under Node — the unit tests — a channel would otherwise hold the process open.)
  (channel as { unref?: () => void }).unref?.();
  channel.onmessage = (e: MessageEvent<Message>) => {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'hello') channel?.postMessage({ type: 'state', state: last } satisfies Message);
    if (e.data.type === 'touch') displayTouch.set({ touch: e.data.touch === true });
    for (const l of listeners) l(e.data);
  };
  return channel;
}

/** The register: tell the display what to show now. Any customer's name goes masked. */
export function publish(state: DisplayState): void {
  last = forDisplay(state);
  open()?.postMessage({ type: 'state', state: last } satisfies Message);
}

/** The register: send the display something else (`ask`, `phoneResult`). */
export function tellDisplay(m: Extract<Message, { type: 'ask' } | { type: 'phoneResult' }>): void {
  if (m.type === 'phoneResult' && m.result.kind === 'matches') {
    // Only an id and a masked name per match — whatever the caller had in hand.
    m = { ...m, result: { kind: 'matches', items: m.result.items.slice(0, 5).flatMap((x) => (Number.isInteger(x.id) && x.id > 0 && safeMasked(x.masked) ? [{ id: x.id, masked: safeMasked(x.masked)! }] : [])) } };
  }
  open()?.postMessage(m satisfies Message);
}

/** The register: what the display says (touch, the customer's number, their choice). */
export function onDisplay(fn: (m: Message) => void): () => void {
  open();
  listeners.add(fn);
  return () => listeners.delete(fn);
}


/** The display: its own end of the channel — what the register last said, and a way to answer. */
export function useDisplayChannel(onOther?: (m: Message) => void): { state: DisplayState; send: (m: Message) => void } {
  const [state, setState] = useState<DisplayState>({ kind: 'idle', shop: null });
  const c = useRef<BroadcastChannel | null>(null);
  const onOtherRef = useRef(onOther);
  useEffect(() => {
    onOtherRef.current = onOther;
  });
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(NAME);
    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data?.type === 'state') setState(e.data.state);
      // Every message, the state too: the display closes its numpad when the sale moves on.
      if (e.data) onOtherRef.current?.(e.data);
    };
    ch.postMessage({ type: 'hello' } satisfies Message);
    c.current = ch;
    return () => {
      ch.close();
      c.current = null;
    };
  }, []);
  const send = useCallback((m: Message) => c.current?.postMessage(m), []);
  return { state, send };
}

/** The display: what the register last said. */
export function useDisplayState(): DisplayState {
  return useDisplayChannel().state;
}

/** Whether this window opened the customer display (the till bar's menu, the till's devices). */
export const displayWindow = createStore<{ open: boolean }>({ open: false });

/** Open the customer display (on the second screen when there is one), or close it. */
export async function toggleCustomerDisplay(): Promise<void> {
  try {
    if (displayWindow.get().open) {
      await closeDisplay();
      displayWindow.set({ open: false });
    } else {
      const r = await openDisplay();
      displayWindow.set({ open: r.opened });
      if (!r.secondary) toast('info', 'Only one screen is connected: the customer display opened as a window. Move it to the customer’s screen.');
    }
  } catch (e) {
    toast('error', e instanceof Error ? e.message : 'The customer display could not be opened.');
  }
}
