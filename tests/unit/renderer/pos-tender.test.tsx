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

function mount(offline = false) {
  const sell = vi.fn(async (input: PosSellInput) => ({
    sale: { ...input, ref: 'T1-AAAAAA-000001', created_at: '2026-09-30T08:00:00Z', terminal_id: 7, cashier_id: 5, cashier_name: 'Kasun', state: offline ? 'waiting' : 'sent', number: offline ? null : 'SO-9', message: null, attempts: 1, sent_at: null },
    queued: offline,
    printed: { ok: true, printer: 'Thermal', message: 'Sent to Thermal.' },
  }));
  (window as { worksuite?: unknown }).worksuite = { platform: 'linux', pos: { sell }, events: { on: () => () => undefined }, files: { registerDropped: async () => [] } };
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TillContext.Provider value={till(offline)}>
        <Tender cart={cart} source={offline ? 'estimate' : 'server'} currency="LKR" session={session} customer={null} catalogueVersion="v1" onClose={() => undefined} onDone={onDone} />
      </TillContext.Provider>
    </QueryClientProvider>,
  );
  return { sell, onDone };
}

describe('taking the money', () => {
  it('starts at the exact amount, shows the change for the notes handed over, and completes the sale', async () => {
    const { sell } = mount();
    const amount = screen.getByLabelText('Amount 1') as HTMLInputElement;
    expect(amount.value).toBe('900.00');
    fireEvent.click(screen.getByRole('button', { name: '1,000.00' }));
    expect(amount.value).toBe('1000.00');
    expect(screen.getAllByText('100.00').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    await waitFor(() => expect(sell).toHaveBeenCalled());
    expect(sell.mock.calls[0]![0]).toMatchObject({ session_id: 41, register_id: 3, currency: 'LKR', tenders: [{ method: 'cash', amount: 1000 }], change_given: 100, priced_by: 'server', totals: { total: 900 } });
    await screen.findByText('LKR 100.00');
    expect(screen.getByRole('button', { name: 'New sale' })).toBeTruthy();
  });

  it('holds Complete while money is still due, and splits the rest onto a card', async () => {
    const { sell } = mount();
    fireEvent.change(screen.getByLabelText('Amount 1'), { target: { value: '500' } });
    const complete = screen.getByRole('button', { name: /Complete sale/ }) as HTMLButtonElement;
    expect(complete.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect((screen.getByLabelText('Amount 2') as HTMLInputElement).value).toBe('400.00');
    fireEvent.change(screen.getByLabelText('Reference 2'), { target: { value: 'auth 7788' } });
    expect(complete.disabled).toBe(false);
    fireEvent.click(complete);
    await waitFor(() => expect(sell).toHaveBeenCalled());
    expect(sell.mock.calls[0]![0].tenders).toEqual([{ method: 'cash', amount: 500 }, { method: 'card', amount: 400, reference: 'auth 7788' }]);
    expect(sell.mock.calls[0]![0].change_given).toBe(0);
  });

  it('offers only cash and card with WorkSuite out of reach, and says the sale waits', async () => {
    mount(true);
    expect(screen.queryByRole('radio', { name: 'Bank transfer' })).toBeNull();
    expect(screen.getAllByRole('radio', { name: 'Card' }).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    expect(await screen.findAllByText(/kept on this till/)).not.toHaveLength(0);
  });
});
