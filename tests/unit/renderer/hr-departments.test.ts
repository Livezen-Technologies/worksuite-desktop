import { describe, expect, it } from 'vitest';
import { below, inTreeOrder, type Department } from '../../../src/modules/hr/departmentTree';

const d = (id: number, name: string, parent_id: number | null = null): Department => ({ id, name, depth: 0, code: null, parent_id, parent_name: null, org_id: null, org_name: null, manager_id: null, manager_name: null, status: 'active', members: 0 });

describe('HR departments tree', () => {
  it('lists each department under its parent, siblings by name', () => {
    const list = [d(1, 'Operations'), d(2, 'Finance'), d(3, 'Payroll', 2), d(4, 'Accounts', 2), d(5, 'Warehouse', 1)];
    expect(inTreeOrder(list).map((x) => `${x.depth}:${x.name}`)).toEqual(['0:Finance', '1:Accounts', '1:Payroll', '0:Operations', '1:Warehouse']);
  });

  it('keeps a department whose parent is not in the list, at the top', () => {
    expect(inTreeOrder([d(1, 'Sales', 99)]).map((x) => x.id)).toEqual([1]);
  });

  it('keeps every department when parents loop or point at themselves, without looping', () => {
    expect(inTreeOrder([d(1, 'A', 2), d(2, 'B', 1), d(3, 'C'), d(4, 'D', 4)]).map((x) => `${x.depth}:${x.id}`)).toEqual(['0:3', '0:1', '1:2', '0:4']);
  });

  it('never offers a department, or anything under it, as its own parent', () => {
    const list = [d(1, 'Finance'), d(2, 'Payroll', 1), d(3, 'Salaries', 2), d(4, 'Sales')];
    expect([...below(list, 1)].sort()).toEqual([1, 2, 3]);
    expect([...below(list, 4)]).toEqual([4]);
  });
});
