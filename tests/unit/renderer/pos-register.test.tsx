// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosCatalogue } from '@shared/pos';
import type { PosSession } from '../../../src/modules/pos/api';
import { activeCart, cartActions, carts } from '../../../src/modules/pos/cart';
import { displayTouch } from '../../../src/modules/pos/display';
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

  it('narrows the grid behind the picker as soon as a category is pointed at, and Enter applies it (#295)', async () => {
    mount(true, many);
    fireEvent.click(await screen.findByRole('button', { name: /Category/ }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a category' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Spices/ }));
    // The dialog stays open on the category's preview; the grid behind already shows its eight.
    expect(screen.getByRole('dialog', { name: 'Choose a category' })).toBeTruthy();
    expect(screen.getByText('Showing 1–8 of 8 · swipe or use the arrows')).toBeTruthy();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: /Tea/ }), { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Choose a category' })).toBeNull();
    expect(screen.getByText('Showing 1–12 of 12 · swipe or use the arrows')).toBeTruthy();
    // Esc in the search clears it.
    fireEvent.keyDown(screen.getByPlaceholderText(/Search products/), { key: 'Escape' });
    expect(screen.getByText('Showing 1–15 of 20 · swipe or use the arrows')).toBeTruthy();
  });

  it('counts a group of the tree from the till\'s own products, and narrows to everything below it (#295)', async () => {
    mount(true, {
      ...many,
      category_tree: [
        // The server counts all of Inventory (40); the till holds three of them.
        { id: '10', name: 'Antivirus & Security', parent_id: null, product_count: 40, children: [{ id: '11', name: 'Kaspersky', parent_id: '10', product_count: 30, children: [] }] },
        { id: '20', name: 'Office', parent_id: null, product_count: 99, children: [] },
      ],
      products: many.products.map((p, i) => ({ ...p, category_id: i === 0 ? '10' : i < 3 ? '11' : '20' })),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Category/ }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a category' });
    const group = within(dialog).getByRole('button', { name: /Antivirus/ });
    expect(group.textContent).toContain('3');
    expect(group.textContent).not.toContain('40');
    fireEvent.click(group);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show all 3' }));
    expect(screen.getByText('Showing 1–3 of 3 · swipe or use the arrows')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Product 04/ })).toBeNull();
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

describe('the customer display’s phone entry, at the register (#294)', () => {
  function online(desk: (op: { op: string; [k: string]: unknown }) => unknown) {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline in tests');
    });
    (window as { worksuite?: unknown }).worksuite = { platform: 'linux', pos: { catalogue: async () => catalogue, desk: async (op: { op: string }) => desk(op) }, events: { on: () => () => undefined } };
    const till: Till = {
      status: { till: null, waiting: 0, refused: 0, reachable: true, last_contact: null, last_sync: null, problem: null, can_queue: true, can_keep: true, catalogue: null },
      options: null,
      company: { id: 3, name: 'Acme', currency: 'LKR', today: null, can: { sell: true, open: true, close: true, cash_in: true, cash_out: true, view_all: false, settings: false, terminals: false } },
      caps: { drawer_required: true, customers: true, display_phone: true },
      currency: 'LKR',
      session,
      registers: [],
      offline: false,
      discount: { allowed: false, ceiling: null },
      params: new URLSearchParams(),
      go: vi.fn(),
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TillContext.Provider value={till}>
          <Register active />
        </TillContext.Provider>
      </QueryClientProvider>,
    );
  }

  /** The display's end of the channel, as a test. */
  function display() {
    const heard: Array<Record<string, unknown>> = [];
    const ch = new BroadcastChannel('worksuite-pos-display');
    ch.onmessage = (e: MessageEvent<Record<string, unknown>>) => heard.push(e.data);
    opened.push(ch);
    return { heard, say: (m: Record<string, unknown>) => ch.postMessage(m) };
  }
  const opened: BroadcastChannel[] = [];
  afterEach(() => {
    for (const c of opened.splice(0)) c.close();
    vi.unstubAllGlobals();
  });

  const card = { id: 41, name: 'Hasarinda Mendis', phone: '0767793692', email: 'has@example.com', points_balance: 0 };

  it('looks the number up, sends the display only the masked match, and puts the confirmed customer on the sale', async () => {
    const asked: Array<{ op: string }> = [];
    online((op) => {
      asked.push(op);
      if (op.op === 'byPhone') return { status: 200, body: { items: [{ id: 41, masked: 'Has*****a M.', name: 'Hasarinda Mendis' }] } };
      if (op.op === 'customer') return { status: 200, body: { customer: card } };
      return { status: 404, body: null };
    });
    const d = display();
    fireEvent.click(await screen.findByRole('button', { name: /Ceylon tea/ }));
    await vi.waitFor(() => expect(d.heard.some((m) => m.type === 'state' && (m.state as { phone?: boolean }).phone === true)).toBe(true));
    const shown = d.heard.filter((m) => m.type === 'state').at(-1)!.state as { lines: Array<{ price?: number }> };
    expect(shown.lines[0]!.price).toBe(450);

    d.say({ type: 'phone', ticket: 't1', phone: '+94767793692' });
    await vi.waitFor(() => expect(d.heard).toContainEqual({ type: 'phoneResult', ticket: 't1', result: { kind: 'matches', items: [{ id: 41, masked: 'Has*****a M.' }] } }));
    expect(asked).toContainEqual({ op: 'byPhone', phone: '+94767793692' });

    d.say({ type: 'confirm', ticket: 't1', id: 41 });
    expect(await screen.findByText('The customer confirmed their number at the display: Has*****a M. is on the sale.')).toBeTruthy();
    expect(activeCart().customer).toMatchObject({ id: 41, name: 'Hasarinda Mendis' });
    await vi.waitFor(() => expect(d.heard.some((m) => m.type === 'state' && (m.state as { customer?: string }).customer === 'Has*****a M.')).toBe(true));
    // Whatever the register knows, the display heard only the masked name.
    const said = JSON.stringify(d.heard);
    for (const never of ['Hasarinda', 'Mendis', 'has@example.com', '0767793692']) expect(said).not.toContain(never);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(screen.queryByText(/confirmed their number/)).toBeNull();

    d.say({ type: 'notMe' });
    await vi.waitFor(() => expect(activeCart().customer).toBeNull());
    expect(toasts.get().items.at(-1)).toMatchObject({ text: 'The customer said that is not them: the sale is a walk-in again.' });
  });

  it('asks the cashier to create a customer for a number not on file, the number filled in', async () => {
    online((op) => (op.op === 'byPhone' ? { status: 200, body: { items: [] } } : { status: 404, body: null }));
    const d = display();
    fireEvent.click(await screen.findByRole('button', { name: /Ceylon tea/ }));
    d.say({ type: 'phone', ticket: 't2', phone: '+94112345678' });
    await vi.waitFor(() => expect(d.heard).toContainEqual({ type: 'phoneResult', ticket: 't2', result: { kind: 'none' } }));
    d.say({ type: 'newNumber', ticket: 't2', phone: '+94112345678' });
    fireEvent.click(await screen.findByRole('button', { name: 'Create customer' }));
    expect((screen.getByLabelText('Mobile') as HTMLInputElement).value).toBe('+94112345678');
  });

  it('lets the cashier ask for the number on the display — with a touch screen there', async () => {
    online(() => ({ status: 404, body: null }));
    const d = display();
    fireEvent.click(await screen.findByRole('button', { name: /Ceylon tea/ }));
    d.say({ type: 'touch', touch: true });
    await vi.waitFor(() => expect(displayTouch.get().touch).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const ask = await screen.findByRole('menuitem', { name: /Ask customer for phone number/ });
    expect(ask.getAttribute('aria-disabled')).not.toBe('true');
    expect((ask as HTMLButtonElement).disabled ?? false).toBe(false);
    fireEvent.click(ask);
    await vi.waitFor(() => expect(d.heard).toContainEqual({ type: 'ask' }));
  });
});
