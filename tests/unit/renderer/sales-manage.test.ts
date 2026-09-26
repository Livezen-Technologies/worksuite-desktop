import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRegional } from '../../../src/core/time';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { byDay, channelTone, couponRuns, couponUsed, couponWorth, eventName, periodLabel, rangeOf, ruleLine, span } = await import('../../../src/modules/sales/manage');

afterEach(() => setRegional({}));

describe('reports: a window is the two dates it covers', () => {
  // Sunday 27 September 2026.
  const today = '2026-09-27';

  it('counts weeks from Monday, and last week is the seven days before this one', () => {
    expect(rangeOf('this_week', today)).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(rangeOf('last_week', today)).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    expect(rangeOf('this_week', '2026-09-21')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  it('knows how long each month is, and what came before January', () => {
    expect(rangeOf('this_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeOf('last_month', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(rangeOf('last_month', '2028-03-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(rangeOf('last_month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('covers quarters, years, the last thirty days and single days', () => {
    expect(rangeOf('this_quarter', today)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(rangeOf('this_quarter', '2026-11-02')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(rangeOf('this_year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(rangeOf('last_year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(rangeOf('last_30', today)).toEqual({ from: '2026-08-29', to: '2026-09-27' });
    expect(rangeOf('today', today)).toEqual({ from: today, to: today });
    expect(rangeOf('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
    expect(rangeOf('custom', today)).toBeNull();
  });
});

describe('reports: periods in words', () => {
  it('writes a month and a day, and leaves other names alone', () => {
    setRegional({ locale: 'en-GB' });
    expect(periodLabel('2026-09', 'month')).toBe('September 2026');
    expect(periodLabel('2026-10-14', 'day')).toBe('14 Oct 2026');
    expect(periodLabel('Harbour Hotels', 'client')).toBe('Harbour Hotels');
    expect(periodLabel('2026-09', 'client')).toBe('2026-09');
  });
});

describe('activity: grouped by the day on the reader’s clock', () => {
  const ev = (id: number, at: string | null) => ({ id, type: 'status', source: 'oms', user: null, description: null, at });

  it('puts an evening in Colombo on that evening, not on the next UTC day', () => {
    setRegional({ timezone: 'Asia/Colombo' });
    // 20:00 UTC on the 26th is 01:30 on the 27th in Colombo; 17:00 UTC is 22:30 on the 26th.
    const days = byDay([ev(1, '2026-09-26 20:00:00'), ev(2, '2026-09-26 17:00:00')], '2026-09-27');
    expect(days.map((d) => [d.label, d.rows.map((r) => r.id)])).toEqual([
      ['Today', [1]],
      ['Yesterday', [2]],
    ]);
  });

  it('never makes the same day twice when the rows are out of order, and leaves undated last', () => {
    setRegional({ timezone: 'UTC' });
    const days = byDay([ev(1, '2026-09-20 09:00:00'), ev(2, null), ev(3, '2026-09-24 10:00:00'), ev(4, '2026-09-20 11:00:00')], '2026-09-27');
    expect(days.map((d) => d.key)).toEqual(['2026-09-24', '2026-09-20', 'undated']);
    expect(days[1]!.rows.map((r) => r.id)).toEqual([1, 4]);
    expect(days[0]!.label).toMatch(/Thursday/);
    expect(days[0]!.label).toMatch(/2026/);
    expect(days[2]!.label).toBe('Undated');
  });

  it('names events as the web does, and an unknown one by its own words', () => {
    expect(eventName('approval_step')).toBe('Approval step');
    expect(eventName('status')).toBe('Status changed');
    expect(eventName('stock_reserved')).toBe('Stock reserved');
  });
});

describe('coupons: what the list says about each', () => {
  it('writes the worth, with the cap when there is one', () => {
    expect(couponWorth({ kind: 'percent', value: 20, max_discount: 50000 })).toBe(`20% · max ${(50000).toLocaleString()}`);
    expect(couponWorth({ kind: 'percent', value: 15, max_discount: null })).toBe('15%');
    expect(couponWorth({ kind: 'amount', value: 5000, max_discount: null }, 'LKR')).toBe(`LKR ${(5000).toLocaleString()}`);
    expect(couponWorth({ kind: 'amount', value: 2500, max_discount: 0 })).toBe((2500).toLocaleString());
  });

  it('says when it runs, and that it has no end', () => {
    setRegional({ locale: 'en-GB' });
    const y = new Date().getFullYear();
    expect(couponRuns({ starts_at: `${y}-10-01`, ends_at: `${y}-10-31` })).toBe('1 Oct → 31 Oct');
    expect(couponRuns({ starts_at: `${y}-01-01`, ends_at: null })).toMatch(/→ no end$/);
    expect(couponRuns({ starts_at: null, ends_at: null })).toBe('Now → no end');
    // Another year is named, so last year's March is not read as this year's.
    expect(couponRuns({ starts_at: `${y - 2}-03-01`, ends_at: `${y - 2}-03-31` })).toContain(String(y - 2));
  });

  it('counts uses against the limit, or against nothing', () => {
    expect(couponUsed({ redeemed_count: 38, usage_limit: 100 })).toBe('38 / 100');
    expect(couponUsed({ redeemed_count: 112, usage_limit: 0 })).toBe('112 / ∞');
  });
});

describe('rules and channels', () => {
  it('reads a rule as the server wrote it, with who approves and where', () => {
    expect(ruleLine({ reads: 'Order total is more than 1000000', permission: 'oms.orders.approve', org_name: null })).toBe('Order total is more than 1000000 → needs oms.orders.approve · every company');
    expect(ruleLine({ reads: 'Discount % is more than 5%', permission: 'oms.orders.approve_discount', org_name: 'Livezen Technologies' })).toBe('Discount % is more than 5% → needs oms.orders.approve_discount · Livezen Technologies');
  });

  it('colours a channel by what its driver says now', () => {
    expect(channelTone('connected')).toBe('ok');
    expect(channelTone('error')).toBe('bad');
    expect(channelTone('pending')).toBe('warn');
    expect(channelTone('syncing')).toBe('busy');
    expect(channelTone('not_connected')).toBe('idle');
    expect(channelTone('disabled')).toBe('idle');
  });

  it('says how long a sync took', () => {
    expect(span(42)).toBe('42 s');
    expect(span(204)).toBe('3 min 24 s');
    expect(span(-3)).toBe('0 s');
  });
});
