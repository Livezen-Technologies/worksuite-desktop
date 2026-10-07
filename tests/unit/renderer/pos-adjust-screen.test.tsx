// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PosDeskOp, PosSellInput } from '@shared/pos';
import type { PosCapabilities, PosSession } from '../../../src/modules/pos/api';
import { activeCart, cartActions, carts, initialCarts } from '../../../src/modules/pos/cart';
import { CouponDialog, DiscountEditor } from '../../../src/modules/pos/DiscountEditor';
import { TillContext, type Till } from '../../../src/modules/pos/parts';
import { estimateCart, type PricedCart } from '../../../src/modules/pos/pricing';
import Tender from '../../../src/modules/pos/TenderPanel';

const validate = vi.hoisted(() => vi.fn());
vi.mock('../../../src/modules/pos/api', async (orig) => ({ ...(await orig<Record<string, unknown>>()), validateCoupon: validate }));

/**
 * #293 on the payment screen: the adjustments under the total (added and taken off, the payment following at once), the
 * shared discount editor (percentage, fixed amount, the ceiling, a manager past it), the coupon's specific refusals,
 * the gift voucher's tile and expiry, and what waits while WorkSuite is out of reach.
 */
beforeEach(() => {
  carts.set(initialCarts());
  validate.mockReset();
});

afterEach(() => {
  cleanup();
  delete (window as { worksuite?: unknown }).worksuite;
});

const session = { id: 41, org_id: 3, register_id: 3, register: 'Front', register_code: 'R1', terminal_id: 7, currency: 'LKR', status: 'open', opening_float: 5000, opened_at: null, cashier: 'Kasun', closed_at: null, closed_by_name: null, expected_cash: null, counted_cash: null, variance: null, variance_reason: null, note: null, denominations: [1000, 500] } as PosSession;
const products = new Map([[9, { id: 9, code: 'TEA', barcode: null, name: 'Ceylon tea', unit: null, category: null, price: 500, discount_pct: 0, tax_rate: 0 }]]);
const priced = (amount: number | null = null, pct = 0): PricedCart => estimateCart([{ product_id: 9, quantity: 2 }], products, pct, null, 'LKR', amount).cart;

function till(o: { offline?: boolean; caps?: PosCapabilities; rights?: Till['discount'] } = {}): Till {
  return {
    status: { till: null, waiting: 0, refused: 0, reachable: !o.offline, last_contact: null, last_sync: null, problem: null, can_queue: true, can_keep: true, catalogue: null },
    options: null,
    company: null,
    caps: o.caps ?? { discount_amount: true, coupons: true, coupon_validate: true, vouchers: true, voucher_accept: true, promotions: true },
    currency: 'LKR',
    session,
    registers: [],
    offline: !!o.offline,
    discount: o.rights ?? { allowed: true, ceiling: null },
    params: new URLSearchParams(),
    go: () => undefined,
  };
}

function bridge(desk: (op: PosDeskOp) => Promise<unknown> = async () => ({ status: 404, body: null })) {
  const sell = vi.fn(async (input: PosSellInput) => ({
    sale: { ...input, ref: 'T1-AAAAAA-000009', created_at: '2026-10-07T08:00:00Z', terminal_id: 7, cashier_id: 5, cashier_name: 'Kasun', state: 'sent', number: 'SO-9', message: null, attempts: 1, sent_at: null },
    queued: false,
    printed: null,
  }));
  (window as { worksuite?: unknown }).worksuite = { platform: 'linux', pos: { sell, desk, printSettings: async () => ({ header: '', footer: '' }) }, events: { on: () => () => undefined }, files: { registerDropped: async () => [] } };
  return { sell };
}

function screenOf(cart: PricedCart, o: Parameters<typeof till>[0] = {}, extras = {}) {
  const value = till(o);
  const qc = new QueryClient();
  const tree = (c: PricedCart) => (
    <QueryClientProvider client={qc}>
      <TillContext.Provider value={value}>
        <Tender cart={c} source={o.offline ? 'estimate' : 'server'} currency="LKR" session={session} customer={null} catalogueVersion="v1" extras={extras} onClose={() => undefined} onDone={() => undefined} />
      </TillContext.Provider>
    </QueryClientProvider>
  );
  const r = render(tree(cart));
  return { rerender: (c: PricedCart) => r.rerender(tree(c)) };
}

describe('the adjustments under the total', () => {
  it('shows the subtotal, adds a fixed discount with its reason in the shared editor, and the payment follows the new total', async () => {
    bridge();
    cartActions.add(9, 2);
    const view = screenOf(priced());
    expect((screen.getByLabelText('Amount 1') as HTMLInputElement).value).toBe('1,000');
    fireEvent.click(screen.getByRole('button', { name: /Add discount/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Amount' }));
    fireEvent.change(screen.getByLabelText('Discount amount'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Damaged box' } });
    expect(screen.getByText('15% of the sale')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take 150.00 off' }));
    expect(activeCart()).toMatchObject({ discount: '150', discount_type: 'amount', discount_reason: 'Damaged box' });

    // WorkSuite prices the cart again: the line, its reason, the new total, and what is still to pay.
    view.rerender(priced(150));
    expect(screen.getByText('Damaged box')).toBeTruthy();
    expect(screen.getAllByText('−150.00').length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Amount 1') as HTMLInputElement).value).toBe('850');

    // × takes it off, and the total comes back.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Discount' }));
    expect(activeCart()).toMatchObject({ discount: '' });
    expect(activeCart().discount_type).toBeUndefined();
    view.rerender(priced());
    expect((screen.getByLabelText('Amount 1') as HTMLInputElement).value).toBe('1,000');
  });

  it('sends the sale with the fixed amount and its reason', async () => {
    const { sell } = bridge();
    cartActions.add(9, 2);
    cartActions.applyDiscount({ type: 'amount', value: '150', reason: 'Damaged box' });
    screenOf(priced(150));
    fireEvent.click(screen.getByRole('button', { name: /^Complete sale$/ }));
    await waitFor(() => expect(sell).toHaveBeenCalled());
    expect(sell.mock.calls[0]![0]).toMatchObject({ discount_type: 'amount', discount_value: 150, discount_reason: 'Damaged box', discount_pct: 15, tenders: [{ method: 'cash', amount: 850 }] });
  });

  it('holds Complete while the cart is priced again, and while WorkSuite refuses a coupon on it', () => {
    bridge();
    cartActions.add(9, 2);
    cartActions.coupon('TEA10');
    const off = { ...priced(), coupon: { code: 'TEA10', amount: 0, valid: false, reason: 'min_spend', message: 'Spend at least 2,000.00 to use that coupon; this sale comes to 1,000.00.' } };
    screenOf(off, {}, { coupon: 'TEA10', promotions: true });
    expect(screen.getByText('Coupon TEA10 not applied')).toBeTruthy();
    expect(screen.getByText('Spend at least 2,000.00 to use that coupon; this sale comes to 1,000.00.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Complete sale/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Coupon TEA10' }));
    expect(activeCart().coupon).toBeUndefined();
  });
});

describe('the shared discount editor', () => {
  const editor = (o: Partial<Parameters<typeof DiscountEditor>[0]> = {}) => {
    const onApply = vi.fn();
    render(
      <DiscountEditor initial={{ type: 'pct', value: '', reason: '' }} base={1000} currency="LKR" amountOn rights={{ allowed: true, ceiling: 10 }} approvals={false} onApply={onApply} onCancel={() => undefined} {...o} />,
    );
    return onApply;
  };

  it('takes a percentage on the pad, cut to the ceiling where nobody can approve', () => {
    const onApply = editor();
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take 10% off' }));
    expect(onApply.mock.calls[0]![0]).toMatchObject({ pct: 10, amount: null, needsApproval: false, draft: { type: 'pct', value: '15' } });
  });

  it('refuses an amount past the ceiling with WorkSuite’s sentence — and past the sale', () => {
    editor();
    fireEvent.click(screen.getByRole('radio', { name: 'Amount' }));
    fireEvent.change(screen.getByLabelText('Discount amount'), { target: { value: '150' } });
    expect(screen.getByText('That would take 15.0% off this sale, and 10% is the most allowed.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Take 150.00 off' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Discount amount'), { target: { value: '1200' } });
    expect(screen.getByText('A discount cannot be more than the sale comes to (1,000.00).')).toBeTruthy();
  });

  it('lets a manager approve past the ceiling where WorkSuite takes approvals', () => {
    const onApply = editor({ approvals: true });
    fireEvent.click(screen.getByRole('radio', { name: 'Amount' }));
    fireEvent.change(screen.getByLabelText('Discount amount'), { target: { value: '150' } });
    expect(screen.getByText('Past what you may give: a manager approves it next.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take 150.00 off' }));
    expect(onApply.mock.calls[0]![0]).toMatchObject({ pct: 15, amount: 150, needsApproval: true });
  });

  it('offers only a percentage on a server that takes no amount', () => {
    editor({ amountOn: false });
    expect(screen.queryByRole('radio', { name: 'Amount' })).toBeNull();
  });
});

describe('a coupon', () => {
  const dialog = (offline = false) => {
    const onApplied = vi.fn();
    render(<CouponDialog current={null} lines={[{ product_id: 9, quantity: 2 }]} org={3} customerId={null} offline={offline} onApplied={onApplied} onClose={() => undefined} />);
    return onApplied;
  };

  it('is checked on the cart and shows the specific reason it is refused', async () => {
    validate.mockResolvedValueOnce({ valid: false, code: 'OLD10', reason: 'expired', message: 'That coupon ran out on 2026-09-30 23:59.', amount: 0, promotion: null });
    const onApplied = dialog();
    fireEvent.change(screen.getByLabelText('Coupon code'), { target: { value: 'old10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('That coupon ran out on 2026-09-30 23:59.')).toBeTruthy();
    expect(validate).toHaveBeenCalledWith('OLD10', [{ product_id: 9, quantity: 2 }], { org: 3 });
    expect(onApplied).not.toHaveBeenCalled();

    validate.mockResolvedValueOnce({ valid: false, code: 'USED1', reason: 'used_up', message: 'That coupon has been used as many times as it can be.', amount: 0, promotion: null });
    fireEvent.change(screen.getByLabelText('Coupon code'), { target: { value: 'USED1' } });
    fireEvent.keyDown(screen.getByLabelText('Coupon code'), { key: 'Enter' });
    expect(await screen.findByText('That coupon has already been used as often as it can be.')).toBeTruthy();
  });

  it('applies a valid one (typed or scanned, then Enter)', async () => {
    validate.mockResolvedValueOnce({ valid: true, code: 'TEA10', reason: null, message: 'Coupon TEA10 takes 100.00 off.', amount: 100, promotion: 'Tea 10%' });
    const onApplied = dialog();
    fireEvent.change(screen.getByLabelText('Coupon code'), { target: { value: 'TEA10' } });
    fireEvent.keyDown(screen.getByLabelText('Coupon code'), { key: 'Enter' });
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('TEA10', expect.objectContaining({ amount: 100 })));
  });

  it('waits for WorkSuite while it is out of reach', () => {
    dialog(true);
    expect(screen.getByText('Coupons need WorkSuite: add one when it answers again.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the gift voucher', () => {
  it('has its tile where WorkSuite takes vouchers, shows its balance and expiry, and pays what is still to pay', async () => {
    bridge(async (op) => (op.op === 'voucher' ? { status: 200, body: { voucher: { code: 'GV-2930-0001', balance: 400, currency: 'LKR', usable: true, status: 'active', expires_on: '2026-12-31' } } } : { status: 404, body: null }));
    cartActions.add(9, 2);
    screenOf(priced());
    const tile = screen.getByRole('radio', { name: 'Gift voucher' });
    expect(tile.textContent).toContain('Scan or type the code');
    fireEvent.change(screen.getByLabelText('Amount 1'), { target: { value: '600' } });
    fireEvent.click(tile);
    fireEvent.change(screen.getByLabelText('Voucher code 2'), { target: { value: 'gv-2930-0001' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check balance' }));
    });
    expect(await screen.findByText('This voucher holds LKR 400.00, valid until 31 Dec 2026.')).toBeTruthy();
    expect((screen.getByLabelText('Amount 2') as HTMLInputElement).value).toBe('400');
  });

  it('offers neither vouchers nor coupons offline, and says so; a discount still works', () => {
    bridge();
    cartActions.add(9, 2);
    screenOf(priced(), { offline: true });
    expect(screen.queryByRole('radio', { name: 'Gift voucher' })).toBeNull();
    expect((screen.getByRole('button', { name: /Add coupon/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Add discount/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/gift vouchers and coupons wait for WorkSuite/)).toBeTruthy();
  });
});
