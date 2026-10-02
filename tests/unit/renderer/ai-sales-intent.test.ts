import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e) }));
vi.mock('../../../src/core/api', async (original) => ({ ...(await original<typeof CoreApi>()), apiPost: vi.fn() }));
vi.mock('../../../src/core/local-ai', () => ({ askLocal: vi.fn() }));
import { ApiError, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { askLocal } from '../../../src/core/local-ai';
import { GUIDES } from '../../../src/modules/ai/help/catalog';
import { findGuides, isHowTo } from '../../../src/modules/ai/help/guides';
import { guideFollowUp, isTodaySales, requestIntent } from '../../../src/modules/ai/intent';
import { salesAccess, todaySales } from '../../../src/modules/ai/sales';
import { createAskSession } from '../../../src/modules/ai/session';
const report = { company: { id: 7, name: 'Acme' }, date: '2026-10-02', timezone: 'Asia/Colombo', from: '2026-10-01T18:30:00Z', to_exclusive: '2026-10-02T18:30:00Z', basis: 'Gross issued invoices, by invoice date.', totals: [{ currency: 'LKR', total: '120.50', count: 2 }, { currency: 'USD', total: '10.25', count: 1 }], records_url: '/billing?tab=inv&org=7&sales_date=2026-10-02' };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiPost).mockReset(); app.set({ organizationId: '7' }); });
describe('current request intent (#96)', () => {
  it('distinguishes reporting, guidance and actions without treating every Can I as guidance', () => {
    for (const q of ["Can I know today’s total sales?", "Show today's sales", 'What is the total sales today?', 'How much are today’s sales?']) { expect(requestIntent(q)).toBe('data'); expect(isHowTo(q)).toBe(false); expect(isTodaySales(q), q).toBe(true); }
    expect(requestIntent('How do I create an order?')).toBe('guidance');
    expect(requestIntent('Create a sales order.')).toBe('action');
    expect(requestIntent('Can you create a sales order?')).toBe('action');
    for (const q of ['Show yesterday’s sales', 'Show today’s sales for Ben', 'How do I see today’s sales?', 'Create today’s sales order']) expect(isTodaySales(q)).toBe(false);
  });
  it('does not reuse a creation guide for reporting or a changed action topic', () => {
    const order = GUIDES.find((g) => g.id === 'sales.order')!;
    expect(guideFollowUp('And which warehouse should I pick?', order)).toBe(true);
    for (const q of ["Can I know today's total sales?", 'Create a sales order.', 'What about today’s sales?', 'What about invoices?']) expect(guideFollowUp(q, order)).toBe(false);
    expect(findGuides(GUIDES, 'How do I view sales reports?', 'sales')).toEqual([]);
  });
});
describe('authorized sales answers shared by both engines', () => {
  for (const local of [true, false]) it(`retrieves company sales with ${local ? 'local AI' : 'online fallback'} configured, without model arithmetic`, async () => {
    vi.mocked(apiPost).mockResolvedValue(report as never);
    const s = createAskSession(); s.showGuide('How do I create an order?', 'sales.order', 'Guide: Create a sales order');
    s.store.set({ text: "Can I know today’s total sales?" });
    await s.send({ surface: 'assistant.panel', refs: [], local, online: !local, sales: { orgId: '7', engine: local ? 'local' : 'worksuite', connected: true, denied: null }, context: 'Old guide context must not intercept this request.' });
    const a = s.store.get().entries.at(-1)!;
    expect(a.text).toContain('LKR 120.50'); expect(a.text).toContain('USD 10.25'); expect(a.text).toContain('Asia/Colombo'); expect(a.text).toContain('Basis: Gross issued invoices');
    expect(a.text).not.toContain('Create a sales order'); expect(a.guide).toBeUndefined(); expect(a.turn?.sources[0]?.url).toBe(report.records_url);
    expect(apiPost).toHaveBeenCalledExactlyOnceWith('/api/ai/assist/sales-today', { org_id: '7', engine: local ? 'local' : 'worksuite' }); expect(askLocal).not.toHaveBeenCalled();
  });
  it('returns an explicit limitation on denied, missing, offline and failed data without falling back to a model', async () => {
    for (const error of [new ApiError(403, 'Billing access denied.', null), new ApiError(404, 'Missing route', null), new ApiError(503, 'Sales database unavailable.', null)]) {
      vi.mocked(apiPost).mockRejectedValue(error); const s = createAskSession(); s.store.set({ text: 'Show today’s sales' });
      await s.send({ surface: 'assistant.panel', refs: [], local: true, online: true, sales: { orgId: '7', engine: 'local', connected: true, denied: null } });
      expect(s.store.get().entries.at(-1)?.error).toBe(true); expect(s.store.get().entries.at(-1)?.text).not.toContain('0.00');
    }
    await expect(todaySales({ orgId: '7', engine: 'local', connected: false, denied: null })).rejects.toThrow('offline');
    await expect(todaySales({ orgId: '7', engine: 'local', connected: true, denied: 'Billing is switched off.' })).rejects.toThrow('switched off');
    expect(askLocal).not.toHaveBeenCalled();
  });
  it('respects the selected company and per-engine personal Billing switch', () => {
    expect(salesAccess('local', null, { worksuite: {}, local: { billing: { read: false, write: false } } }, true)).toMatchObject({ orgId: '7', denied: expect.stringContaining('Billing data off') });
    expect(salesAccess('worksuite', null, { worksuite: {}, local: { billing: { read: false, write: false } } }, true).denied).toBeNull();
  });
  it('rejects malformed figures instead of presenting them as totals', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ...report, totals: [{ currency: 'USD', total: 'NaN', count: 1 }] } as never);
    await expect(todaySales({ orgId: '7', engine: 'worksuite', connected: true, denied: null })).rejects.toThrow('invalid sales total');
  });
});
