// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosGiveBack, PosSale, PosTillStatus } from '@shared/pos';
import type { PosRegister, PosSession } from '../../../src/modules/pos/api';
import { cartActions } from '../../../src/modules/pos/cart';
import CashMove from '../../../src/modules/pos/CashMove';
import Connect from '../../../src/modules/pos/Connect';
import CustomerDisplay from '../../../src/modules/pos/CustomerDisplay';
import { publish } from '../../../src/modules/pos/display';
import { TabProvider } from '../../../src/core/tab-context';
import ReturnDialog from '../../../src/modules/pos/ReturnDialog';
import { TillContext, type Till } from '../../../src/modules/pos/parts';
import Shift from '../../../src/modules/pos/ShiftScreen';
import SyncDrawer from '../../../src/modules/pos/SyncDrawer';
import TillSettings from '../../../src/modules/pos/TillSettings';

afterEach(() => {
  cleanup();
  cartActions.reset();
  vi.unstubAllGlobals();
  delete (window as { worksuite?: unknown }).worksuite;
});

const session: PosSession = {
  id: 41,
  org_id: 3,
  register_id: 3,
  register: 'Front counter 1',
  register_code: 'FRONT-1',
  terminal_id: 7,
  currency: 'LKR',
  status: 'open',
  opening_float: 5000,
  opened_at: '2026-10-06T03:00:00Z',
  cashier: 'Kasun',
  closed_at: null,
  closed_by_name: null,
  expected_cash: null,
  counted_cash: null,
  variance: null,
  variance_reason: null,
  note: null,
  blind: true,
  denominations: [5000, 1000, 100],
};

const status: PosTillStatus = {
  till: { terminal: { id: 7, code: 'POS-01', name: 'Front till', org_id: 3, org_name: 'Acme', branch_name: 'Kollupitiya', warehouse_id: null, warehouse_name: null }, paired_at: '2026-09-01T00:00:00Z', state: 'paired', prefix: 'T1-AAAAAA' },
  waiting: 0,
  refused: 0,
  reachable: true,
  last_contact: null,
  last_sync: null,
  problem: null,
  can_queue: true,
  can_keep: true,
  catalogue: null,
};

const register: PosRegister = { id: 3, org_id: 3, code: 'FRONT-1', name: 'Front counter 1', branch: null, warehouse: null, terminal_id: 7, terminal: 'Front till', active: true, session: null };

function till(o: Partial<Till> = {}): Till {
  return {
    status,
    options: { companies: [], cash_reasons: { in: ['Float top-up'], out: ['To the safe', 'Bank deposit'] }, denominations: { LKR: [5000, 1000, 100] } },
    company: { id: 3, name: 'Acme', currency: 'LKR', today: null, can: { sell: true, open: true, close: true, cash_in: true, cash_out: true, view_all: false, settings: false, terminals: false } },
    caps: {},
    currency: 'LKR',
    session: null,
    registers: [register],
    offline: false,
    discount: { allowed: false, ceiling: null },
    params: new URLSearchParams(),
    go: () => undefined,
    ...o,
  };
}

function api() {
  const seen: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null });
    const data = url.includes('/sessions/41') && (init.method ?? 'GET') === 'GET' ? { session, movements: [], counts: [] } : { id: 41 };
    return new Response(JSON.stringify({ status: 'success', message: 'Done.', data }), { headers: { 'Content-Type': 'application/json' } });
  });
  return seen;
}

function mount(node: ReactNode, t: Till, pos: Record<string, unknown> = {}) {
  (window as { worksuite?: unknown }).worksuite = {
    platform: 'linux',
    pos: {
      sales: async () => [],
      printSettings: async () => ({ receipt_printer: 'Thermal', header: '', footer: '' }),
      openDrawer: async () => ({ ok: true, printer: 'Thermal', message: 'Drawer opened.' }),
      ...pos,
    },
    print: { printers: async () => [{ name: 'Thermal', displayName: 'Thermal' }] },
    events: { on: () => () => undefined },
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TillContext.Provider value={t}>{node}</TillContext.Provider>
    </QueryClientProvider>,
  );
}

describe('opening the register', () => {
  it('counts the float note by note on the keypad, and opens with the piles', async () => {
    const seen = api();
    mount(<Shift />, till());
    expect(screen.getByRole('heading', { name: 'Open Front counter 1' })).toBeTruthy();
    fireEvent.focus(screen.getByLabelText('How many 1,000'));
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    expect((screen.getByLabelText('How many 100') as HTMLInputElement).value).toBe('20');
    expect(screen.getByText('LKR 7,000.00')).toBeTruthy();
    expect(screen.getByText(/till POS-01 paired/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the register' }));
    await waitFor(() => expect(seen.some((s) => s.method === 'POST')).toBe(true));
    expect(seen.find((s) => s.method === 'POST')).toMatchObject({ url: expect.stringContaining('/api/pos/sessions'), body: { register_id: 3, opening_float: 7000, denominations: [{ value: 1000, count: 5 }, { value: 100, count: 20 }] } });
  });
});

describe('closing the register', () => {
  it('waits while a sale is open on this till, then closes on a blind count', async () => {
    const seen = api();
    cartActions.add(9);
    mount(<Shift />, till({ session }));
    expect(screen.getByText('Blind count')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('How many 5,000'), { target: { value: '2' } });
    expect(screen.getByText(/1 open and 0 held sale\(s\) on this till/)).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Close the register' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    cartActions.reset();
    await waitFor(() => expect(close.disabled).toBe(false));
    fireEvent.click(close);
    await waitFor(() => expect(seen.some((s) => s.url.includes('/close'))).toBe(true));
    expect(seen.find((s) => s.url.includes('/close'))!.body).toEqual({ denominations: [{ value: 5000, count: 2 }] });
  });
});

describe('cash in and out', () => {
  it('takes cash out with a reason chip and a reference, then opens the drawer', async () => {
    const seen = api();
    const onClose = vi.fn();
    mount(<CashMove session={session} onClose={onClose} />, till({ session }));
    fireEvent.click(screen.getByRole('tab', { name: 'Take cash out' }));
    for (const k of ['3', '00', '00']) fireEvent.click(screen.getByRole('button', { name: k }));
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('30,000');
    const go = screen.getByRole('button', { name: 'Take out 30,000.00 and open the drawer' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'To the safe' }));
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'SAFE-2' } });
    fireEvent.click(go);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(seen[0]).toMatchObject({ url: expect.stringContaining('/api/pos/sessions/41/cash'), method: 'POST', body: { direction: 'out', amount: 30000, reason: 'To the safe', reference: 'SAFE-2' } });
  });
});

describe('the sync drawer', () => {
  const sale = (ref: string, state: PosSale['state'], at: string) => ({ ref, state, created_at: at, tenders: [{ method: 'cash', amount: 450 }], totals: { subtotal: 450, discount: 0, tax: 0, total: 450 } }) as unknown as PosSale;

  it('lists what waits to be sent, in order, and tries again now', async () => {
    const syncNow = vi.fn(async () => status);
    mount(<SyncDrawer till={till({ offline: true, status: { ...status, reachable: false, waiting: 2, refused: 0, last_contact: '2026-10-06T08:27:00Z' } })} onClose={() => undefined} />, till(), {
      sales: async () => [sale('T1-AAAAAA-000052', 'waiting', '2026-10-06T08:31:00Z'), sale('T1-AAAAAA-000050', 'sent', '2026-10-06T08:20:00Z'), sale('T1-AAAAAA-000051', 'refused', '2026-10-06T08:30:00Z')],
      syncNow,
    });
    expect(screen.getByRole('heading', { name: 'Selling offline' })).toBeTruthy();
    expect(screen.getByText('Waits for the connection')).toBeTruthy();
    await screen.findByText('T1-AAAAAA-000052');
    expect(screen.getByText('Waiting to send · 2')).toBeTruthy();
    expect(screen.queryByText('T1-AAAAAA-000050')).toBeNull();
    const refs = screen.getAllByText(/^T1-AAAAAA-00005/).map((e) => e.textContent);
    expect(refs).toEqual(['T1-AAAAAA-000051', 'T1-AAAAAA-000052']);
    fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
  });
});

describe('a return at the counter', () => {
  const sold: PosSale = {
    ref: 'T1-AAAAAA-000118',
    created_at: '2026-10-06T08:38:00Z',
    terminal_id: 7,
    cashier_id: 5,
    cashier_name: 'Kasun',
    state: 'sent',
    number: 'SO-1',
    message: null,
    attempts: 1,
    sent_at: null,
    session_id: 41,
    register_id: 3,
    currency: 'LKR',
    customer: { name: 'Ruwan' },
    lines: [
      { product_id: 9, code: null, name: 'Wireless mouse', quantity: 1, unit_price: 3450, discount_pct: 0, tax_rate: 0, net: 3450, tax: 0, total: 3450 },
      { product_id: 3, code: null, name: 'Notebook', quantity: 3, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 1350, tax: 0, total: 1350 },
    ],
    discount_pct: 0,
    totals: { subtotal: 4800, discount: 0, tax: 0, total: 4800 },
    tenders: [{ method: 'cash', amount: 4800 }],
    change_given: 0,
    priced_by: 'server',
    catalogue_version: 'v1',
  };

  it('finds the sale by its receipt number and refunds what comes back, damaged goods kept out of stock', async () => {
    const giveBack = vi.fn(async (input: PosGiveBack) => ({
      sale: sold,
      refund: { ref: `${sold.ref}-R${giveBack.mock.calls.length}`, kind: 'refund', status: 'done', amount: 100, cash_out: 100, tenders: [{ method: 'cash', amount: 100 }], lines: input.lines ?? [], reason: input.reason, credit_note: null, at: null },
      message: 'Refunded.',
    }));
    const openDrawer = vi.fn(async () => ({ ok: true, printer: 'Thermal', message: 'Drawer opened.' }));
    mount(<ReturnDialog onClose={() => undefined} />, till({ session, caps: { refund: true }, company: { ...till().company!, can: { ...till().company!.can, refund: true } } }), {
      sale: async ({ ref }: { ref: string }) => (ref === sold.ref ? sold : null),
      giveBack,
      openDrawer,
    });
    fireEvent.change(screen.getByLabelText('Receipt number'), { target: { value: 'T1-NOPE' } });
    fireEvent.submit(screen.getByLabelText('Receipt number').closest('form')!);
    expect(await screen.findByText(/No sale T1-NOPE on this till/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Receipt number'), { target: { value: sold.ref } });
    fireEvent.submit(screen.getByLabelText('Receipt number').closest('form')!);
    expect(await screen.findByRole('heading', { name: `Return against ${sold.ref}` })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'One more Wireless mouse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Damaged' }));
    fireEvent.click(screen.getByRole('button', { name: 'One more Notebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'One more Notebook' }));
    const go = screen.getByRole('button', { name: 'Refund about 4,350.00' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Faulty' }));
    fireEvent.click(go);
    await waitFor(() => expect(giveBack).toHaveBeenCalledTimes(2));
    expect(giveBack.mock.calls[0]![0]).toEqual({ ref: sold.ref, kind: 'refund', reason: 'Faulty', lines: [{ product_id: 3, quantity: 2 }] });
    expect(giveBack.mock.calls[1]![0]).toEqual({ ref: sold.ref, kind: 'refund', reason: 'Faulty', lines: [{ product_id: 9, quantity: 1 }], restock: false });
    expect(await screen.findByText('LKR 200.00 given back.')).toBeTruthy();
    expect(openDrawer).toHaveBeenCalled();
  });
});

describe('pairing this computer', () => {
  it('lists the tills, and takes one over only on the button that says so', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            terminals: [
              { id: 1, code: 'POS-01', name: 'Front counter 1', org_id: 3, org_name: 'Acme', branch_name: 'Kollupitiya', warehouse_id: null, warehouse_name: null, in_use: true, device_name: 'FRONT-PC-01' },
              { id: 4, code: 'POS-04', name: 'Pop-up stall', org_id: 3, org_name: 'Acme', branch_name: 'Kollupitiya', warehouse_id: null, warehouse_name: null, in_use: false, device_name: null },
            ],
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const pair = vi.fn(async () => ({ status, message: 'Paired.' }));
    const onChange = vi.fn();
    mount(<Connect status={{ ...status, till: null }} onChange={onChange} />, till(), { pair });
    expect((await screen.findByRole('radio', { name: /Front counter 1/ })).textContent).toContain('In use on FRONT-PC-01');
    expect((screen.getByRole('button', { name: 'Choose a till' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Pop-up stall/ }));
    expect(screen.getByRole('button', { name: 'Pair with POS-04' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Front counter 1/ }));
    expect(screen.getByText(/two devices never hold one till/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take over POS-01 and pair' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(pair).toHaveBeenCalledWith({ terminal_id: 1, take_over: true });
  });
});

describe('the till’s devices', () => {
  it('shows each device and where it stands, and tests the scanner by scanning', async () => {
    const printTest = vi.fn(async () => ({ ok: true, printer: 'Thermal', message: 'Sent to Thermal.' }));
    mount(<TillSettings initial="devices" />, till(), {
      printSettings: async () => ({ receipt_printer: 'Thermal', paper: '80mm', mode: 'escpos', copies: 1, auto_print: true, drawer: 'printer', drawer_pin: 2, header: '', footer: '' }),
      printTest,
    });
    expect(await screen.findByText(/Thermal · ESC\/POS · 80 mm/)).toBeTruthy();
    expect(screen.getByText(/Opened by the receipt printer \(pin 2\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Print test' }));
    await waitFor(() => expect(printTest).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Test scan' }));
    expect(screen.getByText('Scan any barcode now…')).toBeTruthy();
    let at = 1000;
    for (const key of [...'4790001000011', 'Enter']) fireEvent.keyDown(window, { key, timeStamp: (at += 5) });
    expect(await screen.findByText('Read 4790001000011')).toBeTruthy();
  });
});

describe('the customer display', () => {
  it('shows the sale on screen — each line’s unit price, what they pay and the discount — then the change', async () => {
    mount(
      <TabProvider tabId="d" route="/pos/display" active onGo={() => undefined}>
        <CustomerDisplay />
      </TabProvider>,
      till(),
    );
    expect(screen.getByText('Welcome')).toBeTruthy();
    publish({ kind: 'cart', shop: 'Acme', currency: 'LKR', lines: [{ name: 'Ceylon tea', quantity: 2, price: 450, total: 900 }], subtotal: 900, discount: 90, tax: 0, total: 810, provisional: false });
    expect(await screen.findByText('Ceylon tea')).toBeTruthy();
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getByText('450.00 each')).toBeTruthy();
    expect(screen.getByText('You pay')).toBeTruthy();
    expect(screen.getByText('−90.00')).toBeTruthy();
    expect(screen.getByText('LKR 810.00')).toBeTruthy();
    publish({ kind: 'paid', shop: 'Acme', currency: 'LKR', total: 810, paid: 1000, change: 190 });
    expect(await screen.findByText('Your change')).toBeTruthy();
    expect(screen.getByText('190.00')).toBeTruthy();
    publish({ kind: 'idle', shop: 'Acme' });
  });
});
