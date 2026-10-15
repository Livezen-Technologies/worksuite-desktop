// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn(async () => true) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost, ApiError } = await import('../../../src/core/api');
const { toast } = await import('../../../src/core/toasts');
const { app } = await import('../../../src/core/app-state');
const { cancelRefusal, REVERSAL_NOTE } = await import('../../../src/modules/billing/actions');
const { default: InvoiceView } = await import('../../../src/modules/billing/InvoiceView');

/*
 * Cancelling an issued invoice (SRS-BIL-001 G-01): the journal is reversed in
 * the same step, which the dialog says before it is done; in a locked period
 * the server refuses with 409 `period_locked` and suggests a credit note,
 * which the dialog offers in place of the cancel.
 */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  app.set({ status: { network: 'ONLINE' } as never, bootstrap: { permissions: ['billing.view', 'billing.manage'] } as never });
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const invoice = {
  id: 361, org_id: 2, number: 'INV-00361', type: 'tax', status: 'sent', client_id: 9, client: 'Green Leaf Hotels', project: null, project_id: null, warehouse_id: null, owner: 'Kasun Perera', owner_id: 3,
  currency: 'LKR', base_currency: 'LKR', exchange_rate: 1, subtotal: 300000, discount: 0, tax_total: 54000, withholding: 12000, total: 342000, paid: 0, credited: 0, due: 342000,
  issue_date: '2026-07-27', due_date: '2026-08-10', po_number: null, file_id: null, sent_at: null, paid_at: null, days_overdue: 0,
  contact: null, contact_email: 'ap@greenleaf.lk', billing_address: null, notes: null, terms: null, payment_terms_days: 14, cancel_reason: null,
  lines: [{ id: 1, product_id: null, description: 'Discovery', quantity: 1, unit_price: 300000, discount_pct: 0, tax_rate_ids: [] }],
  tax_breakdown: [{ name: 'VAT', rate: 18, is_compound: false, amount: 54000 }], allocations: { payments: [], credits: [] }, timeline: [], journal: { id: 2218, journal_no: 'JRN-02218', status: 'posted', reversed: false },
  approval: { status: null, note: null, submitted_by: null, submitted_at: null, approved_by: null, approved_at: null, rule: null, required: null, can_approve: false },
};

function serve() {
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/billing/invoices/361') return { invoice, editable: false };
    if (path === '/api/billing/taxes') return { taxes: [] };
    if (path.endsWith('/pay-link')) return { url: 'https://ws.example.com/pay/i/tok', token: 'tok', expires_at: null };
    if (path === '/api/billing/reminders/log')
      return {
        upcoming: [{ id: null, invoice_id: 361, offset_days: 14, channel: 'email', status: 'scheduled', sent_at: null, due_on: '2026-08-24' }],
        items: [{ id: 5, invoice_id: 361, offset_days: 7, channel: 'email', status: 'sent', sent_at: '2026-08-17 09:00:00' }],
        log: [
          { id: null, invoice_id: 361, offset_days: 14, channel: 'email', status: 'scheduled', sent_at: null, due_on: '2026-08-24' },
          { id: 5, invoice_id: 361, offset_days: 7, channel: 'email', status: 'sent', sent_at: '2026-08-17 09:00:00' },
        ],
        meta: { total: 1 },
      };
    return {};
  });
}

describe('billing: why a cancel was refused', () => {
  it('reads a locked period, with the credit note it suggests', () => {
    const r = cancelRefusal(new ApiError(409, 'The July 2026 period is locked.', 'period_locked', { suggest: 'credit_note' }));
    expect(r).toEqual({ code: 'period_locked', message: 'The July 2026 period is locked.', creditInstead: true });
    // Said only in the errors' data, or only by the status and words.
    expect(cancelRefusal(new ApiError(409, 'Locked.', null, { code: 'period_locked' })).code).toBe('period_locked');
    expect(cancelRefusal(new ApiError(409, 'The accounting period is closed.', null)).code).toBe('period_locked');
  });

  it('reads a paid invoice, and anything else as the server said it', () => {
    expect(cancelRefusal(new ApiError(422, 'It has payments against it.', 'has_payments')).code).toBe('paid');
    expect(cancelRefusal(new ApiError(500, 'Boom.', null))).toEqual({ code: 'other', message: 'Boom.', creditInstead: false });
    expect(cancelRefusal(new Error('')).message).toBe('The invoice could not be cancelled.');
  });
});

describe('billing: cancelling an invoice', () => {
  it('says the journal is reversed, and on a locked period offers a credit note instead', async () => {
    serve();
    // As the server sends it: `code` at the top and in `errors`, with `errors.suggest`.
    vi.mocked(apiPost).mockRejectedValue(new ApiError(409, 'The July 2026 period is locked, so INV-00361 cannot be reversed.', 'period_locked', { code: 'period_locked', period: '2026-07', suggest: 'credit_note' }));
    const onCredit = vi.fn();
    wrap(<InvoiceView id={361} org="2" onClose={vi.fn()} onOpen={vi.fn()} onOpenPayment={vi.fn()} onOpenNote={vi.fn()} onCredit={onCredit} />);

    // The side panel reads the server's shapes: the journal's number, the reminders sent and the next scheduled one.
    const aside = await screen.findByRole('complementary', { name: 'Details' });
    expect(within(aside).getByText('JRN-02218')).toBeTruthy();
    await waitFor(() => expect(aside.textContent).toMatch(/\+7 sent/));
    expect(aside.textContent).toMatch(/Next: \+14/);
    // No approval rule applies, so a draft-only Submit is not offered on an issued invoice either.
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Cancel invoice/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this invoice?' });
    expect(within(dialog).getByText(new RegExp(REVERSAL_NOTE.slice(0, 40)))).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Why?'), { target: { value: 'Wrong company' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/billing/invoices/361/cancel', { reason: 'Wrong company' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('The period is locked');
    expect(alert.textContent).toContain('The July 2026 period is locked');
    expect(alert.textContent).toContain('Raise a credit note for LKR 342,000.00 instead');
    // Nothing was said to have been cancelled, and the cancel cannot be pressed again.
    expect(toast).not.toHaveBeenCalledWith('success', expect.anything());
    expect(within(dialog).queryByRole('button', { name: 'Cancel invoice' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Raise a credit note instead' }));
    expect(onCredit).toHaveBeenCalledTimes(1);
  });

  it('cancels when the period is open, and says the journal was reversed', async () => {
    serve();
    vi.mocked(apiPost).mockResolvedValue({ invoice: { ...invoice, status: 'cancelled' } });
    wrap(<InvoiceView id={361} org="2" onClose={vi.fn()} onOpen={vi.fn()} onOpenPayment={vi.fn()} onOpenNote={vi.fn()} onCredit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Cancel invoice/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this invoice?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'INV-00361 cancelled; its journal was reversed.'));
  });
});
