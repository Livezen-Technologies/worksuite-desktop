import { describe, expect, it, vi } from 'vitest';
import { resolveWebLink } from '../../../shared/links';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

const { BULK_STATUSES, mayInvoice, movesFor, statusOf } = await import('../../../src/modules/sales/api');

describe('orders: moves go where they are done properly', () => {
  it('never offers an approval move as a plain status change', () => {
    const m = movesFor({
      next_states: [
        { status: 'pending_approval', label: 'Pending approval', needs: 'oms.orders.edit' },
        { status: 'approved', label: 'Approved', needs: 'oms.orders.approve' },
        { status: 'rejected', label: 'Rejected', needs: 'oms.orders.approve' },
        { status: 'processing', label: 'Processing', needs: 'oms.fulfilment.manage' },
      ],
    });
    expect(m.map((x) => x.status)).toEqual(['processing']);
    expect(m[0]!.via).toBe('transition');
  });

  it('confirms and cancels through Inventory, which reserves and releases the stock', () => {
    const m = movesFor({
      next_states: [
        { status: 'confirmed', label: 'Confirmed', needs: 'oms.orders.confirm' },
        { status: 'cancelled', label: 'Cancelled', needs: 'oms.orders.cancel' },
      ],
    });
    expect(m.map((x) => [x.status, x.via])).toEqual([
      ['confirmed', 'inventory-confirm'],
      ['cancelled', 'inventory-cancel'],
    ]);
  });

  it('follows a server that says where confirming goes, and cancels through Orders there', () => {
    const m = movesFor({
      next_states: [
        { status: 'confirmed', label: 'Confirmed', needs: 'oms.orders.confirm' },
        { status: 'cancelled', label: 'Cancelled', needs: 'oms.orders.cancel' },
      ],
      confirm: { endpoint: '/api/inventory/sales-orders/5/confirm', allowed: false, why: 'An approval rule applies' },
    });
    expect(m.map((x) => [x.status, x.via, x.disabled ?? null])).toEqual([
      ['confirmed', 'inventory-confirm', 'An approval rule applies'],
      ['cancelled', 'transition', null],
    ]);
  });

  it('keeps approval, confirm and cancel out of the bulk status change', () => {
    for (const s of ['pending_approval', 'approved', 'rejected', 'confirmed', 'cancelled']) expect(BULK_STATUSES).not.toContain(s);
  });

  it('names every status, and survives one it does not know', () => {
    expect(statusOf('ready_for_fulfillment').label).toBe('Ready for fulfilment');
    expect(statusOf('something_new').label).toBe('something_new');
  });

  it('opens the server’s order links here', () => {
    expect(resolveWebLink('/oms?order=42')).toEqual({ kind: 'tab', route: '/sales?order=42', app: 'sales' });
  });
});

describe('orders: raising an invoice', () => {
  const line = (quantity: number, invoiced: number) => ({ id: 1, product_id: 2, product: 'Nut', code: 'N', description: null, quantity, reserved_qty: 0, delivered_qty: 0, invoiced_qty: invoiced, unit_price: 10, line_total: 10 * quantity });
  const seller = ['inventory.sell', 'billing.invoice'];

  it('is offered on a confirmed order with something not yet invoiced, to someone who may invoice', () => {
    expect(mayInvoice({ status: 'confirmed', lines: [line(5, 0)] }, seller)).toBe(true);
    expect(mayInvoice({ status: 'delivered', lines: [line(5, 2)] }, ['inventory.manage'])).toBe(true);
    expect(mayInvoice({ status: 'partial', lines: [line(5, 0)] }, ['*'])).toBe(true);
  });

  it('is not offered before confirmation, once cancelled, when all is invoiced, or without both rights', () => {
    for (const status of ['draft', 'pending_approval', 'approved', 'rejected', 'cancelled'] as const) expect(mayInvoice({ status, lines: [line(5, 0)] }, seller)).toBe(false);
    expect(mayInvoice({ status: 'delivered', lines: [line(5, 5)] }, seller)).toBe(false);
    expect(mayInvoice({ status: 'confirmed', lines: [line(5, 0)] }, ['inventory.sell'])).toBe(false);
    expect(mayInvoice({ status: 'confirmed', lines: [line(5, 0)] }, ['billing.invoice'])).toBe(false);
    expect(mayInvoice({ status: 'confirmed', lines: [line(5, 0)] }, undefined)).toBe(false);
  });
});
