// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosTillStatus } from '@shared/pos';
import type { PosRegister, PosSession } from '../../../src/modules/pos/api';
import { cartActions } from '../../../src/modules/pos/cart';
import CashMove from '../../../src/modules/pos/CashMove';
import { TillContext, type Till } from '../../../src/modules/pos/parts';
import Shift from '../../../src/modules/pos/ShiftScreen';

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

function mount(node: ReactNode, t: Till) {
  (window as { worksuite?: unknown }).worksuite = {
    platform: 'linux',
    pos: { sales: async () => [], printSettings: async () => ({ receipt_printer: 'Thermal', header: '', footer: '' }), openDrawer: async () => ({ ok: true, printer: 'Thermal', message: 'Drawer opened.' }) },
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
