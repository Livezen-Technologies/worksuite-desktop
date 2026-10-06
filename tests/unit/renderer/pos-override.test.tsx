// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosDeskOp, PosSellInput } from '@shared/pos';
import type { PosSession } from '../../../src/modules/pos/api';
import { TillContext, type Till } from '../../../src/modules/pos/parts';
import { estimateCart } from '../../../src/modules/pos/pricing';
import Tender from '../../../src/modules/pos/TenderPanel';

afterEach(() => {
  cleanup();
  delete (window as { worksuite?: unknown }).worksuite;
});

const session = { id: 41, org_id: 3, register_id: 3, register: 'Front', register_code: 'R1', terminal_id: 7, currency: 'LKR', status: 'open', opening_float: 5000, opened_at: null, cashier: 'Kasun', closed_at: null, closed_by_name: null, expected_cash: null, counted_cash: null, variance: null, variance_reason: null, note: null, denominations: [1000, 500] } as PosSession;

function till(caps: Till['caps'] = { approvals: true, remote_approvals: true }): Till {
  return {
    status: { till: null, waiting: 0, refused: 0, reachable: true, last_contact: null, last_sync: null, problem: null, can_queue: true, can_keep: true, catalogue: null },
    options: null,
    company: null,
    caps,
    currency: 'LKR',
    session,
    registers: [],
    offline: false,
    discount: { allowed: true, ceiling: 10 },
    params: new URLSearchParams(),
    go: () => undefined,
  };
}

const cart = estimateCart([{ product_id: 9, quantity: 2 }], new Map([[9, { id: 9, code: 'TEA', barcode: null, name: 'Ceylon tea', unit: null, category: null, price: 500, discount_pct: 0, tax_rate: 0 }]]), 15, null, 'LKR').cart;

function mount() {
  const sell = vi.fn(async (input: PosSellInput) =>
    input.approval_id
      ? { sale: { ...input, ref: 'T1-AAAAAA-000002', created_at: '2026-09-30T08:00:00Z', terminal_id: 7, cashier_id: 5, cashier_name: 'Kasun', state: 'sent', number: 'SO-9', message: null, attempts: 1, sent_at: null }, queued: false, printed: null }
      : { needs: { code: 'approval_required', message: 'A discount of 15% needs a manager’s approval (over 10%).', ask: { action: 'discount', amount: 15, threshold: 10, subject: null } } },
  );
  const desk = vi.fn(async (op: PosDeskOp) => {
    if (op.op === 'approvers') return { status: 200, body: { items: [{ id: 3, name: 'Dilini W.', initials: 'DW', has_pin: true }, { id: 4, name: 'Ishara J.', initials: 'IJ', has_pin: false }] } };
    if (op.op === 'ask') return { status: 201, body: { request: { id: 77, status: 'pending' } } };
    if (op.op === 'cancel') return { status: 200, body: { request: { id: 77, status: 'cancelled' } } };
    return { status: 404, body: null };
  });
  const approve = vi.fn(async () => ({ status: 201, body: { approval_id: 'apv_0123456789abcdef', expires_at: '2099-01-01 00:00:00', approver: { id: 3, name: 'Dilini W.' } } }));
  (window as { worksuite?: unknown }).worksuite = { platform: 'linux', pos: { sell, desk, approve, printSettings: async () => ({ header: '', footer: '' }) }, events: { on: () => () => undefined }, files: { registerDropped: async () => [] } };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TillContext.Provider value={till()}>
        <Tender cart={cart} source="server" currency="LKR" session={session} customer={null} catalogueVersion="v1" onClose={() => undefined} onDone={() => undefined} />
      </TillContext.Provider>
    </QueryClientProvider>,
  );
  return { sell, desk, approve };
}

describe('a manager’s override at the till', () => {
  it('asks a manager when WorkSuite refuses the discount, takes their PIN once, and sends the sale again with the approval', async () => {
    const { sell, approve } = mount();
    fireEvent.click(screen.getByRole('button', { name: /^Complete sale$/ }));
    expect(await screen.findByRole('dialog', { name: 'A manager needs to approve this' })).toBeTruthy();
    expect(screen.getByText('A discount of 15% needs a manager’s approval (over 10%).')).toBeTruthy();
    // The only manager with a PIN is chosen already; one without a PIN cannot be picked at the counter.
    const dilini = await screen.findByRole('radio', { name: /Dilini W\./ });
    await waitFor(() => expect(dilini.getAttribute('aria-checked')).toBe('true'));
    expect((screen.getByRole('radio', { name: /Ishara J\./ }) as HTMLButtonElement).disabled).toBe(true);
    for (const k of ['4', '8', '2', '1']) fireEvent.click(screen.getByRole('button', { name: k }));
    expect(screen.getByRole('status', { name: '4 digits typed' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Loyal customer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(sell).toHaveBeenCalledTimes(2));
    expect(approve).toHaveBeenCalledWith({ approver_id: 3, pin: '4821', action: 'discount', amount: 15, reason: 'Loyal customer' });
    expect(sell.mock.calls[0]![0]).not.toHaveProperty('approval_id');
    expect(sell.mock.calls[1]![0]).toMatchObject({ approval_id: 'apv_0123456789abcdef', discount_pct: 15 });
    expect(await screen.findByRole('dialog', { name: 'Sale complete' })).toBeTruthy();
  });

  it('sends the request to the managers instead, and withdraws it when the cashier gives up', async () => {
    const { desk } = mount();
    fireEvent.click(screen.getByRole('button', { name: /^Complete sale$/ }));
    await screen.findByRole('dialog', { name: 'A manager needs to approve this' });
    fireEvent.click(screen.getByRole('button', { name: 'Send to a manager' }));
    expect(await screen.findByText(/Waiting for one of them/)).toBeTruthy();
    expect(desk).toHaveBeenCalledWith({ op: 'ask', action: 'discount', amount: 15 });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(desk).toHaveBeenCalledWith({ op: 'cancel', id: 77 }));
  });
});
