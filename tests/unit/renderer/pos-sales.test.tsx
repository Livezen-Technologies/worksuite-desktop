// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosGiveBack, PosSale } from '@shared/pos';
import type { PosCan, PosCapabilities, PosSession } from '../../../src/modules/pos/api';
import { TillContext, type Till } from '../../../src/modules/pos/parts';
import Sales from '../../../src/modules/pos/Sales';

afterEach(() => {
  cleanup();
  delete (window as { worksuite?: unknown }).worksuite;
});

const session = { id: 41, org_id: 3, register_id: 3, register: 'Front', register_code: 'R1', terminal_id: 7, currency: 'LKR', status: 'open', opening_float: 5000 } as PosSession;

const sale: PosSale = {
  ref: 'T1-AAAAAA-000001',
  created_at: '2026-09-30T08:00:00.000Z',
  terminal_id: 7,
  cashier_id: 5,
  cashier_name: 'Kasun',
  state: 'sent',
  number: 'SO-1',
  message: null,
  attempts: 1,
  sent_at: '2026-09-30T08:00:01.000Z',
  session_id: 41,
  register_id: 3,
  currency: 'LKR',
  customer: { name: 'Nimal', email: 'nimal@example.com' },
  lines: [
    { product_id: 9, code: 'TEA', name: 'Ceylon tea', quantity: 2, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 900, tax: 0, total: 900 },
    { product_id: 3, code: 'MUG', name: 'Mug', quantity: 1, unit_price: 100, discount_pct: 0, tax_rate: 0, net: 100, tax: 0, total: 100 },
  ],
  discount_pct: 0,
  totals: { subtotal: 1000, discount: 0, tax: 0, total: 1000 },
  tenders: [{ method: 'cash', amount: 1000 }],
  change_given: 0,
  priced_by: 'estimate',
  catalogue_version: 'v1',
  server_total: 980,
  review: 'The till charged 1,000.00; WorkSuite priced it 980.00.',
};

const CAN: PosCan = { sell: true, open: true, close: true, cash_in: true, cash_out: true, view_all: false, settings: false, terminals: false, refund: true, void: true, discount: false };

function mount(o: { caps?: PosCapabilities; can?: Partial<PosCan>; inShift?: boolean; noShift?: boolean; sales?: PosSale[]; open?: string } = {}) {
  const giveBack = vi.fn(async (input: PosGiveBack) => ({
    sale: { ...sale, returns: [] },
    refund: { ref: `${sale.ref}-R1`, kind: input.kind, status: 'done', amount: 450, cash_out: 450, tenders: [{ method: 'cash', amount: 450 }], lines: input.lines ?? [], reason: input.reason, credit_note: 'CN-4', at: null },
    message: 'Refunded.',
  }));
  const printReceipt = vi.fn(async () => ({ ok: true, printer: 'Thermal', message: 'Sent to Thermal.' }));
  const openDrawer = vi.fn(async () => ({ ok: true, printer: 'Thermal', message: 'Drawer opened.' }));
  const email = vi.fn(async () => ({ message: 'The receipt was sent.' }));
  const resolve = vi.fn(async () => ({}));
  const list = o.sales ?? [sale];
  (window as { worksuite?: unknown }).worksuite = { platform: 'linux', pos: { sales: async () => list, giveBack, printReceipt, openDrawer, email, resolve }, events: { on: () => () => undefined } };
  const till: Till = {
    status: { till: null, waiting: 0, refused: 0, reachable: true, last_contact: null, last_sync: null, problem: null, can_queue: true, can_keep: true, catalogue: null },
    options: null,
    company: { id: 3, name: 'Acme', currency: 'LKR', today: null, can: { ...CAN, ...o.can } },
    caps: o.caps ?? { refund: true, void: true, receipt: true, email_receipt: true },
    currency: 'LKR',
    session: o.noShift ? null : o.inShift === false ? { ...session, id: 99 } : session,
    registers: [],
    offline: false,
    discount: { allowed: false, ceiling: null },
    params: new URLSearchParams(`view=sales&sale=${o.open ?? sale.ref}`),
    go: () => undefined,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TillContext.Provider value={till}>
        <Sales />
      </TillContext.Provider>
    </QueryClientProvider>,
  );
  return { giveBack, printReceipt, openDrawer, email, resolve };
}

describe('Sales history: after the sale', () => {
  it('shows WorkSuite’s total and its review flag', async () => {
    mount();
    expect(await screen.findByText(/The till charged 1,000.00; WorkSuite priced it 980.00/)).toBeTruthy();
    expect(screen.getByText('WorkSuite’s total')).toBeTruthy();
    expect(screen.getAllByText('Price differs').length).toBeGreaterThan(0);
  });

  it('refunds some lines with the reason, and shows how the money went back', async () => {
    const { giveBack, openDrawer } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Refund' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Some items' }));
    fireEvent.change(screen.getByLabelText('Quantity Ceylon tea'), { target: { value: '1' } });
    const go = screen.getAllByRole('button', { name: 'Refund' }).at(-1) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Damaged pack' } });
    fireEvent.click(go);
    await waitFor(() => expect(giveBack).toHaveBeenCalled());
    expect(giveBack.mock.calls[0]![0]).toEqual({ ref: sale.ref, kind: 'refund', reason: 'Damaged pack', lines: [{ product_id: 9, quantity: 1 }] });
    expect(await screen.findByText('LKR 450.00 given back.')).toBeTruthy();
    expect(screen.getByText('LKR 450.00 in cash from the drawer')).toBeTruthy();
    expect(openDrawer).toHaveBeenCalled();
  });

  it('voids only in the sale’s own open shift', async () => {
    mount({ inShift: false });
    await screen.findByRole('button', { name: 'Refund' });
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
    expect(screen.getByText(/voided in its own shift/)).toBeTruthy();
    cleanup();
    mount();
    expect(await screen.findByRole('button', { name: 'Void' })).toBeTruthy();
  });

  it('offers neither where the server or the person cannot, and reprints WorkSuite’s receipt where it has one', async () => {
    const { printReceipt } = mount({ caps: { receipt: true }, can: { refund: false } });
    fireEvent.click(await screen.findByRole('button', { name: 'Reprint' }));
    await waitFor(() => expect(printReceipt).toHaveBeenCalledWith({ ref: sale.ref, reprint: true, server: true }));
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
    expect(screen.getByText(/Refunds and voids are not available/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'E-mail receipt' })).toBeNull();
  });

  it('e-mails the receipt to the customer’s address', async () => {
    const { email } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'E-mail receipt' }));
    expect((screen.getByLabelText('E-mail address') as HTMLInputElement).value).toBe('nimal@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(email).toHaveBeenCalledWith({ ref: sale.ref, email: 'nimal@example.com' }));
  });
});

describe('Sales history: flags and refusals', () => {
  const late: PosSale = { ...sale, ref: 'T1-AAAAAA-000002', server_total: null, review: 'Sold 2026-09-30 07:55 UTC while register session 40 was open; reached WorkSuite after it closed.', flags: ['late'] };
  const unpaid: PosSale = { ...sale, ref: 'T1-AAAAAA-000003', server_total: null, review: 'No payment was sent with this sale.', flags: ['payment_missing'] };
  const plainSale: PosSale = { ...sale, ref: 'T1-AAAAAA-000004', server_total: null, review: null };
  const refused: PosSale = { ...sale, ref: 'T1-AAAAAA-000005', state: 'refused', number: null, server_total: null, review: null, code: 'drawer_closed', message: 'That register was closed before this sale was made.' };

  it('shows each flag, and filters by the kind of review', async () => {
    mount({ sales: [sale, late, unpaid, plainSale], open: late.ref });
    expect(await screen.findByText(/Sold while a register that has since closed was open/)).toBeTruthy();
    expect(screen.getAllByText('Late').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Payment missing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Price differs').length).toBeGreaterThan(0);
    expect(screen.getByText(plainSale.ref)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'To review' }));
    expect(screen.queryByText(plainSale.ref)).toBeNull();
    expect(screen.getByText(unpaid.ref)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Payment missing' }));
    expect(screen.getByText(unpaid.ref)).toBeTruthy();
    expect(screen.queryByText(sale.ref)).toBeNull();
    expect(screen.getAllByText(late.ref)).toHaveLength(1); // only the open detail's heading

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByText(plainSale.ref)).toBeTruthy();
  });

  it('says why a sale was refused for its drawer, and sends it again into the register open now', async () => {
    const { resolve } = mount({ sales: [refused], open: refused.ref });
    expect(await screen.findByText(/No register was open for this sale when it reached WorkSuite/)).toBeTruthy();
    expect(screen.getByText(/That register was closed before this sale was made/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ ref: refused.ref, action: 'retry', session_id: 41 }));
  });

  it('asks for the register to be opened before sending such a sale again, and lets it be dropped', async () => {
    const { resolve } = mount({ sales: [refused], open: refused.ref, noShift: true });
    expect(await screen.findByText('Open the register at this till to send it again.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send again' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ ref: refused.ref, action: 'drop' }));
  });
});
