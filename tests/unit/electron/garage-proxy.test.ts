import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { isProxyPathAllowed } from '../../../electron/services/api-proxy';
import { contract } from '../../../shared/ipc/contract';
import { garageDocPath } from '../../../shared/garage-docs';

describe('Garage through the API proxy', () => {
  it('lets the Garage screens read and write, and the timer’s offline queue replay', () => {
    expect(isProxyPathAllowed('/api/garage/v1/board', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/my-work', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/work-orders/9/start', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/parts-usage/7/issue', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/../users', 'GET')).toBe(false);
  });

  it('takes photos onto a job, shows them, and takes them off', () => {
    expect(isProxyPathAllowed('/api/garage/v1/jobs/40/media', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/media/77', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/media/77', 'DELETE')).toBe(true);
    expect(isProxyPathAllowed('/api/garage/v1/estimates/5/lines/11', 'DELETE')).toBe(true);
  });
});

describe('Garage documents through the download manager, by what they are', () => {
  const input = contract['transfers:download'].input;

  it('takes a check-in sheet, an estimate, a work order sheet, a delivery note or a report — one at a time', () => {
    expect(input.safeParse({ garageDoc: { kind: 'checkin-sheet', job: 40 }, name: 'JOB-40 check-in sheet.html' }).success).toBe(true);
    expect(input.safeParse({ garageDoc: { kind: 'estimate', estimate: 5 }, name: 'e.html', open: true }).success).toBe(true);
    expect(input.safeParse({ garageDoc: { kind: 'work-order', workOrder: 9 }, name: 'wo.html' }).success).toBe(true);
    expect(input.safeParse({ garageDoc: { kind: 'delivery-note', job: 40 }, name: 'dn.html' }).success).toBe(true);
    expect(input.safeParse({ garageDoc: { kind: 'report', report: 'aging', query: { org: '3', from: '2026-09-01' } }, name: 'aging.csv' }).success).toBe(true);
    expect(input.safeParse({ garageDoc: { kind: 'checkin-sheet', job: 40 }, fileId: '1', name: 'x.html' }).success).toBe(false);
  });

  it('refuses a path, a report the server does not have, or anything else in its query', () => {
    expect(input.safeParse({ garageDoc: { kind: 'checkin-sheet', job: '../../users' }, name: 'x' }).success).toBe(false);
    expect(input.safeParse({ garageDoc: { kind: 'somewhere', path: '/api/users' }, name: 'x' }).success).toBe(false);
    expect(input.safeParse({ garageDoc: { kind: 'report', report: 'payroll', query: {} }, name: 'x.csv' }).success).toBe(false);
    expect(input.safeParse({ garageDoc: { kind: 'report', report: 'aging', query: { format: 'json' } }, name: 'x.csv' }).success).toBe(false);
    expect(input.safeParse({ garageDoc: { kind: 'report', report: 'aging', query: { from: 'yesterday' } }, name: 'x.csv' }).success).toBe(false);
  });

  it('builds the server’s address for each', () => {
    expect(garageDocPath({ kind: 'checkin-sheet', job: 40 })).toBe('/api/garage/v1/jobs/40/checkin/sheet');
    expect(garageDocPath({ kind: 'estimate', estimate: 5 })).toBe('/api/garage/v1/estimates/5/print');
    expect(garageDocPath({ kind: 'work-order', workOrder: 9 })).toBe('/api/garage/v1/work-orders/9/sheet');
    expect(garageDocPath({ kind: 'delivery-note', job: 40 })).toBe('/api/garage/v1/jobs/40/delivery-note');
    expect(garageDocPath({ kind: 'report', report: 'technicians', query: { org: '3', to: '2026-09-30', branch_id: '1' } })).toBe('/api/garage/v1/reports/technicians?org=3&to=2026-09-30&branch_id=1&format=csv');
    for (const p of ['/api/garage/v1/jobs/40/checkin/sheet', '/api/garage/v1/reports/aging?format=csv']) expect(isProxyPathAllowed(p, 'GET')).toBe(true);
  });
});
