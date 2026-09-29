// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, request } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { elapsed, mayIn, partCounts, remaining, timer, type MyWork as MyWorkData, type Options, type PartUsage } from '../../../src/modules/garage/api';
import { resolveWebLink } from '@shared/links';
import { jobOf, vehicleOf } from '../../../src/modules/garage/GarageShell';
import JobCard from '../../../src/modules/garage/JobCard';
import MyWork from '../../../src/modules/garage/MyWork';
import PartsCounter from '../../../src/modules/garage/PartsCounter';
import { JobForm } from '../../../src/modules/garage/WalkIn';
import { GarageContext, type Garage } from '../../../src/modules/garage/parts';

const options = (over: Partial<Options> = {}): Options => ({
  org: 3, companies: [{ id: 3, name: 'Livezen Motors' }], currency: 'LKR', units: 'km',
  can: { job_view: true, job_create: true, work_order_view: true, parts_issue: true, vehicle_manage: true },
  setup: { complete: true, done: 7, total: 7, next: null },
  branches: [{ id: 1, name: 'Colombo', code: 'CMB', active: true, garage: true }],
  technicians: [{ id: 21, employee_id: 4, user_id: 5, name: 'Nimal', skills: [], is_lead: true, active: true }],
  models: [], priorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], job_types: ['SERVICE', 'REPAIR'], vehicle_types: ['car'], fuels: [], transmissions: [],
  complaints: ['Noise when braking'], cancel_reasons: ['customer_declined'], require_vin: false, ...over,
});

const garage = (over: Partial<Garage> = {}): Garage => {
  const o = options();
  return { org: '3', options: o, may: (p) => mayIn(o, p), go: vi.fn(), openJob: vi.fn(), ...over };
};

const wrap = (ui: ReactNode, g = garage()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GarageContext.Provider value={g}>{ui}</GarageContext.Provider>
    </QueryClientProvider>,
  );

const ok = <T,>(data: T, message = 'Done.') => ({ data, offline: false, cachedAt: null, message });

const usage = (over: Partial<PartUsage> = {}): PartUsage => ({
  id: 7, job_id: 40, work_order_id: 9, product_id: 100, description: 'Brake pads', source: 'ESTIMATE', status: 'RESERVED',
  approved_qty: 2, requested_qty: 0, reserved_qty: 2, issued_qty: 0, used_qty: 0, returned_qty: 0, urgency: 'NORMAL', reason: null,
  requested_by: null, created_at: '2026-09-29 04:00:00', job_number: 'JOB-2026-000040', vehicle: 'CAB-1234 · Toyota Axio', ...over,
});

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(toast).mockReset();
});
afterEach(cleanup);

describe('Garage: reading the server', () => {
  it('reads a grant from the options, and from the person’s own permissions when the options do not list it', () => {
    const o = options({ can: { parts_issue: false } });
    expect(mayIn(o, 'garage.parts.issue', ['*'])).toBe(false);
    expect(mayIn(o, 'garage.parts.return', ['garage.parts.return'])).toBe(true);
    expect(mayIn(o, 'garage.parts.return', [])).toBe(false);
    expect(mayIn(options(), 'garage.job.view')).toBe(true);
  });

  it('finds the job a route names, as notifications and deep links write it', () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(jobOf(['garage'], q('view=board&job=12'))).toBe(12);
    expect(jobOf(['garage'], q('checkin=13'))).toBe(13);
    expect(jobOf(['garage', 'jobs', '14'], q(''))).toBe(14);
    expect(jobOf(['garage'], q('view=board'))).toBeNull();
    expect(vehicleOf(['garage', 'vehicles', '5'], q(''))).toBe(5);
  });

  it('opens the server’s notification links in the Garage tab', () => {
    expect(resolveWebLink('/garage?job=12')).toEqual({ kind: 'tab', route: '/garage?job=12', app: 'garage' });
  });

  it('counts parts and the time on the clock', () => {
    expect(remaining(usage({ issued_qty: 1 }))).toBe(1);
    expect(remaining(usage({ source: 'REQUEST', requested_qty: 3, approved_qty: 0 }))).toBe(3);
    expect(partCounts(usage({ status: 'ISSUED', issued_qty: 2, used_qty: 1 }))).toBe('approved 2 · issued 2 · used 1');
    expect(elapsed('2026-09-29 04:00:00', Date.parse('2026-09-29T05:05:12Z'))).toBe('1:05:12');
  });
});

describe('Garage: the timer without WorkSuite (NFR-05)', () => {
  it('starts online as an ordinary write, with a key', async () => {
    vi.mocked(request).mockResolvedValue(ok({}, 'Timer started on WO-1.'));
    expect(await timer(9, 'start', { technician_id: 21 }, 'Start WO-1')).toEqual({ queued: false, message: 'Timer started on WO-1.' });
    const [method, path, opts] = vi.mocked(request).mock.calls[0]!;
    expect([method, path]).toEqual(['POST', '/api/garage/v1/work-orders/9/start']);
    expect(opts?.headers?.['Idempotency-Key']).toMatch(/^wo-start-/);
    expect(call).not.toHaveBeenCalled();
  });

  it('keeps a start with the moment it was pressed when WorkSuite cannot be reached', async () => {
    vi.mocked(request).mockRejectedValue(new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'INTERNAL'));
    vi.mocked(call).mockResolvedValue({ delivered: false, queued: true, id: 'q1', status: null, data: null, error: null, code: null } as never);
    const at = new Date('2026-09-29T04:30:00Z');
    const r = await timer(9, 'pause', { technician_id: 21, reason: 'break' }, 'Pause WO-1', at);
    expect(r.queued).toBe(true);
    expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ module: 'garage', entity: 'work_order', entityId: '9', method: 'POST', path: '/api/garage/v1/work-orders/9/pause', queueIfOffline: true, body: { technician_id: 21, reason: 'break', at: '2026-09-29T04:30:00.000Z' } }));
  });

  it('does not queue a refusal: the server’s reason is the answer', async () => {
    vi.mocked(request).mockRejectedValue(new ApiError(422, 'Another timer of yours is running.', null));
    await expect(timer(9, 'start', { technician_id: 21 }, 'Start WO-1')).rejects.toThrow('Another timer of yours is running.');
    expect(call).not.toHaveBeenCalled();
  });
});

const mywork = (over: Partial<MyWorkData> = {}): MyWorkData => ({
  technician: true,
  running: null,
  pause_reasons: ['break', 'parts'],
  work: [
    {
      id: 9, job_id: 40, code: 'WO-1', work_type: 'Brake service', description: null, status: 'ASSIGNED', is_additional: false, estimated_minutes: 90, logged_minutes: 0,
      started_at: null, completed_at: null, bay: { id: 2, code: 'B2', name: null }, lines: [{ id: 1, type: 'LABOUR', description: 'Replace front pads', qty: 1, labour_minutes: 60 }],
      technicians: [{ id: 21, name: 'Nimal', role: 'LEAD', user_id: 5, running: false }],
      job_number: 'JOB-2026-000040', priority: 'HIGH', target: null, job_status: 'READY_TO_START', vehicle: 'CAB-1234 · Toyota Axio', my_role: 'LEAD', my_technician_id: 21,
    },
  ],
  ...over,
});

describe('Garage: my work', () => {
  it('shows the technician’s work and starts its timer', async () => {
    vi.mocked(apiGet).mockResolvedValue(mywork());
    vi.mocked(request).mockResolvedValue(ok({}, 'Timer started.'));
    wrap(<MyWork />);
    expect(await screen.findByText('CAB-1234')).toBeTruthy();
    expect(screen.getByText('Replace front pads')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    });
    expect(vi.mocked(request).mock.calls[0]!.slice(0, 2)).toEqual(['POST', '/api/garage/v1/work-orders/9/start']);
    expect(vi.mocked(request).mock.calls[0]![2]?.body).toEqual({ technician_id: 21 });
    expect(toast).toHaveBeenCalledWith('success', 'Timer started.');
  });

  it('says so, and keeps the card running, when the start was kept offline', async () => {
    vi.mocked(apiGet).mockResolvedValue(mywork());
    vi.mocked(request).mockRejectedValue(new ApiError(0, 'unreachable', 'INTERNAL'));
    vi.mocked(call).mockResolvedValue({ delivered: false, queued: true, id: 'q1', status: null, data: null, error: null, code: null } as never);
    wrap(<MyWork />);
    await screen.findByText('CAB-1234');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    });
    expect(toast).toHaveBeenCalledWith('info', expect.stringMatching(/^Offline/));
    expect(screen.getByText(/Started offline at/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy();
  });

  it('tells someone off the roster where they are added', async () => {
    vi.mocked(apiGet).mockResolvedValue(mywork({ technician: false, work: [] }));
    wrap(<MyWork />);
    expect(await screen.findByText('You are not on the technician roster')).toBeTruthy();
  });
});

describe('Garage: the parts counter', () => {
  it('scans the job, then the part, and opens that row ready to issue', async () => {
    vi.mocked(apiGet).mockResolvedValue({ parts: [] });
    vi.mocked(request).mockResolvedValueOnce(ok({ usage: usage(), job: { id: 40, number: 'JOB-2026-000040' } }));
    wrap(<PartsCounter />);
    const jobBox = screen.getByLabelText('Job number');
    fireEvent.change(jobBox, { target: { value: 'job-2026-000040' } });
    fireEvent.keyDown(jobBox, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('Part barcode'));
    fireEvent.change(screen.getByLabelText('Part barcode'), { target: { value: '8901234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Find/ }));
    });
    expect(vi.mocked(request).mock.calls[0]![2]?.body).toEqual({ job: 'JOB-2026-000040', code: '8901234', org: '3' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Issue Brake pads · JOB-2026-000040')).toBeTruthy();
    vi.mocked(request).mockResolvedValueOnce(ok({}, 'Issued 2 Brake pads.'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Issue$/ }));
    });
    expect(vi.mocked(request).mock.calls[1]!.slice(0, 2)).toEqual(['POST', '/api/garage/v1/parts-usage/7/issue']);
    expect(vi.mocked(request).mock.calls[1]![2]?.body).toMatchObject({ qty: 2 });
  });

  it('will not issue more than approved without a reason from someone who may', async () => {
    vi.mocked(apiGet).mockResolvedValue({ parts: [usage()] });
    wrap(<PartsCounter />);
    fireEvent.click(await screen.findByRole('button', { name: /^Issue$/ }));
    fireEvent.change(screen.getByLabelText(/^How many/), { target: { value: '3' } });
    expect(screen.getByText(/That is more than the customer approved/)).toBeTruthy();
    const issue = screen.getAllByRole('button', { name: /^Issue$/ }).at(-1) as HTMLButtonElement;
    expect(issue.disabled).toBe(true);
  });
});

describe('Garage: a job card', () => {
  it('moves the job on with the move the server offers, and sends check-in to the web', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path.endsWith('/work')
        ? { job_status: 'CHECKED_IN', work_orders: [], parts: [] }
        : {
            job: { id: 40, number: 'JOB-2026-000040', status: 'DRAFT', status_label: 'Draft', priority: 'NORMAL', job_type: 'SERVICE', vehicle: { id: 3, number: 'CAB-1234', make: 'Toyota', model: 'Axio', type: 'car' }, fleet: false, customer: { id: 8, name: 'Kamal Perera', phone: null }, advisor: 'Hasarinda', advisor_initials: 'H', target: null, overdue: false, late_minutes: 0, checkin_at: null, created_at: null, completed_at: null, additional: false, total: null, workshop: null, branch: { id: 1, name: 'Colombo' }, requested_services: 'Full service', odometer_in: null, fuel_in: null, cancel_reason: null, source: 'walk_in' },
            customer: { id: 8, name: 'Kamal Perera', phone: '0771234567', email: null },
            vehicle: null,
            checkin: null,
            history: [],
            notes: [],
            choices: [{ to: 'CHECKED_IN', label: 'Mark checked in' }],
            cancel_reasons: ['customer_declined'],
            can: { edit: true, checkin: true, cancel: true },
          },
    );
    vi.mocked(request).mockResolvedValue(ok({}, 'Checked in.'));
    wrap(<JobCard id={40} onBack={() => undefined} />);
    expect(await screen.findByText('CAB-1234')).toBeTruthy();
    expect(screen.getByText('Asked for: Full service')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark checked in' }));
    });
    expect(vi.mocked(request).mock.calls[0]!.slice(0, 2)).toEqual(['POST', '/api/garage/v1/jobs/40/move']);
    expect(vi.mocked(request).mock.calls[0]![2]?.body).toEqual({ to: 'CHECKED_IN' });
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/garage?checkin=40' });
  });
});

describe('Garage: a walk-in', () => {
  it('asks before a second job card for a vehicle with an open job, and makes it on purpose', async () => {
    const onCreated = vi.fn();
    vi.mocked(request)
      .mockRejectedValueOnce(new ApiError(409, 'CAB-1234 already has an open job.', null, { open: [{ id: 39, number: 'JOB-2026-000039' }] }))
      .mockResolvedValueOnce(ok({ id: 41, number: 'JOB-2026-000041' }, 'Job created.'));
    wrap(
      <JobForm
        vehicle={{ id: 3, vehicle_number: 'CAB-1234', vin: null, vehicle_type: 'car', make: 'Toyota', model: 'Axio', year: 2019, colour: null, odometer: null, client_id: 8, customer_name: 'Kamal', customer_phone: null }}
        customer={{ id: 8, name: 'Kamal', phone: null, email: null }}
        onClearVehicle={() => undefined}
        onClearCustomer={() => undefined}
        onCreated={onCreated}
      />,
    );
    const complaint = screen.getByLabelText('Complaint');
    fireEvent.change(complaint, { target: { value: 'Pulls to the left' } });
    fireEvent.keyDown(complaint, { key: 'Enter' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create the job' }));
    });
    expect(vi.mocked(request).mock.calls[0]![2]?.body).toMatchObject({ branch_id: 1, client_id: 8, vehicle_id: 3, complaints: ['Pulls to the left'], confirm_open: false });
    expect(await screen.findByText('This vehicle has an open job')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create another job card' }));
    });
    const first = vi.mocked(request).mock.calls[0]![2]?.headers?.['Idempotency-Key'];
    const second = vi.mocked(request).mock.calls[1]![2];
    expect(second?.body).toMatchObject({ confirm_open: true });
    expect(second?.headers?.['Idempotency-Key']).toBe(`${first}-again`);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(41));
  });
});
