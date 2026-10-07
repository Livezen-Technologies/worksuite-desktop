// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosSellInput } from '@shared/pos';
import type { PosSession } from '../../../src/modules/pos/api';
import { TillContext, type Till } from '../../../src/modules/pos/parts';
import { estimateCart } from '../../../src/modules/pos/pricing';
import Tender from '../../../src/modules/pos/TenderPanel';

afterEach(() => {
  cleanup();
  delete (window as { worksuite?: unknown }).worksuite;
});

const session: PosSession = {
  id: 41,
  org_id: 3,
  register_id: 3,
  register: 'Front',
  register_code: 'R1',
  terminal_id: 7,
  currency: 'LKR',
  status: 'open',
  opening_float: 5000,
  opened_at: null,
  cashier: 'Kasun',
  closed_at: null,
  closed_by_name: null,
  expected_cash: null,
  counted_cash: null,
  variance: null,
  variance_reason: null,
  note: null,
  denominations: [5000, 1000, 500, 100],
};

function till(offline = false): Till {
  return {
    status: { till: null, waiting: 0, refused: 0, reachable: !offline, last_contact: null, last_sync: null, problem: null, can_queue: true, can_keep: true, catalogue: null },
    options: null,
    company: null,
    caps: {},
    currency: 'LKR',
    session,
    registers: [],
    offline,
    discount: { allowed: false, ceiling: null },
    params: new URLSearchParams(),
    go: () => undefined,
  };
}

const cart = estimateCart([{ product_id: 9, quantity: 2 }], new Map([[9, { id: 9, code: 'TEA', barcode: null, name: 'Ceylon tea', unit: null, category: null, price: 450, discount_pct: 0, tax_rate: 0 }]]), 0, null, 'LKR').cart;

function mount(offline = false, exact = false) {
  const sell = vi.fn(async (input: PosSellInput) => ({
    sale: { ...input, ref: 'T1-AAAAAA-000001', created_at: '2026-09-30T08:00:00Z', terminal_id: 7, cashier_id: 5, cashier_name: 'Kasun', state: offline ? 'waiting' : 'sent', number: offline ? null : 'SO-9', message: null, attempts: 1, sent_at: null },
    queued: offline,
    printed: { ok: true, printer: 'Thermal', message: 'Sent to Thermal.' },
  }));
  (window as { worksuite?: unknown }).worksuite = { platform: 'linux', pos: { sell, printSettings: async () => ({ header: 'Acme Stores', footer: 'Thank you' }) }, events: { on: () => () => undefined }, files: { registerDropped: async () => [] } };
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TillContext.Provider value={till(offline)}>
        <Tender cart={cart} source={offline ? 'estimate' : 'server'} currency="LKR" session={session} customer={null} catalogueVersion="v1" exact={exact} onClose={() => undefined} onDone={onDone} />
      </TillContext.Provider>
    </QueryClientProvider>,
  );
  return { sell, onDone };
}

describe('taking the money', () => {
  it('starts at the exact amount, shows the change for the notes handed over, and completes the sale', async () => {
    const { sell, onDone } = mount();
    const amount = screen.getByLabelText('Amount 1') as HTMLInputElement;
    expect(amount.value).toBe('900');
    fireEvent.click(screen.getByRole('button', { name: '1,000.00' }));
    expect(amount.value).toBe('1,000');
    expect(screen.getAllByText('100.00').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Complete sale · give 100.00 change/ }));
    await waitFor(() => expect(sell).toHaveBeenCalled());
    expect(sell.mock.calls[0]![0]).toMatchObject({ session_id: 41, register_id: 3, currency: 'LKR', tenders: [{ method: 'cash', amount: 1000 }], change_given: 100, priced_by: 'server', totals: { total: 900 } });
    expect(await screen.findByRole('dialog', { name: 'Sale complete' })).toBeTruthy();
    expect(screen.getByText('Give change')).toBeTruthy();
    expect(screen.getByLabelText('T1-AAAAAA-000001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New sale' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('types the cash on the keypad', () => {
    mount();
    const amount = screen.getByLabelText('Amount 1') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: '00' }));
    expect(amount.value).toBe('500');
    expect((screen.getByRole('button', { name: /400.00 still to pay/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('holds Complete while money is still due, and takes the rest on a card', async () => {
    const { sell } = mount();
    fireEvent.change(screen.getByLabelText('Amount 1'), { target: { value: '500' } });
    expect((screen.getByRole('button', { name: /still to pay/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Card' }));
    expect((screen.getByLabelText('Amount 2') as HTMLInputElement).value).toBe('400');
    fireEvent.change(screen.getByLabelText('Reference 2'), { target: { value: 'auth 7788' } });
    const complete = screen.getByRole('button', { name: /^Complete sale$/ }) as HTMLButtonElement;
    expect(complete.disabled).toBe(false);
    fireEvent.click(complete);
    await waitFor(() => expect(sell).toHaveBeenCalled());
    expect(sell.mock.calls[0]![0].tenders).toEqual([{ method: 'cash', amount: 500 }, { method: 'card', amount: 400, reference: 'auth 7788' }]);
    expect(sell.mock.calls[0]![0].change_given).toBe(0);
  });

  it('takes the whole sale on a card when that is the first tender chosen', async () => {
    const { sell } = mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Card' }));
    expect(screen.queryByLabelText('Amount 2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Complete sale$/ }));
    await waitFor(() => expect(sell).toHaveBeenCalled());
    expect(sell.mock.calls[0]![0].tenders).toEqual([{ method: 'card', amount: 900 }]);
  });

  it('offers only cash and card with WorkSuite out of reach, and says the sale waits', async () => {
    mount(true);
    expect(screen.queryByRole('radio', { name: 'Bank transfer' })).toBeNull();
    expect(screen.getAllByRole('radio', { name: 'Card' }).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /^Complete sale$/ }));
    expect(await screen.findAllByText(/kept on this till/)).not.toHaveLength(0);
  });

  it('completes the total in cash at once for Cash exact', async () => {
    const { sell } = mount(false, true);
    await waitFor(() => expect(sell).toHaveBeenCalledTimes(1));
    expect(sell.mock.calls[0]![0]).toMatchObject({ tenders: [{ method: 'cash', amount: 900 }], change_given: 0 });
    expect(await screen.findByText('No change to give')).toBeTruthy();
  });
});

describe('the customer display while paying (#294)', () => {
  it('follows the tenders as they are taken: due, paid, change — then the sale complete', async () => {
    const heard: Array<{ type: string; state?: Record<string, unknown> }> = [];
    const ch = new BroadcastChannel('worksuite-pos-display');
    ch.onmessage = (e: MessageEvent<{ type: string; state?: Record<string, unknown> }>) => heard.push(e.data);
    try {
      const { sell } = mount();
      const states = () => heard.filter((m) => m.type === 'state').map((m) => m.state!);
      await waitFor(() => expect(states().at(-1)).toMatchObject({ kind: 'pay', total: 900, paid: 900, due: 0, change: 0 }));
      expect(states().at(-1)!.lines).toEqual([{ name: 'Ceylon tea', quantity: 2, price: 450, total: 900 }]);
      fireEvent.click(screen.getByRole('button', { name: '1,000.00' }));
      await waitFor(() => expect(states().at(-1)).toMatchObject({ kind: 'pay', paid: 1000, due: 0, change: 100 }));
      fireEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
      await waitFor(() => expect(sell).toHaveBeenCalled());
      await waitFor(() => expect(states().at(-1)).toMatchObject({ kind: 'paid', total: 900, change: 100 }));
    } finally {
      ch.close();
    }
  });
});
