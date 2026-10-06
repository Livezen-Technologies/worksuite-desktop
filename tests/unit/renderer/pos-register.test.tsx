// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosCatalogue } from '@shared/pos';
import type { PosSession } from '../../../src/modules/pos/api';
import { activeCart, cartActions, carts } from '../../../src/modules/pos/cart';
import { TillContext, type Till } from '../../../src/modules/pos/parts';
import Register from '../../../src/modules/pos/Register';
import { toasts } from '../../../src/core/toasts';

afterEach(() => {
  cleanup();
  cartActions.reset();
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

function mount(open: boolean, cat: PosCatalogue = catalogue) {
  const go = vi.fn();
  (window as { worksuite?: unknown }).worksuite = { platform: 'linux', pos: { catalogue: async () => cat }, events: { on: () => () => undefined } };
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
        <Register active />
      </TillContext.Provider>
    </QueryClientProvider>,
  );
  return { go };
}

describe('the register: no drawer, no sale', () => {
  it('starts no sale without an open register, and says how to open one', async () => {
    const { go } = mount(false);
    fireEvent.click(await screen.findByRole('button', { name: /Ceylon tea/ }));
    expect(activeCart().lines).toEqual([]);
    expect(toasts.get().items.at(-1)).toMatchObject({ kind: 'warning', text: 'Open the register before you sell.' });
    expect(screen.getByText(/No register is open at this till, so no sale can be started/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the register' }));
    expect(go).toHaveBeenCalledWith('shift');
  });

  it('sells with a register open', async () => {
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: /Ceylon tea/ }));
    expect(activeCart().lines).toEqual([{ product_id: 9, quantity: 1 }]);
    expect(screen.queryByText(/No register is open/)).toBeNull();
  });
});

const many: PosCatalogue = {
  ...catalogue,
  categories: ['Tea', 'Spices'],
  products: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, code: `P${i + 1}`, barcode: null, name: `Product ${String(i + 1).padStart(2, '0')}`, unit: 'each', category: i < 12 ? 'Tea' : 'Spices', price: 100 + i, discount_pct: i === 0 ? 10 : 0, tax_rate: 0 })),
};

describe('the counter', () => {
  it('pages the products fifteen at a time', async () => {
    mount(true, many);
    await screen.findByRole('button', { name: /Product 01/ });
    expect(screen.getByText('Showing 1–15 of 20 · swipe or use the arrows')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Product 16/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Product 01/ }).textContent).toContain('−10%');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('button', { name: /Product 16/ })).toBeTruthy();
    expect(screen.getByText('Showing 16–20 of 20 · swipe or use the arrows')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(screen.getByRole('button', { name: /Product 01/ })).toBeTruthy();
  });

  it('narrows the grid to a category picked with its count', async () => {
    mount(true, many);
    fireEvent.click(await screen.findByRole('button', { name: /Category/ }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a category' });
    expect(dialog.textContent).toContain('Spices8');
    fireEvent.click(screen.getByRole('button', { name: /Spices/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(screen.queryByRole('dialog', { name: 'Choose a category' })).toBeNull();
    expect(screen.getByText('Showing 1–8 of 8 · swipe or use the arrows')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Product 01/ })).toBeNull();
  });

  it('rings up two sales side by side, and holds one', async () => {
    mount(true, many);
    fireEvent.click(await screen.findByRole('button', { name: /Product 01/ }));
    fireEvent.click(screen.getByRole('button', { name: 'New sale' }));
    expect(carts.get().sales).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Product 02/ }));
    expect(activeCart().lines).toEqual([{ product_id: 2, quantity: 1 }]);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    fireEvent.click(tabs[0]!);
    expect(activeCart().lines).toEqual([{ product_id: 1, quantity: 1 }]);
    fireEvent.keyDown(window, { key: '2', ctrlKey: true });
    expect(activeCart().lines).toEqual([{ product_id: 2, quantity: 1 }]);

    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    fireEvent.change(screen.getByLabelText(/Why \(optional\)/), { target: { value: 'Back in five' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Hold this sale' })).getByRole('button', { name: 'Hold' }));
    expect(carts.get().held).toMatchObject([{ note: 'Back in five', cart: { lines: [{ product_id: 2, quantity: 1 }] } }]);
    expect(carts.get().sales).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Recall · 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recall' }));
    expect(carts.get().held).toEqual([]);
    expect(activeCart().lines).toEqual([{ product_id: 2, quantity: 1 }]);
  });
});
