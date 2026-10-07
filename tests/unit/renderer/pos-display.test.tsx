// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosDisplayMedia } from '@shared/pos';
import CustomerDisplay, { DONE_MS, nextSlide, NUMPAD_IDLE_MS, PhoneEntry, phoneOffered, Promotions, typePhone, viewOf } from '../../../src/modules/pos/CustomerDisplay';
import { displayCart, forDisplay, maskName, onDisplay, publish, safeMasked, tellDisplay, type DisplayState, type Message } from '../../../src/modules/pos/display';
import { createDisplayDesk, type DisplayNotice } from '../../../src/modules/pos/displayDesk';
import type { CustomerCard } from '../../../src/modules/pos/desk';
import { TabProvider } from '../../../src/core/tab-context';
import { TillContext, type Till } from '../../../src/modules/pos/parts';

/**
 * The customer display (worksuite-desktop#294): what it shows in each state of the sale, the promotions beside the
 * cart, the phone number a customer types — and that nothing but a masked name ever reaches it.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as { worksuite?: unknown }).worksuite;
  publish({ kind: 'idle', shop: null });
});

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function media(o: Partial<PosDisplayMedia> = {}): PosDisplayMedia {
  return { slides: [], logo: null, company: 'Acme', accent: null, interval: 8, transition: 'fade', touch: true, version: 'v1', ...o };
}

const cart = (o: Partial<Extract<DisplayState, { kind: 'cart' }>> = {}): DisplayState => ({
  kind: 'cart',
  shop: 'Acme',
  currency: 'LKR',
  lines: [{ name: 'Ceylon tea 100g', quantity: 2, price: 450, total: 900 }],
  subtotal: 900,
  discount: 0,
  tax: 0,
  total: 900,
  provisional: false,
  phone: true,
  ...o,
});

const till = { status: null, options: null, company: null, caps: {}, currency: 'LKR', session: null, registers: [], offline: false, discount: { allowed: false, ceiling: null }, params: new URLSearchParams(), go: () => undefined } as unknown as Till;

function mount(node: ReactNode, m: PosDisplayMedia | null = media()) {
  (window as { worksuite?: unknown }).worksuite = {
    platform: 'linux',
    pos: { displayMedia: async () => m },
    events: { on: () => () => undefined },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TillContext.Provider value={till}>
        <TabProvider tabId="d" route="/pos/display" active onGo={() => undefined}>
          {node}
        </TabProvider>
      </TillContext.Provider>
    </QueryClientProvider>,
  );
}

/** What the display says to the register, as the register hears it. */
function register(): Message[] {
  const heard: Message[] = [];
  const off = onDisplay((m) => heard.push(m));
  afterEachOff.push(off);
  return heard;
}
const afterEachOff: Array<() => void> = [];
afterEach(() => {
  for (const off of afterEachOff.splice(0)) off();
});

describe('a customer as the display shows them', () => {
  it('masks a name: three letters, stars, the last letter, the last name’s initial', () => {
    expect(maskName('Hasarinda Mendis')).toBe('Has*****a M.');
    expect(maskName('Nimal Perera')).toBe('Ni**l P.');
    expect(maskName('Ann')).toBe('A**');
    expect(maskName('  ')).toBe('***');
    expect(maskName('Abcdefghijklmnopqrstuvwxyz Q')).toBe('Abc********z Q.');
    expect(safeMasked('Has*****a M.')).toBe('Has*****a M.');
    expect(safeMasked('Hasarinda Mendis')).toBe('Has*****a M.');
    expect(safeMasked(42)).toBeNull();
  });

  it('never lets a whole name leave the register', () => {
    const s = forDisplay({ ...cart(), customer: 'Hasarinda Mendis' } as DisplayState);
    expect(s).toMatchObject({ customer: 'Has*****a M.' });
    expect(JSON.stringify(forDisplay({ kind: 'paid', shop: null, currency: 'LKR', total: 1, paid: 1, change: 0, customer: 'Nimal Perera' }))).not.toContain('Nimal');
  });

  it('greets the customer on the sale by their masked name, with “Not you?”', async () => {
    const heard = register();
    mount(<CustomerDisplay />);
    publish({ ...cart(), customer: 'Hasarinda Mendis' } as DisplayState);
    expect(await screen.findByText('Hello, Has*****a M.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Hasarinda');
    expect(document.body.textContent).not.toContain('Mendis');
    expect(screen.queryByText('Enter your phone number')).toBeNull();
    fireEvent.click(screen.getByText('Not you?'));
    await waitFor(() => expect(heard).toContainEqual({ type: 'notMe' }));
  });
});

describe('the states of the sale', () => {
  it('is idle with no sale, then the cart, the payment, the thanks — and idle again after a few seconds', () => {
    expect(viewOf({ kind: 'idle', shop: null }, 0)).toBe('idle');
    expect(viewOf(cart({ lines: [] }), 0)).toBe('idle');
    expect(viewOf(cart(), 0)).toBe('cart');
    expect(viewOf({ ...(cart() as object), kind: 'pay', paid: 0, due: 900, change: 0 } as DisplayState, 0)).toBe('pay');
    const paid: DisplayState = { kind: 'paid', shop: null, currency: 'LKR', total: 900, paid: 1000, change: 100 };
    expect(viewOf(paid, 0)).toBe('done');
    expect(viewOf(paid, DONE_MS)).toBe('idle');
  });

  it('shows the cart with each line’s quantity, name, unit price and total, and what they pay', async () => {
    mount(<CustomerDisplay />);
    expect(screen.getByText('Welcome')).toBeTruthy();
    publish(cart({ lines: [{ name: 'Ceylon tea 100g', quantity: 2, price: 450, total: 900 }, { name: 'Milk', quantity: 1, price: 380, total: 380 }], subtotal: 1280, discount: 128, tax: 0, total: 1152 }));
    expect(await screen.findByText('Milk')).toBeTruthy();
    expect(screen.getByText('450.00 each')).toBeTruthy();
    expect(screen.getByText('Subtotal')).toBeTruthy();
    expect(screen.getByText('−128.00')).toBeTruthy();
    expect(screen.getByText('LKR 1,152.00')).toBeTruthy();
    expect(document.querySelector('[data-view="cart"]')).toBeTruthy();
  });

  it('follows the payment: due, paid, still to pay, then the change', async () => {
    mount(<CustomerDisplay />);
    publish({ ...(cart() as object), kind: 'pay', paid: 500, due: 400, change: 0 } as DisplayState);
    expect(await screen.findByText('Still to pay')).toBeTruthy();
    expect(screen.getByText('Amount due')).toBeTruthy();
    expect(screen.getByText('LKR 400.00')).toBeTruthy();
    publish({ ...(cart() as object), kind: 'pay', paid: 1000, due: 0, change: 100 } as DisplayState);
    expect(await screen.findByText('LKR 100.00')).toBeTruthy();
    expect(screen.getByText('Your change')).toBeTruthy();
  });

  it('thanks the customer, then goes back to its promotions', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount(<CustomerDisplay />);
    publish({ kind: 'paid', shop: 'Acme', currency: 'LKR', total: 900, paid: 1000, change: 100 });
    expect(await screen.findByText('Thank you')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[data-view="done"]')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(DONE_MS);
    });
    expect(document.querySelector('[data-view="idle"]')).toBeTruthy();
  });

  it('builds the cart it shows from the priced cart: the unit price and the deduction', () => {
    const c = displayCart({ currency: 'LKR', lines: [{ product_id: 1, code: null, name: 'Tea', quantity: 2, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 900, tax: 0, total: 900 }], subtotal: 900, line_discount: 0, discount_pct: 0, discount: 0, tax: 0, total: 850, deduction: 50 });
    expect(c).toEqual({ lines: [{ name: 'Tea', quantity: 2, price: 450, total: 900 }], subtotal: 900, discount: 50, tax: 0, total: 850 });
  });
});

describe('the promotions', () => {
  it('moves to the next picture every interval, and wraps', () => {
    expect(nextSlide(0, 3)).toBe(1);
    expect(nextSlide(2, 3)).toBe(0);
    expect(nextSlide(0, 1)).toBe(0);
    vi.useFakeTimers();
    render(<Promotions media={media({ interval: 3, slides: [{ id: 1, src: PIXEL, title: 'A' }, { id: 2, src: PIXEL, title: 'B' }] })} shop="Acme" full />);
    const el = () => document.querySelector('[data-promo="slides"]')!;
    expect(el().getAttribute('data-at')).toBe('0');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(el().getAttribute('data-at')).toBe('1');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(el().getAttribute('data-at')).toBe('0');
    // Each fills the panel, cropped rather than stretched.
    expect(document.querySelectorAll('img.object-cover')).toHaveLength(2);
  });

  it('slides instead of fading when set so', () => {
    render(<Promotions media={media({ transition: 'slide', slides: [{ id: 1, src: PIXEL, title: null }, { id: 2, src: PIXEL, title: null }] })} shop="Acme" full={false} />);
    const imgs = document.querySelectorAll('img');
    expect((imgs[1] as HTMLElement).style.transform).toBe('translateX(100%)');
  });

  it('falls back to the logo on the brand colour with no pictures (and before any are read)', () => {
    render(<Promotions media={media({ logo: PIXEL, accent: '#123456' })} shop="Acme" full />);
    expect(document.querySelector('[data-promo="fallback"]')).toBeTruthy();
    expect(screen.getByAltText('Acme').getAttribute('src')).toBe(PIXEL);
    cleanup();
    render(<Promotions media={null} shop="Acme" full />);
    expect(document.querySelector('[data-promo="fallback"]')).toBeTruthy();
  });
});

describe('the phone number at the display', () => {
  it('is offered only with touch, a sale on screen, nobody on it, and the register’s word (online, a server that looks up)', () => {
    expect(phoneOffered(cart(), true)).toBe(true);
    expect(phoneOffered(cart(), false)).toBe(false);
    expect(phoneOffered(cart({ phone: false }), true)).toBe(false);
    expect(phoneOffered(cart({ customer: 'Has*****a M.' }), true)).toBe(false);
    expect(phoneOffered(cart({ lines: [] }), true)).toBe(false);
    expect(phoneOffered({ kind: 'idle', shop: null }, true)).toBe(false);
  });

  it('hides the button without touch, and while offline', async () => {
    mount(<CustomerDisplay />, media({ touch: false }));
    publish(cart());
    expect(await screen.findByText('Ceylon tea 100g')).toBeTruthy();
    expect(screen.queryByText('Enter your phone number')).toBeNull();
    cleanup();
    mount(<CustomerDisplay />);
    publish(cart({ phone: false }));
    expect(await screen.findByText('Ceylon tea 100g')).toBeTruthy();
    expect(screen.queryByText('Enter your phone number')).toBeNull();
  });

  it('types a number, checks it, asks the register, and shows only the masked match to confirm', async () => {
    const heard = register();
    mount(<CustomerDisplay />);
    publish(cart());
    fireEvent.click(await screen.findByText('Enter your phone number'));
    for (const k of '0767') fireEvent.click(screen.getByRole('button', { name: k }));
    fireEvent.click(screen.getByText('Find me'));
    expect(screen.getByText('That is not a phone number. Check it and try again.')).toBeTruthy();
    for (const k of '793692') fireEvent.click(screen.getByRole('button', { name: k }));
    fireEvent.click(screen.getByText('Find me'));
    await waitFor(() => expect(heard.some((m) => m.type === 'phone')).toBe(true));
    const asked = heard.find((m) => m.type === 'phone') as Extract<Message, { type: 'phone' }>;
    expect(asked.phone).toBe('+94767793692');
    expect(await screen.findByText('Looking you up…')).toBeTruthy();

    tellDisplay({ type: 'phoneResult', ticket: asked.ticket, result: { kind: 'matches', items: [{ id: 41, masked: 'Has*****a M.' }] } });
    expect(await screen.findByText('Is this you?')).toBeTruthy();
    expect(screen.getByText('Has*****a M.')).toBeTruthy();
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(heard).toContainEqual({ type: 'confirm', ticket: asked.ticket, id: 41 }));
  });

  it('lets the customer pick from several, and passes an unknown number to the cashier', async () => {
    const heard = register();
    mount(<CustomerDisplay />);
    publish(cart());
    fireEvent.click(await screen.findByText('Enter your phone number'));
    for (const k of '0711111111') fireEvent.click(screen.getByRole('button', { name: k }));
    fireEvent.click(screen.getByText('Find me'));
    await waitFor(() => expect(heard.some((m) => m.type === 'phone')).toBe(true));
    const first = heard.find((m) => m.type === 'phone') as Extract<Message, { type: 'phone' }>;
    // The register never sends a whole name, but if it did the display would mask it.
    tellDisplay({ type: 'phoneResult', ticket: first.ticket, result: { kind: 'matches', items: [{ id: 1, masked: 'Kam*l S.' }, { id: 2, masked: 'Nimal Perera' }] } });
    expect(await screen.findByText('Which of these is you?')).toBeTruthy();
    expect(screen.getByText('Ni**l P.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Perera');
    expect((screen.getByText('Confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Not me'));
    for (const k of '0112345678') fireEvent.click(screen.getByRole('button', { name: k }));
    fireEvent.click(screen.getByText('Find me'));
    await waitFor(() => expect(heard.filter((m) => m.type === 'phone')).toHaveLength(2));
    const second = heard.filter((m) => m.type === 'phone')[1] as Extract<Message, { type: 'phone' }>;
    tellDisplay({ type: 'phoneResult', ticket: second.ticket, result: { kind: 'none' } });
    fireEvent.click(await screen.findByText('Continue with this number'));
    await waitFor(() => expect(heard).toContainEqual({ type: 'newNumber', ticket: second.ticket, phone: '+94112345678' }));
    expect(screen.getByText('Thank you. The cashier will add you to this sale.')).toBeTruthy();
  });

  it('opens when the cashier asks', async () => {
    mount(<CustomerDisplay />);
    publish(cart());
    expect(await screen.findByText('Enter your phone number')).toBeTruthy();
    tellDisplay({ type: 'ask' });
    expect(await screen.findByRole('dialog', { name: 'Your phone number' })).toBeTruthy();
  });

  it('closes and clears after half a minute with nobody touching it', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<PhoneEntry result={null} onSubmit={() => undefined} onConfirm={() => undefined} onNewNumber={() => undefined} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    act(() => {
      vi.advanceTimersByTime(NUMPAD_IDLE_MS - 1000);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    act(() => {
      vi.advanceTimersByTime(NUMPAD_IDLE_MS - 1000);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the number to digits, a leading plus, fifteen at most', () => {
    expect(typePhone('', '+')).toBe('+');
    expect(typePhone('07', '6')).toBe('076');
    expect(typePhone('076', 'back')).toBe('07');
    expect(typePhone('076', 'clear')).toBe('');
    expect(typePhone('123456789012345', '1')).toBe('123456789012345');
  });
});

describe('the register’s side of it', () => {
  const card = (id: number, name: string): CustomerCard => ({ id, name, phone: '0767793692', email: 'x@example.com', group: null, points: 0, store_credit: null, spend_12m: 0, visits_12m: 0, tier: null, next_tier: null, loyalty: null, last: [] });

  function desk(o: { enabled?: boolean; items?: Array<{ id: number; masked: string }>; refused?: 'throttled' | 'bad_phone'; fail?: boolean; customer?: boolean } = {}) {
    const replies: Array<Extract<Message, { type: 'phoneResult' }>> = [];
    const notices: DisplayNotice[] = [];
    const attached: CustomerCard[] = [];
    let customer = o.customer ?? false;
    const lookup = vi.fn(async (_p: string) => {
      if (o.fail) throw new Error('down');
      return o.refused ? { refused: o.refused } : { items: o.items ?? [] };
    });
    const read = vi.fn(async (id: number) => card(id, 'Hasarinda Mendis'));
    const handle = createDisplayDesk({
      enabled: () => o.enabled ?? true,
      lookup: lookup as never,
      read,
      attach: (c) => {
        attached.push(c);
        customer = true;
      },
      detach: () => {
        const had = customer;
        customer = false;
        return had;
      },
      reply: (m) => replies.push(m),
      notice: (n) => notices.push(n),
    });
    return { handle, replies, notices, attached, lookup, read };
  }

  it('answers a number with masked matches only, and attaches only one it sent', async () => {
    const d = desk({ items: [{ id: 41, masked: 'Has*****a M.' }] });
    await d.handle({ type: 'phone', ticket: 't1', phone: '+94767793692' });
    expect(d.lookup).toHaveBeenCalledWith('+94767793692');
    expect(d.replies).toEqual([{ type: 'phoneResult', ticket: 't1', result: { kind: 'matches', items: [{ id: 41, masked: 'Has*****a M.' }] } }]);
    await d.handle({ type: 'confirm', ticket: 't1', id: 99 });
    await d.handle({ type: 'confirm', ticket: 'other', id: 41 });
    expect(d.read).not.toHaveBeenCalled();
    await d.handle({ type: 'confirm', ticket: 't1', id: 41 });
    expect(d.read).toHaveBeenCalledWith(41);
    expect(d.attached.map((c) => c.id)).toEqual([41]);
    expect(d.notices).toEqual([{ kind: 'confirmed', masked: 'Has*****a M.' }]);
    // The same confirmation again does nothing more.
    await d.handle({ type: 'confirm', ticket: 't1', id: 41 });
    expect(d.attached).toHaveLength(1);
  });

  it('says why not: offline, throttled, or WorkSuite failed; nobody is none', async () => {
    const off = desk({ enabled: false });
    await off.handle({ type: 'phone', ticket: 'a', phone: '+94767793692' });
    expect(off.replies[0]!.result).toEqual({ kind: 'error', reason: 'offline' });
    expect(off.lookup).not.toHaveBeenCalled();
    const busy = desk({ refused: 'throttled' });
    await busy.handle({ type: 'phone', ticket: 'b', phone: '+94767793692' });
    expect(busy.replies[0]!.result).toEqual({ kind: 'error', reason: 'throttled' });
    const down = desk({ fail: true });
    await down.handle({ type: 'phone', ticket: 'c', phone: '+94767793692' });
    expect(down.replies[0]!.result).toEqual({ kind: 'error', reason: 'failed' });
    const none = desk();
    await none.handle({ type: 'phone', ticket: 'd', phone: '+94767793692' });
    expect(none.replies[0]!.result).toEqual({ kind: 'none' });
    // Not a number in E.164: not even looked up.
    await none.handle({ type: 'phone', ticket: 'e', phone: '0767793692' });
    expect(none.lookup).toHaveBeenCalledTimes(1);
  });

  it('passes an unknown number to the cashier — only one it looked up and found nobody for', async () => {
    const d = desk();
    await d.handle({ type: 'newNumber', ticket: 'x', phone: '+94112345678' });
    expect(d.notices).toEqual([]);
    await d.handle({ type: 'phone', ticket: 'x', phone: '+94112345678' });
    await d.handle({ type: 'newNumber', ticket: 'x', phone: '+94770000000' });
    expect(d.notices).toEqual([]);
    await d.handle({ type: 'newNumber', ticket: 'x', phone: '+94112345678' });
    expect(d.notices).toEqual([{ kind: 'new', phone: '+94112345678' }]);
    const found = desk({ items: [{ id: 1, masked: 'A**' }] });
    await found.handle({ type: 'phone', ticket: 'y', phone: '+94112345678' });
    await found.handle({ type: 'newNumber', ticket: 'y', phone: '+94112345678' });
    expect(found.notices).toEqual([]);
  });

  it('takes the customer off the sale when they say it is not them', async () => {
    const d = desk({ customer: true });
    await d.handle({ type: 'notMe' });
    expect(d.notices).toEqual([{ kind: 'notMe' }]);
    await d.handle({ type: 'notMe' });
    expect(d.notices).toHaveLength(1);
  });

  it('sends the display no more than an id and a masked name, whatever it is handed', async () => {
    const seen: Message[] = [];
    const ch = new BroadcastChannel('worksuite-pos-display');
    ch.onmessage = (e: MessageEvent<Message>) => seen.push(e.data);
    tellDisplay({ type: 'phoneResult', ticket: 't', result: { kind: 'matches', items: [{ id: 1, masked: 'Hasarinda Mendis', email: 'h@example.com' } as never] } });
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ type: 'phoneResult', ticket: 't', result: { kind: 'matches', items: [{ id: 1, masked: 'Has*****a M.' }] } });
    ch.close();
  });
});
