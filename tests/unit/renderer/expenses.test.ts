import { describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { Org } from '../../../src/modules/expenses/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

const { apiGet } = await import('../../../src/core/api');
const e = await import('../../../src/modules/expenses/api');

const org = (id: number, extra: Partial<Org> = {}) => ({ id, name: `Co ${id}`, slug: `co-${id}`, role: 'member' as const, member: true, currency: 'LKR', favourite: false, ...extra });

describe('expenses: the company selection', () => {
  const orgs = [org(1), org(3), org(5, { member: false, can_act: false })];

  it('reads "1,3" as two companies and drops what is not an id', () => {
    expect(e.parseSelection('3,1,x,3')).toEqual([3, 1]);
    expect(e.selectionParam([3, 1])).toBe('1,3');
    expect(e.parseSelection('')).toEqual([]);
  });

  it('takes the route, then the remembered choice, then the server’s current company — each id only if still listed', () => {
    expect(e.resolveSelection(orgs, '1,3', null, 5)).toEqual([1, 3]);
    expect(e.resolveSelection(orgs, 'all', '1', 5)).toEqual([]);
    expect(e.resolveSelection(orgs, '9', '3', 5)).toEqual([3]);
    expect(e.resolveSelection(orgs, null, '9', 5)).toEqual([5]);
    expect(e.resolveSelection(orgs, null, null, 99)).toEqual([1]);
  });

  it('lets a person act only where they are a member or a super-admin, never on membership alone', () => {
    expect(e.canAct(org(1))).toBe(true);
    expect(e.canAct(org(5, { member: false, can_act: false }))).toBe(false);
    expect(e.canAct(org(6, { member: false, can_act: true }))).toBe(true);
  });

  it('asks the area map about every company when every company is selected', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ areas: [{ key: 'team', visible: true }, { key: 'cards', visible: false }] });
    const areas = await e.fetchAreas([5, 1, 3]);
    expect(apiGet).toHaveBeenCalledWith('/api/module-areas/expense', { org: '1,3,5' }, undefined);
    expect(areas).toEqual({ team: true, cards: false });
  });

  it('draws a dash for no figure, and groups the rest as text', () => {
    expect(e.money(null)).toBe('—');
    expect(e.money('61200', 'LKR')).toBe('LKR 61,200.00');
    expect(e.count('7')).toBe(7);
    expect(e.count(undefined)).toBe(0);
  });
});

describe('expenses: which screen a link opens', () => {
  it('reads the tab, the server’s `view=` spelling, or the record a notification names', async () => {
    const { viewFrom } = await import('../../../src/modules/expenses/ExpensesShell');
    const at = (qs: string) => viewFrom(new URLSearchParams(qs));
    expect(at('tab=cards&org=1')).toBe('cards');
    expect(at('view=reimburse')).toBe('reimburse');
    expect(at('tab=budgets&view=reimburse')).toBe('budgets');
    expect(at('claim=12')).toBe('mine');
    expect(at('advance=4')).toBe('advances');
    expect(at('sub=9')).toBe('subs');
    expect(at('tab=nonsense')).toBe('dashboard');
  });
});
