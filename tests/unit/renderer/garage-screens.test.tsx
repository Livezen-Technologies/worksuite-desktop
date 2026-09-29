// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({ granted: false })), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, hasDesktop: () => false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ auth: { user: { id: '5' } }, bootstrap: { permissions: ['garage.access', 'crm.account'] }, status: { network: 'ONLINE' }, apps: [] }) };
});

import { toast } from '../../../src/core/toasts';
import type * as g from '../../../src/modules/garage/api';
import Board from '../../../src/modules/garage/Board';
import JobCard from '../../../src/modules/garage/JobCard';
import Checkin from '../../../src/modules/garage/job/Checkin';
import { GarageRail } from '../../../src/modules/garage/Rail';
import WalkIn from '../../../src/modules/garage/WalkIn';
import { can, checkin, company, fail, job, job360, ok, OPTIONS } from './garage-fixtures';

/**
 * The Garage screens against the stage-A contract, with the server played by
 * a routed fetch: what is sent, and that what the server says is what is shown.
 */
type Handler = (body: unknown, init: RequestInit) => Response | Promise<Response>;
let sent: Array<{ method: string; path: string; body: unknown; ifMatch: string | null }> = [];

function serve(routes: Record<string, Handler>) {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/__api/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    sent.push({ method, path, body, ifMatch: new Headers(init.headers).get('If-Match') });
    const h = routes[`${method} ${path}`];
    if (!h) return fail(404, `No route for ${method} ${path}`);
    return h(body, init);
  });
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => vi.mocked(toast).mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── the board ───────────────────────────────────────────────────────────

describe('the job board', () => {
  const board: g.BoardData = {
    columns: [
      { code: 'approval', label: 'Approval', statuses: ['awaiting_customer_approval'], count: 1, jobs: [job()] },
      { code: 'waiting_parts', label: 'Waiting parts', statuses: ['approved', 'waiting_parts'], count: 0, jobs: [] },
    ],
    bays: [],
    updated_at: null,
  };
  const refusal = 'Estimate not approved: record the customer’s decision on the estimate.';

  it('asks the server when a card is dropped, and when it refuses the card stays and its sentence is shown', async () => {
    serve({
      'GET /api/garage/board': () => ok(board),
      'GET /api/garage/jobs/12': () => ok({ job: job360({ transitions: [{ to: 'approved', label: 'Approved', on: 'customer_approved', allowed: false, why: refusal, needs: [] }] }) }),
      'POST /api/garage/jobs/12/transition': () => fail(422, refusal, { from: 'awaiting_customer_approval', to: 'approved' }),
    });
    wrap(<Board org="" options={OPTIONS} online onJob={() => undefined} />);
    const card = await screen.findByRole('button', { name: /JOB-2026-000012/ });
    const parts = screen.getByRole('region', { name: 'Waiting parts' });

    fireEvent.dragStart(card, { dataTransfer: { setData: () => undefined, effectAllowed: '' } });
    fireEvent.dragOver(parts);
    await act(async () => {
      fireEvent.drop(parts);
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('JOB-2026-000012 was not moved.');
    expect(alert.textContent).toContain(refusal);
    expect(toast).toHaveBeenCalledWith('error', refusal);
    expect(sent.find((s) => s.method === 'POST')).toEqual({ method: 'POST', path: '/api/garage/jobs/12/transition', body: { column: 'waiting_parts' }, ifMatch: '3' });
    // Never a client-only move: the card is where the server has it.
    expect(within(screen.getByRole('region', { name: 'Approval' })).getByRole('button', { name: /JOB-2026-000012/ })).toBeTruthy();
    expect(within(parts).queryByRole('button', { name: /JOB-2026-000012/ })).toBeNull();
  });

  it('asks the same with Alt+→ on a focused card, and takes the server’s yes by reading the board again', async () => {
    let moved = false;
    serve({
      'GET /api/garage/board': () =>
        ok(
          moved
            ? { ...board, columns: [{ ...board.columns[0]!, count: 0, jobs: [] }, { ...board.columns[1]!, count: 1, jobs: [job({ status: 'approved', status_label: 'Approved', column: 'waiting_parts', version: 4 })] }] }
            : board,
        ),
      'GET /api/garage/jobs/12': () => ok({ job: job360() }),
      'POST /api/garage/jobs/12/transition': () => {
        moved = true;
        return ok({ job: job360({ status: 'approved' }) }, 'Moved to Approved.');
      },
    });
    wrap(<Board org="" options={OPTIONS} online onJob={() => undefined} />);
    const card = await screen.findByRole('button', { name: /JOB-2026-000012/ });
    await act(async () => {
      fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true });
    });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Waiting parts' })).getByRole('button', { name: /JOB-2026-000012/ })).toBeTruthy());
    expect(toast).toHaveBeenCalledWith('success', 'Moved to Approved.');
  });

  it('does not drag or send anything offline', async () => {
    serve({ 'GET /api/garage/board': () => ok(board) });
    wrap(<Board org="" options={OPTIONS} online={false} onJob={() => undefined} />);
    const card = await screen.findByRole('button', { name: /JOB-2026-000012/ });
    expect(card.getAttribute('draggable')).toBe('false');
    await act(async () => {
      fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true });
    });
    expect(sent.filter((s) => s.method !== 'GET')).toEqual([]);
    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('offline'));
  });
});

// ── the job card ────────────────────────────────────────────────────────

describe('the job card', () => {
  const transitions: g.Transition[] = [
    { to: 'inspection', label: 'Start inspection', on: 'start_inspection', allowed: true, why: null, needs: [] },
    { to: 'diagnosis', label: 'Start diagnosis', on: 'start_diagnosis', allowed: false, why: 'This pipeline inspects first.', needs: [] },
    { to: 'estimate_preparation', label: 'Express estimate', on: 'express', allowed: false, why: 'You do not have permission to do that.', needs: [] },
    { to: 'cancelled', label: 'Cancelled', on: 'cancel', allowed: true, why: null, needs: ['reason'] },
  ];
  const mount = (j: g.Job360, options: g.Options = OPTIONS) =>
    wrap(<JobCard id={12} tab={null} options={options} online onTab={() => undefined} onBack={() => undefined} onJob={() => undefined} onVehicle={() => undefined} onCustomer={() => undefined} />);

  it('offers only what the reader may do: no cancel or edit without the permission, no move refused for permission', async () => {
    serve({ 'GET /api/garage/jobs/12': () => ok({ job: job360({ status: 'checked_in', status_label: 'Checked in', column: 'check_in', transitions, can: { edit: false, checkin: false, cancel: false, assign: false, publish_media: false, override_odometer: false } }) }) });
    mount(job360());
    expect(await screen.findByRole('button', { name: /Start inspection/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cancel job/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit$/ })).toBeNull();
    expect(screen.getByText('This pipeline inspects first.')).toBeTruthy();
    expect(screen.queryByText(/permission/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Express estimate/ })).toBeNull();
    // Money is for those who may see estimates.
    expect(screen.queryByRole('tab', { name: 'Estimate' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Work orders' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('moves with the version it read, and shows the job as the server answered', async () => {
    let now = job360({ status: 'checked_in', status_label: 'Checked in', column: 'check_in', transitions });
    serve({
      'GET /api/garage/jobs/12': () => ok({ job: now }),
      'POST /api/garage/jobs/12/transition': () => {
        now = job360({ status: 'inspection', status_label: 'Inspection', column: 'diagnosis', version: 4, transitions: [] });
        return ok({ job: now }, 'Moved to Inspection.');
      },
    });
    mount(job360());
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Start inspection/ }));
    });
    expect(sent.find((s) => s.method === 'POST')).toEqual({ method: 'POST', path: '/api/garage/jobs/12/transition', body: { to: 'inspection' }, ifMatch: '3' });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Job' })).getByText('Inspection')).toBeTruthy());
  });

  it('cancels with a reason from the list, and words when the reason is "other"', async () => {
    serve({
      'GET /api/garage/jobs/12': () => ok({ job: job360({ status: 'checked_in', column: 'check_in', transitions }) }),
      'POST /api/garage/jobs/12/cancel': () => ok({ job: job360({ status: 'cancelled', status_label: 'Cancelled', transitions: [] }) }, 'Job cancelled.'),
    });
    mount(job360());
    fireEvent.click(await screen.findByRole('button', { name: /Cancel job/ }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Cancel the job' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Reason' }));
    fireEvent.click(screen.getByRole('option', { name: 'Other' }));
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Say why' }), { target: { value: 'Customer took it elsewhere' } });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(sent.find((s) => s.method === 'POST')).toEqual({ method: 'POST', path: '/api/garage/jobs/12/cancel', body: { reason_code: 'other', reason: 'Customer took it elsewhere' }, ifMatch: '3' });
    expect(toast).toHaveBeenCalledWith('success', 'Job cancelled.');
  });

  it('shows the job as it is now when somebody else changed it first', async () => {
    let now = job360({ status: 'checked_in', column: 'check_in', transitions });
    const theirs = job360({ status: 'inspection', status_label: 'Inspection', version: 5, transitions: [] });
    serve({
      'GET /api/garage/jobs/12': () => ok({ job: now }),
      'POST /api/garage/jobs/12/transition': () => {
        now = theirs;
        return fail(409, 'Somebody changed this job after you read it.', { code: 'version_conflict', server_version: 5, server: theirs });
      },
    });
    mount(job360());
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Start inspection/ }));
    });
    expect(toast).toHaveBeenCalledWith('error', 'Somebody changed this job after you read it. This is the job as it is now.');
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Job' })).getByText('Inspection')).toBeTruthy());
  });
});

// ── the check-in ────────────────────────────────────────────────────────

describe('the check-in', () => {
  const draft = job360({ status: 'draft', status_label: 'Draft', column: 'check_in', can: { edit: true, checkin: true, cancel: true, assign: false, publish_media: false, override_odometer: false }, checkin: checkin({ missing: ['the odometer reading', '4 more photos (4 in all)'] }) });

  it('lists what the company still asks for, and shows the server’s refusal with its list when completing too early', async () => {
    serve({ 'POST /api/garage/jobs/12/checkin': () => fail(422, 'Before the vehicle is checked in, record: the odometer reading; 4 more photos (4 in all).', { missing: ['the odometer reading', '4 more photos (4 in all)'] }) });
    const onChanged = vi.fn();
    wrap(<Checkin job={draft} company={company(1)} options={OPTIONS} online onChanged={onChanged} onJob={() => undefined} />);
    expect(screen.getByText(/Still to record:/).parentElement!.textContent).toContain('the odometer reading; 4 more photos (4 in all)');

    fireEvent.click(screen.getByRole('button', { name: 'Warning light' }));
    fireEvent.click(screen.getByRole('radio', { name: '1/2' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Check the vehicle in/ }));
    });

    const post = sent.find((s) => s.method === 'POST')!;
    expect(post.path).toBe('/api/garage/jobs/12/checkin');
    expect(post.body).toMatchObject({ complete: true, fuel_level: 50, complaints: [{ quick_pick: 'warning_light', text: 'Warning light' }] });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Before the vehicle is checked in, record');
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['the odometer reading', '4 more photos (4 in all)']);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('asks why a lower odometer reading is lower, of those allowed to record one', () => {
    const j = job360({ ...draft, vehicle: { ...job().vehicle!, odometer: 84250 } });
    const { unmount } = wrap(<Checkin job={j} company={company(1, { can: can({ override_odometer: true }) })} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Odometer' }), { target: { value: '80000' } });
    expect(screen.getByRole('textbox', { name: 'Why the odometer is lower' })).toBeTruthy();
    unmount();
    wrap(<Checkin job={j} company={company(1)} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Odometer' }), { target: { value: '80000' } });
    expect(screen.queryByRole('textbox', { name: 'Why the odometer is lower' })).toBeNull();
    expect(screen.getByText(/only somebody allowed to accept a lower reading/)).toBeTruthy();
  });

  it('is the read-only record once the vehicle is checked in', () => {
    wrap(<Checkin job={job360({ status: 'checked_in', checkin: checkin({ status: 'completed', odometer: 84300, completed_at: '2026-09-29T04:00:00Z' }) })} company={company(1)} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    expect(screen.getByText(/This is the record of how the vehicle arrived/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Check the vehicle in/ })).toBeNull();
    expect(screen.getByText('84,300 km')).toBeTruthy();
  });
});

// ── the walk-in ─────────────────────────────────────────────────────────

describe('a walk-in', () => {
  const found = {
    customers: [{ id: 1, name: 'Dilani Fernando', phone: '+94771234567', email: null, contact_person: null, account_type: 'customer', vehicles: 1, open_jobs: 1 }],
    vehicles: [{ id: 7, org_id: 1, vehicle_number: 'WP CAB-1234', vin: null, make: 'Toyota', model: 'Prius', year: 2016, customer_id: 1, customer: { id: 1, name: 'Dilani Fernando', phone: '+94771234567', email: null }, open_job: { id: 12, job_number: 'JOB-2026-000012', status: 'checked_in' } }],
  };

  it('finds the vehicle with one search, warns of its open job, and opens a second only when confirmed', async () => {
    let tries = 0;
    serve({
      'GET /api/garage/walk-in/search': () => ok(found),
      'GET /api/garage/customers/1': () => ok({ customer: found.customers[0], vehicles: [], open_jobs: [], history: [], balance: null }),
      'POST /api/garage/walk-in': (body) => {
        tries++;
        return (body as { confirm_open_job?: boolean }).confirm_open_job ? ok({ job: job360({ id: 13, number: 'JOB-2026-000013', status: 'draft' }) }, 'JOB-2026-000013 opened.') : fail(409, 'WP CAB-1234 already has a job open.', { code: 'open_job', open_job: found.vehicles[0]!.open_job });
      },
    });
    const onDone = vi.fn();
    const onJob = vi.fn();
    wrap(<WalkIn org="" options={OPTIONS} online seedVehicle={null} onDone={onDone} onJob={onJob} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Find the customer or vehicle' }), { target: { value: 'CAB 1234' } });
    fireEvent.click(await screen.findByRole('button', { name: /WP CAB-1234/ }));
    // Warned before anything is sent.
    expect(screen.getByRole('alert').textContent).toContain('already has JOB-2026-000012 open');
    expect(screen.queryByRole('button', { name: 'Open a second job' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open the job/ }));
    });
    expect(sent.filter((s) => s.method === 'POST').map((s) => s.body)).toEqual([{ org_id: 1, priority: 'normal', job_type: 'service', customer_id: 1, vehicle_id: 7 }]);
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open a second job' }));
    });
    expect(tries).toBe(2);
    expect(sent.filter((s) => s.method === 'POST')[1]!.body).toMatchObject({ vehicle_id: 7, confirm_open_job: true });
    expect(onDone).toHaveBeenCalledWith(13);

    fireEvent.click(screen.getByRole('button', { name: 'Open JOB-2026-000012' }));
    expect(onJob).toHaveBeenCalledWith(12);
  });

  it('adds a missing customer and vehicle with the job, and uses what was added when the server refuses after adding', async () => {
    const posts: unknown[] = [];
    serve({
      'GET /api/garage/walk-in/search': () => ok({ customers: [], vehicles: [] }),
      'GET /api/garage/vehicles/lookup': () => ok({ items: [] }),
      'GET /api/garage/customers/44': () => ok({ customer: { id: 44, name: 'Kamal Silva', phone: null, email: null }, vehicles: [], open_jobs: [], history: [], balance: null }),
      'POST /api/garage/walk-in': (body) => {
        posts.push(body);
        return posts.length === 1 ? fail(422, 'Say which branch the vehicle is at.', { field: 'branch_id', added: { customer: { id: 44, name: 'Kamal Silva', phone: null, email: null } } }) : ok({ job: job360({ id: 14 }) }, 'Opened.');
      },
    });
    const onDone = vi.fn();
    wrap(<WalkIn org="" options={{ ...OPTIONS, companies: [company(1, { branches: [] })] }} online seedVehicle={null} onDone={onDone} onJob={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Find the customer or vehicle' }), { target: { value: 'Kamal Silva' } });
    fireEvent.click(screen.getByRole('button', { name: /New customer/ }));
    expect((screen.getByRole('textbox', { name: 'Customer name' }) as HTMLInputElement).value).toBe('Kamal Silva');
    fireEvent.click(screen.getByRole('button', { name: /New vehicle/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Vehicle number' }), { target: { value: 'car-9876' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open the job/ }));
    });
    expect(posts[0]).toMatchObject({ customer: { name: 'Kamal Silva' }, vehicle: { vehicle_number: 'CAR-9876' } });
    expect(screen.getByRole('alert').textContent).toContain('Say which branch the vehicle is at.');
    expect(screen.getByRole('alert').textContent).toContain('Added before it stopped: the customer Kamal Silva');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open the job/ }));
    });
    expect(posts[1]).toMatchObject({ customer_id: 44, vehicle: { vehicle_number: 'CAR-9876' } });
    expect(posts[1]).not.toHaveProperty('customer');
    expect(onDone).toHaveBeenCalledWith(14);
  });

  it('offers adding a vehicle only to those who manage vehicles, and nothing to those who may not open jobs', () => {
    serve({});
    const { unmount } = wrap(<WalkIn org="" options={{ ...OPTIONS, companies: [company(1, { can: can({ manage_vehicles: false }) })] }} online seedVehicle={null} onDone={() => undefined} onJob={() => undefined} />);
    expect(screen.queryByRole('button', { name: /New vehicle/ })).toBeNull();
    expect(screen.getByText(/Adding vehicles is for those who manage them/)).toBeTruthy();
    unmount();
    wrap(<WalkIn org="" options={{ ...OPTIONS, companies: [company(1, { can: can({ create: false }) })] }} online seedVehicle={null} onDone={() => undefined} onJob={() => undefined} />);
    expect(screen.getByText(/Opening jobs is for those who may create them/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Open the job/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── the rail ────────────────────────────────────────────────────────────

describe('the rail', () => {
  const base = { current: 'board', onView: () => undefined, counts: { approval: 2, ready: 1, delivered: 5 }, org: '', companies: [company(1)], onOrg: () => undefined, extra: [], setupLeft: 0 };

  it('shows only what the reader may use', () => {
    const { unmount } = render(<GarageRail {...base} onWalkIn={null} show={{ overview: false, jobs: true, customers: true, vehicles: false, setup: false, settings: false }} />);
    const nav = screen.getByRole('navigation', { name: 'Garage' });
    expect(within(nav).queryByRole('button', { name: /New walk-in/ })).toBeNull();
    expect(within(nav).queryByRole('button', { name: /Overview/ })).toBeNull();
    expect(within(nav).queryByRole('button', { name: /^Vehicles/ })).toBeNull();
    expect(within(nav).queryByRole('button', { name: /Settings/ })).toBeNull();
    // Open jobs on the board: every column but the delivered ones.
    expect(within(nav).getByRole('button', { name: /Job board/ }).textContent).toContain('3');
    unmount();
    render(<GarageRail {...base} onWalkIn={() => undefined} setupLeft={1} show={{ overview: true, jobs: true, customers: true, vehicles: true, setup: true, settings: true }} />);
    expect(screen.getByRole('button', { name: /New walk-in/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Set-up/ }).textContent).toContain('1');
  });
});
