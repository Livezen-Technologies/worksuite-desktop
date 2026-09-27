import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

const { bomBody, jobActions, jobBody, leftToMake, needed, runBody } = await import('../../../src/modules/inventory/making');

const nut = { id: 7, code: 'N1', name: 'Nut' };
const bolt = { id: 8, code: 'B1', name: 'Bolt' };

describe('inventory making: jobs', () => {
  it('offers what each state allows, to those who may make things', () => {
    expect(jobActions({ status: 'draft', produced_qty: '0' }, true)).toEqual({ release: true, complete: false, cancel: true, remove: true });
    expect(jobActions({ status: 'released', produced_qty: '0' }, true)).toEqual({ release: false, complete: true, cancel: true, remove: false });
    // Once anything is made it cannot be cancelled.
    expect(jobActions({ status: 'in_progress', produced_qty: '2' }, true)).toMatchObject({ complete: true, cancel: false });
    expect(jobActions({ status: 'completed', produced_qty: '4' }, true)).toEqual({ release: false, complete: false, cancel: false, remove: false });
    expect(jobActions({ status: 'draft', produced_qty: '0' }, false)).toEqual({ release: false, complete: false, cancel: false, remove: false });
  });

  it('counts the scrap as part of the plan used up', () => {
    expect(leftToMake({ quantity: '10', produced_qty: '4', scrapped_qty: '1' })).toBe(5);
    expect(leftToMake({ quantity: '10', produced_qty: '10', scrapped_qty: '1' })).toBe(0);
  });

  it('starts a job from a recipe, where, and how many', () => {
    expect(jobBody({ bom: null, warehouse: 2, quantity: '4', plannedFor: '', notes: '' }).error).toMatch(/recipe/);
    expect(jobBody({ bom: 3, warehouse: null, quantity: '4', plannedFor: '', notes: '' }).error).toMatch(/where/);
    expect(jobBody({ bom: 3, warehouse: 2, quantity: '0', plannedFor: '', notes: '' }).error).toMatch(/how many/);
    expect(jobBody({ bom: 3, warehouse: 2, quantity: '1,000', plannedFor: '2026-10-01', notes: ' rush ' })).toEqual({ body: { bom_id: 3, warehouse_id: 2, quantity: 1000, planned_for: '2026-10-01', notes: 'rush' }, error: null });
  });

  it('leaves a blank "made" to the server, which makes the rest after the scrap', () => {
    const blank = { made: '', scrapped: '1', batch: '', expiry: '', serials: '' };
    expect(runBody(blank, 'none', 4)).toEqual({ body: { scrapped: 1 }, error: null });
    expect(runBody({ ...blank, made: '2' }, 'none', 4)).toEqual({ body: { scrapped: 1, quantity: 2 }, error: null });
    expect(runBody({ ...blank, scrapped: '4' }, 'none', 4).error).toMatch(/Nothing is left/);
    expect(runBody({ ...blank, made: '-1' }, 'none', 4).error).toMatch(/more than zero/);
  });

  it('asks for the batch, or a serial for each unit, when the product is tracked that way', () => {
    const d = { made: '2', scrapped: '', batch: '', expiry: '', serials: '' };
    expect(runBody(d, 'batch', 4).error).toMatch(/batch/);
    expect(runBody({ ...d, batch: 'B7', expiry: '2027-01-01' }, 'batch', 4).body).toMatchObject({ batch_no: 'B7', expiry_date: '2027-01-01' });
    expect(runBody({ ...d, serials: 'S1' }, 'serial', 4).error).toMatch(/2 needed, 1 given/);
    expect(runBody({ ...d, serials: 'S1\nS2' }, 'serial', 4).body).toMatchObject({ serials: ['S1', 'S2'] });
  });
});

describe('inventory making: recipes', () => {
  const draft = { product: bolt, name: 'Std', version: '', output: '2', labour: '50', overhead: '', notes: '', lines: [{ key: 0, component: nut, qty: '4', waste: '5' }] };

  it('divides by the wastage rather than multiplying', () => {
    expect(needed(100, 5)).toBeCloseTo(105.263, 3);
    expect(needed(100, 50)).toBe(200);
  });

  it('sends labour and overhead only from someone who may see costs', () => {
    expect(bomBody(draft, true).body).toMatchObject({ product_id: 8, version: '1', output_qty: 2, labour_cost: 50, overhead_cost: 0, lines: [{ component_id: 7, quantity: 4, wastage_pct: 5 }] });
    const hidden = bomBody(draft, false).body;
    expect(hidden).not.toHaveProperty('labour_cost');
    expect(hidden).not.toHaveProperty('overhead_cost');
  });

  it('refuses a recipe with no parts, a part that is the product, or wastage of 100%', () => {
    expect(bomBody({ ...draft, lines: [{ key: 0, component: null, qty: '', waste: '' }] }, true).error).toMatch(/at least one/);
    expect(bomBody({ ...draft, lines: [{ key: 0, component: bolt, qty: '1', waste: '' }] }, true).error).toMatch(/itself/);
    expect(bomBody({ ...draft, lines: [{ key: 0, component: nut, qty: '1', waste: '100' }] }, true).error).toMatch(/under 100/);
    expect(bomBody({ ...draft, output: '0' }, true).error).toMatch(/one run makes/);
  });
});
