// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosCatalogue } from '@shared/pos';
import type { PosSession } from '../../../src/modules/pos/api';
import { cart, cartActions } from '../../../src/modules/pos/cart';
import { TillContext, type Till } from '../../../src/modules/pos/parts';
import Register from '../../../src/modules/pos/Register';
import { toasts } from '../../../src/core/toasts';

afterEach(() => {
  cleanup();
  cartActions.clear();
  toasts.set({ items: [] });
  delete (window as { worksuite?: unknown }).worksuite;
});

const session = { id: 41, org_id: 3, register_id: 3, register: 'Front', register_code: 'R1', terminal_id: 7, currency: 'LKR', status: 'open', opening_float: 5000 } as PosSession;

const catalogue: PosCatalogue = {
  version: 'v1',
  fetched_at: '2026-09-30T08:00:00Z',
  currency: 'LKR',
  source: 'pos',
  categories: [],
  products: [{ id: 9, code: 'TEA', barcode: '4790001000011', name: 'Ceylon tea', unit: null, category: null, price: 450, discount_pct: 0, tax_rate: 0 }],
  truncated: false,
};

function mount(open: boolean) {
  const go = vi.fn();
  (window as { worksuite?: unknown }).worksuite = { platform: 'linux', pos: { catalogue: async () => catalogue }, events: { on: () => () => undefined } };
  const till: Till = {
    status: { till: null, waiting: 0, refused: 0, reachable: false, last_contact: null, last_sync: null, problem: null, can_queue: true, can_keep: true, catalogue: null },
    options: null,
    company: { id: 3, name: 'Acme', currency: 'LKR', today: null, can: { sell: true, open: true, close: true, cash_in: true, cash_out: true, view_all: false, settings: false, terminals: false } },
    caps: { drawer_required: true },
    currency: 'LKR',
    session: open ? session : null,
    registers: [],
    // Offline: the preview price, no calls to WorkSuite.
    offline: true,
    discount: { allowed: false, ceiling: null },
    params: new URLSearchParams(),
    go,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TillContext.Provider value={till}>
        <Register active={false} />
      </TillContext.Provider>
    </QueryClientProvider>,
  );
  return { go };
}

describe('the register: no drawer, no sale', () => {
  it('starts no sale without an open register, and says how to open one', async () => {
    const { go } = mount(false);
    fireEvent.click(await screen.findByRole('button', { name: /Ceylon tea/ }));
    expect(cart.get().lines).toEqual([]);
    expect(toasts.get().items.at(-1)).toMatchObject({ kind: 'warning', text: 'Open the register before you sell.' });
    expect(screen.getByText(/No register is open at this till, so no sale can be started/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the register' }));
    expect(go).toHaveBeenCalledWith('shift');
  });

  it('sells with a register open', async () => {
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: /Ceylon tea/ }));
    expect(cart.get().lines).toEqual([{ product_id: 9, quantity: 1 }]);
    expect(screen.queryByText(/No register is open/)).toBeNull();
  });
});
