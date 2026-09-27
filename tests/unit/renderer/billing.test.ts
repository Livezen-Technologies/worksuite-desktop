import { describe, expect, it, vi } from 'vitest';
import { resolveWebLink } from '../../../shared/links';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { agingParts, can, closeTab, dueFor, invoiceName, lineNet, methodLabel, openTab, statusOf } = await import('../../../src/modules/billing/api');
const { toSend } = await import('../../../src/modules/billing/Lines');

describe('billing: who may do what', () => {
  it('follows the server’s slugs, with billing.manage standing in for all but viewing', () => {
    expect(can(['billing.view'], 'billing.view')).toBe(true);
    expect(can(['billing.view'], 'billing.issue')).toBe(false);
    expect(can(['billing.manage'], 'billing.issue')).toBe(true);
    expect(can(['billing.manage'], 'billing.payment')).toBe(true);
    expect(can(['billing.manage'], 'billing.view')).toBe(false);
    expect(can(['*'], 'billing.settings')).toBe(true);
    expect(can(undefined, 'billing.view')).toBe(false);
    // billing.manage is Billing's: it grants nothing elsewhere.
    expect(can(['billing.manage'], 'finance.view')).toBe(false);
  });
});

describe('billing: invoices in words', () => {
  it('names a draft by its id until it is issued', () => {
    expect(invoiceName({ id: 12, number: null })).toBe('Draft #12');
    expect(invoiceName({ id: 12, number: 'INV-00012' })).toBe('INV-00012');
  });

  it('labels every status the server has, and part paid as the design says', () => {
    expect(statusOf('partial').label).toBe('Part paid');
    expect(statusOf('overdue').label).toBe('Overdue');
    expect(statusOf('something-new').label).toBe('something-new');
    expect(methodLabel('bank_transfer')).toBe('Bank transfer');
    expect(methodLabel('offset')).toBe('Offset');
  });
});

describe('billing: working out', () => {
  it('a line is quantity × rate less its discount, before tax, to the cent', () => {
    expect(lineNet({ quantity: 25, unit_price: 43200, discount_pct: 0 })).toBe(1_080_000);
    expect(lineNet({ quantity: 3, unit_price: 99.99, discount_pct: 10 })).toBe(269.97);
    expect(lineNet({ quantity: 1, unit_price: 100, discount_pct: 150 })).toBe(0);
    expect(lineNet({ quantity: 1, unit_price: 100, discount_pct: -5 })).toBe(100);
  });

  it('works out the due date from the terms, across a month end', () => {
    expect(dueFor('2026-09-25', 14)).toBe('2026-10-09');
    expect(dueFor('2026-09-25', 0)).toBe('2026-09-25');
    expect(dueFor('not a date', 14)).toBe('');
  });

  it('splits what is owed into the five ages, oldest last, as shares of the whole', () => {
    const p = agingParts({ current: 2_400_000, '1_30': 1_300_000, '31_60': 700_000, '61_90': 400_000, over_90: 200_000, total: 5_000_000 });
    expect(p.map((x) => x.label)).toEqual(['Not due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days']);
    expect(p.map((x) => Math.round(x.pct))).toEqual([48, 26, 14, 8, 4]);
    expect(agingParts(undefined).every((x) => x.pct === 0)).toBe(true);
  });

  it('sends only lines with words, with their taxes, clamped to what the server takes', () => {
    const sent = toSend([
      { key: 'a', product_id: 7, description: '  Seat, 12 months ', quantity: 25, unit_price: 43200, discount_pct: 120, tax_rate_ids: [1, 2] },
      { key: 'b', product_id: null, description: '   ', quantity: 1, unit_price: 5, discount_pct: 0, tax_rate_ids: [] },
      { key: 'c', product_id: null, description: 'Setup', quantity: 1, unit_price: 650000, discount_pct: 0, tax_rate_ids: [], source_type: 'manual' },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ product_id: 7, description: 'Seat, 12 months', quantity: 25, unit_price: 43200, discount_pct: 100, tax_rate_ids: [1, 2] });
    expect(sent[1]).not.toHaveProperty('source_type');
  });

  it('keeps the open invoices in the order they were opened, each once', () => {
    expect(openTab([4, 9], 9)).toEqual([4, 9]);
    expect(openTab([4, 9], 2)).toEqual([4, 9, 2]);
    expect(closeTab([4, 9, 2], 9)).toEqual([4, 2]);
  });
});

describe('billing: the server’s links open here', () => {
  it('opens an invoice from a notification or a share in the Invoices module', () => {
    expect(resolveWebLink('/billing?invoice=42')).toEqual({ kind: 'tab', route: '/billing?invoice=42', app: 'billing' });
    expect(resolveWebLink('/billing/invoices/42')).toEqual({ kind: 'tab', route: '/billing/invoices/42', app: 'billing' });
  });
});
