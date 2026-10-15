import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(async () => ({ orders: [] })), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { apiPost } = await import('../../../src/core/api');
const { awardBody, awardGroups, awardRfq, cheapestBid, comparisonOf, defaultPicks, pick, savings } = await import('../../../src/modules/purchase/rfq');

/**
 * SRS-PUR-001 G-17 (the "RFQ comparison" design): an RFQ's comparison and its per-line award — each line to one bid,
 * the cheapest by default, any other by choice, or none; one draft order per winning vendor.
 */
const raw = {
  currency: 'LKR',
  vendors: [
    { bid_id: null, vendor: 'Gulf Tech Trading', currency: 'USD', lead_days: 21, status: 'responded' },
    { bid_id: null, vendor: 'Metro Electricals', currency: 'LKR', lead_days: 7, status: 'responded' },
    { bid_id: null, vendor: 'Nexus IT Lanka', currency: 'LKR', lead_days: 14, status: 'responded' },
  ],
  lines: [
    {
      rfq_line_id: 1,
      product: '24-port managed switch',
      qty: 4,
      target: 95000,
      bids: [
        { bid_id: 11, vendor: 'Gulf Tech Trading', unit_price: 89700, lead_days: 21, total: 358800, cheapest: true },
        { bid_id: 21, vendor: 'Metro Electricals', unit_price: 104500, lead_days: 7, total: 418000, fastest: true },
        { bid_id: 31, vendor: 'Nexus IT Lanka', unit_price: 97800, lead_days: 14, total: 391200 },
      ],
    },
    {
      rfq_line_id: 2,
      product: 'Wi-Fi 6 access point',
      qty: 10,
      target: 40000,
      bids: [
        { bid_id: 12, vendor: 'Gulf Tech Trading', unit_price: 38870, lead_days: 21, total: 388700 },
        { bid_id: 22, vendor: 'Metro Electricals', unit_price: 39900, lead_days: 7, total: 399000, fastest: true },
        { bid_id: 32, vendor: 'Nexus IT Lanka', unit_price: 37400, lead_days: 14, total: 374000, cheapest: true },
      ],
    },
    {
      rfq_line_id: 3,
      product: 'Cat6A cable, 305 m',
      qty: 2,
      target: 35000,
      bids: [
        { bid_id: 13, vendor: 'Gulf Tech Trading', unit_price: null, lead_days: 21, total: null },
        { bid_id: 23, vendor: 'Metro Electricals', unit_cost: '33600', lead_time_days: 7 },
        { bid_id: 33, vendor: 'Nexus IT Lanka', unit_price: 34100, lead_days: 14, total: 68200 },
      ],
    },
  ],
};

describe('per-line award', () => {
  const c = comparisonOf(raw);

  it('reads the comparison, working out a total the server left out and keeping an unquoted bid unpriced', () => {
    expect(c.lines).toHaveLength(3);
    expect(c.lines[2]!.bids[1]).toMatchObject({ bid_id: 23, unit_price: 33600, total: 67200, lead_days: 7, cheapest: false });
    expect(c.lines[2]!.bids[0]).toMatchObject({ bid_id: 13, unit_price: null, total: null });
    expect(comparisonOf(null)).toEqual({ lines: [], vendors: [], currency: null });
    // The server's own: the product as an object, the target as `target_cost`, the currency on the RFQ.
    const server = comparisonOf({ rfq: { id: 31, currency: 'LKR' }, vendors: [], lines: [{ rfq_line_id: 7, product: { id: 1, code: 'SW-24', name: '24-port switch' }, qty: 4, target_cost: 95000, bids: [] }] });
    expect(server.lines[0]).toMatchObject({ product: '24-port switch', target: 95000 });
    expect(server.currency).toBe('LKR');
  });

  it('awards each line to its cheapest bid by default — the server’s mark first, else the lowest priced', () => {
    expect(defaultPicks(c)).toEqual({ 1: 11, 2: 32, 3: 23 });
    expect(cheapestBid(c.lines[2]!)?.bid_id).toBe(23);
  });

  it('splits the award: one draft order per winning vendor', () => {
    expect(awardGroups(c, defaultPicks(c))).toEqual([
      { vendor: 'Gulf Tech Trading', lines: 1, total: 358800, currency: null },
      { vendor: 'Nexus IT Lanka', lines: 1, total: 374000, currency: null },
      { vendor: 'Metro Electricals', lines: 1, total: 67200, currency: null },
    ]);
  });

  it('picks another bid for a line, leaves a line out by picking it again, and never awards an unpriced bid', () => {
    let p = defaultPicks(c);
    p = pick(c, p, 1, 21);
    expect(p[1]).toBe(21);
    expect(awardGroups(c, p).map((g) => [g.vendor, g.lines])).toEqual([
      ['Metro Electricals', 2],
      ['Nexus IT Lanka', 1],
    ]);
    p = pick(c, p, 1, 21);
    expect(p[1]).toBeNull();
    expect(pick(c, p, 3, 13)).toBe(p);
    expect(pick(c, p, 99, 11)).toBe(p);
  });

  it('measures the award against the target cost of the lines awarded', () => {
    const s = savings(c, defaultPicks(c))!;
    expect(s.target).toBe(95000 * 4 + 40000 * 10 + 35000 * 2);
    expect(s.awarded).toBe(358800 + 374000 + 67200);
    expect(s.diff).toBe(-50000);
    expect(s.pct).toBe(-5.9);
  });

  it('asks for a line and a reason, then sends the lines picked', async () => {
    const none = Object.fromEntries(c.lines.map((l) => [l.rfq_line_id, null]));
    expect(awardBody(c, none, 'cheapest').error).toBe('Pick a bid on at least one line.');
    expect(awardBody(c, defaultPicks(c), '  ').error).toMatch(/Say why these vendors were chosen/);
    expect(awardBody(c, { ...defaultPicks(c), 3: 13 }, 'x').error).toMatch(/no price/);
    const b = awardBody(c, { ...defaultPicks(c), 2: null }, ' Lowest landed cost per line ');
    expect(b).toEqual({ body: { lines: [{ rfq_line_id: 1, bid_id: 11 }, { rfq_line_id: 3, bid_id: 23 }], reason: 'Lowest landed cost per line' }, error: null });
    await awardRfq(31, b.body!);
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/purchase/rfqs/31/award', b.body);
  });
});
