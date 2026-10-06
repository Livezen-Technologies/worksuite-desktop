import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '../../../src/modules/salon/money';
import { offlineAsked, offlineDue, offlinePayable, offlineTaken } from '../../../src/modules/salon/OfflinePay';

afterEach(() => vi.unstubAllGlobals());

describe('the cashier’s arithmetic', () => {
  it('types cash on the keypad: digits, 00, one point, two decimals, back', () => {
    let v = '';
    for (const k of ['0', '5', '00', '0']) v = m.pressKey(v, k);
    expect(v).toBe('5000');
    expect(m.pressKey('5000', 'back')).toBe('500');
    expect(m.pressKey('12', '.')).toBe('12.');
    expect(m.pressKey('12.5', '.')).toBe('12.5');
    expect(m.pressKey('12.5', '0')).toBe('12.50');
    expect(m.pressKey('12.50', '1')).toBe('12.50');
    expect(m.pressKey('12.5', '00')).toBe('12.5');
    expect(m.pressKey('', '.')).toBe('0.');
    expect(m.pressKey('999999999', '9')).toBe('999999999');
    expect(m.pressKey('5', 'clear')).toBe('');
  });

  it('keeps a typed figure to digits and one point', () => {
    expect(m.moneyTyped('LKR 1,250.567')).toBe('1250.56');
    expect(m.moneyTyped('1.2.3')).toBe('1.23');
  });

  it('offers the round sums a client might hand over', () => {
    expect(m.suggestions(3450)).toEqual([3500, 4000, 5000]);
    expect(m.suggestions(5000)).toEqual([]);
    expect(m.suggestions(800)).toEqual([1000, 5000]);
  });

  it('sets what was handed over against what is due, in cents', () => {
    const h = m.handedOver(
      [
        { method: 'cash', amount: 3000, reference: null },
        { method: 'card', amount: 712.5, reference: '4321' },
        { method: 'wallet', amount: 0, reference: null },
      ],
      3450,
    );
    expect(h).toMatchObject({ handed: 371250, over: 26250, cash: 300000, missingReference: false });
    expect(h.tenders).toHaveLength(2);
    expect(m.handedOver([{ method: 'card', amount: 100, reference: ' ' }], 100).missingReference).toBe(true);
    expect(m.handedOver([{ method: 'online', amount: 100, reference: null }], 100).missingReference).toBe(false);
    expect(m.handedOver([{ method: 'cash', amount: 1000, reference: null }], 3450).over).toBe(-245000);
    // 0.1 + 0.2 is not 0.3 in floating point; in cents it is.
    expect(m.handedOver([{ method: 'cash', amount: 0.1, reference: null }, { method: 'cash', amount: 0.2, reference: null }], 0.3).over).toBe(0);
  });
});

describe('counting the drawer', () => {
  it('sends the piles that have something in them, largest first', () => {
    const counts = { '5000': '2', '1000': '', '100': '7', '0.5': '3', '20': 'x' };
    expect(m.countLines(counts)).toEqual([
      { value: 5000, count: 2 },
      { value: 100, count: 7 },
      { value: 0.5, count: 3 },
    ]);
    expect(m.countTotal(counts)).toBe(10701.5);
  });

  it('reads the server’s empty map, which comes as a list', () => {
    expect(m.tenderMap([])).toEqual({});
    expect(m.tenderMap({ cash: 10 })).toEqual({ cash: 10 });
    expect(m.tenderMap(undefined)).toEqual({});
  });
});

describe('taking the money', () => {
  it('invoices and pays in one request, into the desk’s register, under the attempt’s key', async () => {
    const seen: Array<{ url: string; key: string | null; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, key: new Headers(init.headers).get('Idempotency-Key'), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ status: 'success', message: 'Checked out and invoiced as INV-1. Paid in full. Change 150.00.', data: { invoice: { id: 1, number: 'INV-1' }, paid: { ok: true, change: 150 }, visit: { id: 7 } } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const r = await m.checkout(7, { redeem_points: 100, use_credit: true, retail: [{ product_id: 3, quantity: 2, seller_id: 4 }] }, { tenders: [{ method: 'cash', amount: 5000, reference: null }], keep_as_credit: false, desk_id: 12 }, 'desktop-k1');

    expect(r.data.paid?.change).toBe(150);
    expect(seen).toEqual([
      {
        url: 'app://bundle/__api/api/salon/v1/visits/7/checkout',
        key: 'desktop-k1',
        body: { redeem_points: 100, use_credit: true, retail: [{ product_id: 3, quantity: 2, seller_id: 4 }], tenders: [{ method: 'cash', amount: 5000, reference: null }], keep_as_credit: false, desk_id: 12 },
      },
    ]);
  });

  it('takes the rest of an invoiced visit against its invoice, and reads it as a payment', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('app://bundle/__api/api/salon/v1/visits/7/payments');
      return new Response(JSON.stringify({ status: 'success', message: 'Paid in full.', data: { ok: true, owed: 0, settled: true, visit: { id: 7 } } }), { headers: { 'Content-Type': 'application/json' } });
    });
    const r = await m.payRest(7, { tenders: [], keep_as_credit: true, desk_id: 12, use_credit: false }, 'k2');
    expect(r.data).toMatchObject({ paid: { ok: true, settled: true }, visit: { id: 7 }, message: 'Paid in full.' });
  });
});

describe('pages printed from the server’s figures', () => {
  const heading: m.PageHeading = { company: 'Glow <Beauty> & Co', location: 'Colombo 05', date: '2026-09-28', paper: '80mm' };

  it('prints the Z-report from the close’s answer, escaped', () => {
    const html = m.zReport({ variance: -250, z: { session_id: 9, tenders: { cash: 12000, card: 3500 }, sales: { cash_in: 15000, cash_change: 3000, count: 4, total: 15500, credit_kept: 0 }, expected: 17000 } }, 'REG-1', heading, 'LKR');
    expect(html).toContain('Glow &lt;Beauty&gt; &amp; Co');
    expect(html).toContain('Z-REPORT · REG-1');
    expect(html).toContain('session #9');
    expect(html).toContain('<td>Cash</td><td class="r">12,000.00</td>');
    expect(html).toContain('<td>Difference</td><td class="r">-250.00</td>');
    expect(html).toContain('width:282px');
    expect(html).not.toContain('<script');
  });

  it('prints the day at the roll’s width, and says what was not new money', () => {
    const day = {
      date: '2026-09-28',
      currency: 'LKR',
      figures: { bookings: 8, done: 3, to_come: 5, taken: { total: 20000, not_new: 500, by_method: [{ method: 'cash', label: 'Cash', receipts: 2, amount: 20000, new_money: true }, { method: 'advance', label: 'Advance', receipts: 1, amount: 500, new_money: false }] }, owed: null },
      not_checked_out: [],
      unpaid: [],
      completed: 3,
      no_shows: 1,
      commission: 0,
      queue: 0,
    } satisfies m.DeskDay;
    const html = m.daySummary(day, { ...heading, paper: '58mm' });
    expect(html).toContain('Advance (1) — not new money');
    expect(html).toContain('<td>Taken LKR</td><td class="r">20,000.00</td>');
    expect(html).toContain('width:199px');
  });
});

describe('printing goes through the main process', () => {
  it('asks it to print a visit’s receipt, and to open the drawer', async () => {
    const printReceipt = vi.fn(async () => ({ ok: true, printer: 'TM-T20', silent: true, message: 'Sent to TM-T20.' }));
    const openDrawer = vi.fn(async () => ({ ok: true, printer: 'TM-T20', silent: true, message: 'Drawer opened.' }));
    vi.stubGlobal('window', { worksuite: { salon: { printReceipt, openDrawer } } });

    expect((await m.printReceipt(7)).message).toBe('Sent to TM-T20.');
    expect(printReceipt).toHaveBeenCalledWith({ visit_id: 7, paper: undefined });
    expect((await m.openDrawer()).ok).toBe(true);
  });
});

describe('a payment taken offline (POS-11)', () => {
  const v = (over: Record<string, unknown> = {}) =>
    ({
      id: 62,
      number: 'GBL-APT-011562',
      status: 'in_service',
      checked_out: false,
      invoice: null,
      money: { currency: 'LKR', total: 15375, deposit_due: 0, advance: 3000, deposit_owed: 0, balance: 12375 },
      ...over,
    }) as unknown as Parameters<typeof offlineDue>[0];

  it('may be taken for a visit in the chair or done, or checked out and still owing', () => {
    expect(offlinePayable(v())).toBe(true);
    expect(offlinePayable(v({ status: 'completed' }))).toBe(true);
    expect(offlinePayable(v({ status: 'checked_in' }))).toBe(false);
    expect(offlinePayable(v({ status: 'completed', checked_out: true, invoice: { id: 1, number: 'INV-1', status: 'paid', total: 15375, paid: 15375, owed: 0 } }))).toBe(false);
    expect(offlinePayable(v({ status: 'completed', checked_out: true, invoice: { id: 1, number: 'INV-1', status: 'partial', total: 15375, paid: 10000, owed: 5375 } }))).toBe(true);
  });

  it('is the price less the advance, or what the invoice still owes; and asks for the whole', () => {
    expect(offlineDue(v())).toBe(12375);
    expect(offlineAsked(v())).toBe(15375);
    const owing = v({ checked_out: true, invoice: { id: 1, number: 'INV-1', status: 'partial', total: 13737.5, paid: 10000, owed: 3737.5 } });
    expect(offlineDue(owing)).toBe(3737.5);
    expect(offlineAsked(owing)).toBe(13737.5);
  });

  it('keeps cash net of the change, and never more than is due', () => {
    expect(offlineTaken('cash', 12375, 15000)).toEqual({ taken: 12375, change: 2625 });
    expect(offlineTaken('cash', 12375, 10000)).toEqual({ taken: 10000, change: 0 });
    expect(offlineTaken('card', 12375, 0)).toEqual({ taken: 12375, change: 0 });
  });

  it('prints a till receipt that says the tax invoice follows', () => {
    const html = m.offlineReceipt(
      {
        receipt: 'FRONT-1-OFF-000012',
        at: '2026-09-28 11:41',
        register: 'FRONT-1',
        visit: 'GBL-APT-011562',
        client: 'Amaya <Senanayake>',
        lines: [{ label: 'Root colour', amount: 11875 }],
        currency: 'LKR',
        total: 15375,
        advance: 3000,
        tenders: [{ method: 'cash', amount: 12375, reference: null }],
        change: 2625,
      },
      { company: 'Glow', location: 'Colombo 05', paper: '80mm' },
    );
    expect(html).toContain('FRONT-1-OFF-000012');
    expect(html).toContain('Amaya &lt;Senanayake&gt;');
    expect(html).toContain('15,000.00');
    expect(html).toContain('2,625.00');
    expect(html).toContain('Your tax invoice follows');
  });
});
