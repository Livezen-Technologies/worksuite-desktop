// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, hasDesktop: () => false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ auth: { user: { id: '5' } }, bootstrap: { permissions: ['garage.access'] }, status: { network: 'ONLINE' }, apps: [] }) };
});

import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import type * as g from '../../../src/modules/garage/api';
import { cell, handoverBody, hasKey, invoiceLine, issueBody, moneyList, peopleOf, reworkOrders, selfQcBlocked, type DeliveryTab, type QcItem, type QcTab, type RoadTestsTab, type ScanAnswer } from '../../../src/modules/garage/api-b3';
import { amount } from '../../../src/modules/garage/api';
import { ServiceHistory } from '../../../src/modules/garage/History';
import Delivery from '../../../src/modules/garage/job/Delivery';
import Quality from '../../../src/modules/garage/job/Quality';
import RoadTests, { roadTestBody } from '../../../src/modules/garage/job/RoadTests';
import PartsCounter from '../../../src/modules/garage/views/PartsCounter';
import Reports from '../../../src/modules/garage/views/Reports';
import { can, company, fail, job, job360, ok, OPTIONS } from './garage-fixtures';

/** Stage B3 on the desktop, against its contract (`web-api-b3.md`). */
let sent: Array<{ method: string; path: string; search: string; body: unknown }> = [];
function serve(routes: Record<string, (body: unknown, search: URLSearchParams) => Response>) {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/__api/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    sent.push({ method, path, search: u.search, body });
    const h = routes[`${method} ${path}`];
    return h ? h(body, u.searchParams) : fail(404, `No route for ${method} ${path}`);
  });
}
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const writes = () => sent.filter((s) => s.method !== 'GET');

beforeEach(() => {
  vi.mocked(toast).mockReset();
  vi.mocked(call).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── what the screens send ───────────────────────────────────────────────

describe('what stage B3 sends and shows', () => {
  it('issues at the counter with the override only when it is asked for, and always with its reason', () => {
    const base = { job: ' JOB-2026-000012 ', code: ' 4901234567894 ', qty: '2', serial: '', batch: '', technician: '', override: false, reason: 'ignored' };
    expect(issueBody(base)).toEqual({ job: 'JOB-2026-000012', code: '4901234567894', qty: 2 });
    expect(issueBody({ ...base, qty: '', serial: ' SN-9 ', batch: 'B7', technician: '8' })).toEqual({ job: 'JOB-2026-000012', code: '4901234567894', qty: 1, serial_no: 'SN-9', batch_no: 'B7', technician_id: 8 });
    expect(issueBody({ ...base, override: true, reason: ' Pads worn on both axles ' })).toMatchObject({ override: true, override_reason: 'Pads worn on both axles' });
  });

  it('hands over with what the counter recorded and the signature, the overrides only when given', () => {
    const f = { odometer: '84310', fuel: '3/4', receivedBy: ' Dilani Fernando ', relation: '', signature: 'data:image/png;base64,AAAA', items: ['jack'], removedReturned: true, notes: ' ', summary: 'Pads and discs replaced.', override: '', odometerReason: '' };
    expect(handoverBody(f)).toEqual({
      odometer: 84310,
      fuel_level: '3/4',
      received_by_name: 'Dilani Fernando',
      signature: { image: 'data:image/png;base64,AAAA', signer_name: 'Dilani Fernando', relation: null, device: 'WorkSuite Desktop' },
      items_returned: ['jack'],
      removed_parts_returned: true,
      summary: 'Pads and discs replaced.',
    });
    expect(handoverBody({ ...f, override: 'Fleet account, paid monthly', odometerReason: 'Cluster replaced' })).toMatchObject({ override_reason: 'Fleet account, paid monthly', odometer_override_reason: 'Cluster replaced' });
  });

  it('records a road test once: the same key on every press, the times as instants, the rest only when given', () => {
    const f = { start: '2026-09-29T10:00', end: '2026-09-29T10:20', startKm: '84250', endKm: '', route: ' ', issueConfirmed: true, repairVerified: true, newIssue: '', result: 'passed', notes: '' };
    const body = roadTestBody(f, 'k-1');
    expect(body).toMatchObject({ start_odometer: 84250, issue_confirmed: true, repair_verified: true, result: 'passed', client_temp_id: 'k-1' });
    expect(body).not.toHaveProperty('end_odometer');
    expect(body).not.toHaveProperty('route');
    expect(String(body.started_at)).toMatch(/Z$/);
    expect(roadTestBody({ ...f, result: '' }, 'k-1')).not.toHaveProperty('result');
  });

  it('sends back the work orders named on failed items unless others are chosen, and explains a self-check early', () => {
    const item = (id: number, result: QcItem['result'], wo: number | null): QcItem => ({ id, label: `Item ${id}`, mandatory: true, result, passed: result === null ? null : result === 'pass', note: null, work_order_id: wo, answered_by: null, answered_at: null, media: [] });
    const cur = { items: [item(1, 'fail', 31), item(2, 'fail', 31), item(3, 'fail', 32), item(4, 'pass', 33), item(5, 'fail', null)] };
    expect(reworkOrders(cur, [])).toEqual([31, 32]);
    expect(reworkOrders(cur, [40])).toEqual([40]);
    expect(reworkOrders(null, [])).toEqual([]);
    expect(selfQcBlocked({ you_worked_on_it: true, self_qc_allowed: false })).toBe(true);
    expect(selfQcBlocked({ you_worked_on_it: true, self_qc_allowed: true })).toBe(false);
    expect(selfQcBlocked({ you_worked_on_it: false, self_qc_allowed: false })).toBe(false);
  });

  it('shows figures as the server sent them: report cells, money per currency, history people and invoices', () => {
    expect(cell(null)).toBe('—');
    expect(cell(['a', 2])).toBe('a, 2');
    expect(cell(true)).toBe('Yes');
    expect(cell('12500.00')).toBe('12500.00');
    expect(moneyList([{ currency: 'LKR', amount: '125000.5' }, { currency: 'USD', amount: '40' }])).toBe('LKR 125,000.50 · USD 40.00');
    expect(moneyList([])).toBe('—');
    expect(peopleOf([{ id: 8, name: 'Nimal J.', role: 'lead' }, { id: 9, name: 'Kasun', role: 'helper' }, { id: 8, name: 'Nimal J.', role: 'lead' }])).toBe('Nimal J., Kasun');
    expect(peopleOf(['Nimal J.'])).toBe('Nimal J.');
    expect(invoiceLine({ id: 5, number: 'INV-0042', status: 'partial', currency: 'LKR', total: '48000.00', paid: '20000.00', outstanding: '28000.00' }, amount)).toBe('INV-0042 · partial · LKR 48,000.00, LKR 28,000.00 outstanding');
    // Without the money permission the server sends no amounts: none are made up.
    expect(invoiceLine({ id: 5, number: null, status: 'draft' }, amount)).toBe('#5 · draft');
  });

  it('opens a stage-B3 tab only when the server sent its key', () => {
    expect(hasKey('parts')(job360())).toBe(false);
    expect(hasKey('qc')(job360({ qc: null } as Partial<g.Job360>))).toBe(false);
    expect(hasKey('delivery')(job360({ delivery: { handover: null } } as Partial<g.Job360>))).toBe(true);
  });
});

// ── the parts counter: issue by scan ────────────────────────────────────

const scanned = (over: Partial<ScanAnswer> = {}): ScanAnswer => ({
  job: job({ status: 'in_progress', status_label: 'In progress' }),
  product: { id: 44, name: 'Brake pads (front)', code: 'BP-100', tracking: 'none', unit: 'set' },
  serial_no: null,
  request: { id: 71, status: 'reserved', qty: 1, reserved_outstanding: 1 },
  approved: 1,
  issued: 0,
  available: 6,
  warehouse_id: 2,
  over_approved: false,
  why: null,
  ...over,
});
const queue = { items: [{ id: 71, status: 'reserved', status_label: 'Reserved', urgency: 'urgent', qty: 1, reason: null, requisition_ref: null, job: { id: 12, number: 'JOB-2026-000012', status: 'in_progress', vehicle: 'WP CAB-1234' }, product: { id: 44, name: 'Brake pads (front)', code: 'BP-100' }, warehouse_id: 2, available: 6, work_order_id: null, requested_at: null, age_days: 0 }], meta: { total: 1, page: 1, per_page: 25, pages: 1 } };
const withCan = (over: Partial<Record<g.CanKey, boolean>>): g.Options => ({ ...OPTIONS, companies: [company(1, { can: can({ parts_issue: true, ...over }) })] });

describe('the parts counter', () => {
  it('takes a scanner’s Enter from the job to the part, looks the part up, issues it, and is ready for the next part', async () => {
    serve({
      'GET /api/garage/parts/queue': () => ok(queue),
      'GET /api/garage/parts/scan': () => ok(scanned()),
      'POST /api/garage/parts/issue': () => ok({ request: { id: 71 }, job: job360() }, 'Issued 1 × Brake pads (front) to JOB-2026-000012.'),
    });
    wrap(<PartsCounter org="" options={withCan({})} online onJob={vi.fn()} />);
    expect(await screen.findByText('Brake pads (front)')).toBeTruthy();
    const jobBox = screen.getByLabelText('Job number');
    const partBox = screen.getByLabelText('Part barcode, code or serial');
    fireEvent.change(jobBox, { target: { value: 'JOB-2026-000012' } });
    fireEvent.keyDown(jobBox, { key: 'Enter' });
    expect(document.activeElement).toBe(partBox);
    fireEvent.change(partBox, { target: { value: '4901234567894' } });
    fireEvent.keyDown(partBox, { key: 'Enter' });
    const card = await screen.findByRole('region', { name: 'What will be issued' });
    expect(sent.find((s) => s.path === '/api/garage/parts/scan')?.search).toBe('?job=JOB-2026-000012&code=4901234567894&qty=1');
    expect(within(card).getByText(/Approved 1 · issued 0 · on the shelf 6/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /Issue/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', path: '/api/garage/parts/issue', body: { job: 'JOB-2026-000012', code: '4901234567894', qty: 1 } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Issued 1 × Brake pads (front) to JOB-2026-000012.'));
    // Ready for the next part of the same job.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'What will be issued' })).toBeNull());
    expect(document.activeElement).toBe(partBox);
    expect((jobBox as HTMLInputElement).value).toBe('JOB-2026-000012');
  });

  it('asks a manager for a reason to issue beyond the approval, and shows the server’s refusal', async () => {
    serve({
      'GET /api/garage/parts/queue': () => ok(queue),
      'GET /api/garage/parts/scan': () => ok(scanned({ approved: 1, issued: 1, over_approved: true, why: 'The customer approved 1; 1 is issued already.' })),
      'POST /api/garage/parts/issue': () => fail(409, 'Inventory has none of these left at Colombo.', { code: 'not_issued' }),
    });
    wrap(<PartsCounter org="" options={withCan({ assign: true })} online onJob={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Job number'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Part barcode, code or serial'), { target: { value: 'BP-100' } });
    fireEvent.keyDown(screen.getByLabelText('Part barcode, code or serial'), { key: 'Enter' });
    const card = await screen.findByRole('region', { name: 'What will be issued' });
    expect(within(card).getByText('The customer approved 1; 1 is issued already.')).toBeTruthy();
    const issue = within(card).getByRole('button', { name: /Issue$/ }) as HTMLButtonElement;
    expect(issue.disabled).toBe(true);
    fireEvent.click(within(card).getByLabelText(/Issue beyond the approval/));
    expect(issue.disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText('Why beyond the approval'), { target: { value: 'Rear pads worn too' } });
    expect(issue.disabled).toBe(false);
    fireEvent.click(issue);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Inventory has none of these left at Colombo.'));
    expect(writes()[0]!.body).toMatchObject({ override: true, override_reason: 'Rear pads worn too' });
    // Refused: nothing moved, the card stays for another try.
    expect(screen.getByRole('region', { name: 'What will be issued' })).toBeTruthy();
  });

  it('offers no override to whoever may not give it, and issues nothing offline', async () => {
    serve({ 'GET /api/garage/parts/queue': () => ok(queue), 'GET /api/garage/parts/scan': () => ok(scanned({ over_approved: true, approved: 1, issued: 1 })) });
    const view = wrap(<PartsCounter org="" options={withCan({ assign: false })} online onJob={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Job number'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Part barcode, code or serial'), { target: { value: 'BP-100' } });
    fireEvent.keyDown(screen.getByLabelText('Part barcode, code or serial'), { key: 'Enter' });
    const card = await screen.findByRole('region', { name: 'What will be issued' });
    expect(within(card).queryByLabelText(/Issue beyond the approval/)).toBeNull();
    expect(within(card).getByText(/a workshop manager can issue it with a reason/)).toBeTruthy();
    expect((within(card).getByRole('button', { name: /Issue$/ }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();

    const requested = { ...queue, items: [{ ...queue.items[0]!, status: 'requested', status_label: 'Requested' }] };
    serve({ 'GET /api/garage/parts/queue': () => ok(requested), 'GET /api/garage/parts/scan': () => ok(scanned()) });
    wrap(<PartsCounter org="" options={withCan({})} online={false} onJob={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Job number'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Part barcode, code or serial'), { target: { value: 'BP-100' } });
    fireEvent.keyDown(screen.getByLabelText('Part barcode, code or serial'), { key: 'Enter' });
    const offline = await screen.findByRole('region', { name: 'What will be issued' });
    expect((within(offline).getByRole('button', { name: /Issue$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: 'Reserve' })).hasAttribute('disabled')).toBe(true);
    expect(writes()).toEqual([]);
  });
});

// ── quality control ─────────────────────────────────────────────────────

const qcItem = (id: number, over: Partial<QcItem> = {}): QcItem => ({ id, label: `Check ${id}`, mandatory: true, result: null, passed: null, note: null, work_order_id: null, answered_by: null, answered_at: null, media: [], ...over });
const qcTab = (items: QcItem[], over: Partial<QcTab> = {}): QcTab => ({
  current: { id: 5, attempt: 1, status: 'in_progress', status_label: 'In progress', inspector: { id: 3, name: 'Sanduni Perera' }, started_at: '2026-09-29T08:00:00Z', completed_at: null, reason: null, items, open_items: items.filter((i) => !i.result).length, failed_items: items.filter((i) => i.result === 'fail').length },
  attempts: [],
  rework: [],
  self_qc_allowed: false,
  you_worked_on_it: false,
  can: { check: true, decide: true },
  ...over,
});
const qcJob = () => job360({ status: 'quality_check', status_label: 'Quality check', work_orders: { items: [{ id: 31, code: 'WO-1', work_type: 'Brakes', internal: false }, { id: 32, code: 'WO-2', work_type: 'Wheel alignment', internal: false }] } } as Partial<g.Job360>);
const tabProps = { company: company(1), options: OPTIONS, online: true, onChanged: vi.fn(), onJob: vi.fn() };

describe('the quality check', () => {
  it('passes only when every required item is checked and passed', async () => {
    let now = qcTab([qcItem(1, { result: 'pass', passed: true }), qcItem(2)]);
    serve({
      'GET /api/garage/jobs/12/qc': () => ok({ qc: now, statuses: {} }),
      'PATCH /api/garage/qc/5': () => {
        now = qcTab([qcItem(1, { result: 'pass', passed: true }), qcItem(2, { result: 'pass', passed: true })]);
        return ok({ job: qcJob() });
      },
      'POST /api/garage/qc/5/decide': () => ok({ job: qcJob() }, 'Quality check passed.'),
    });
    wrap(<Quality job={qcJob()} {...tabProps} />);
    expect(await screen.findByText('1 required item not yet checked.')).toBeTruthy();
    const pass = screen.getByRole('button', { name: /Pass the check/ }) as HTMLButtonElement;
    expect(pass.disabled).toBe(true);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Check 2 result' })).getByRole('radio', { name: 'Pass' }));
    await waitFor(() => expect(writes()[0]).toMatchObject({ method: 'PATCH', path: '/api/garage/qc/5', body: { items: [{ id: 2, result: 'pass' }] } }));
    await screen.findByText('Every required item passed.');
    await waitFor(() => expect((screen.getByRole('button', { name: /Pass the check/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Pass the check/ }));
    await waitFor(() => expect(writes()[1]).toMatchObject({ method: 'POST', path: '/api/garage/qc/5/decide', body: { result: 'passed' } }));
    // A failed required item: failing is the only way on.
    cleanup();
    now = qcTab([qcItem(1, { result: 'fail', passed: false, work_order_id: 31 }), qcItem(2, { result: 'pass', passed: true })]);
    serve({ 'GET /api/garage/jobs/12/qc': () => ok({ qc: now, statuses: {} }) });
    wrap(<Quality job={qcJob()} {...tabProps} />);
    expect(await screen.findByText('A required item failed.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Pass the check/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('fails with a reason, sending back the work orders the failed items name', async () => {
    serve({
      'GET /api/garage/jobs/12/qc': () => ok({ qc: qcTab([qcItem(1, { result: 'fail', passed: false, work_order_id: 31 }), qcItem(2, { result: 'pass', passed: true })]), statuses: {} }),
      'POST /api/garage/qc/5/decide': () => ok({ job: qcJob() }, 'Sent back to rework: WO-1.'),
    });
    wrap(<Quality job={qcJob()} {...tabProps} />);
    fireEvent.click(await screen.findByRole('button', { name: /Fail — send back to rework/ }));
    const sheet = await screen.findByRole('dialog');
    expect((within(sheet).getByRole('checkbox', { name: /WO-1/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByRole('checkbox', { name: /WO-2/ }) as HTMLInputElement).checked).toBe(false);
    const send = within(sheet).getByRole('button', { name: 'Send back to rework' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Why'), { target: { value: 'Pedal still soft' } });
    fireEvent.click(send);
    await waitFor(() => expect(writes()[0]).toMatchObject({ path: '/api/garage/qc/5/decide', body: { result: 'failed', reason: 'Pedal still soft', work_orders: [31] } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Sent back to rework: WO-1.'));
  });

  it('keeps whoever worked on the job from checking it, unless the company allows', async () => {
    serve({ 'GET /api/garage/jobs/12/qc': () => ok({ qc: qcTab([qcItem(1), qcItem(2)], { you_worked_on_it: true }), statuses: {} }) });
    wrap(<Quality job={qcJob()} {...tabProps} />);
    expect(await screen.findByText(/somebody else must check it/)).toBeTruthy();
    expect(screen.getAllByRole('radio').every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: /Pass the check/ })).toBeNull();
  });
});

// ── road tests ──────────────────────────────────────────────────────────

describe('road tests', () => {
  it('records one test however often Save is pressed after a refusal', async () => {
    let tries = 0;
    serve({
      'POST /api/garage/jobs/12/road-tests': () => (++tries === 1 ? fail(503, 'WorkSuite is busy. Try again.') : ok({ road_test: { id: 4 }, duplicate: tries > 2, job: job360() }, 'Road test recorded.')),
    });
    const tab: RoadTestsTab = { required: true, result_since_qc: null, tests: [], can: { record: true, send_back: true } };
    wrap(<RoadTests job={job360({ status: 'road_test', road_tests: tab } as Partial<g.Job360>)} {...tabProps} />);
    expect(screen.getByText(/This job needs a road test after the quality check/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Record a road test/ }));
    const sheet = await screen.findByRole('dialog');
    const save = within(sheet).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Started'), { target: { value: '2026-09-29T10:00' } });
    fireEvent.change(within(sheet).getByLabelText('Ended'), { target: { value: '2026-09-29T10:20' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Passed' }));
    fireEvent.click(save);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'WorkSuite is busy. Try again.'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Road test recorded.'));
    const keys = writes().map((w) => (w.body as { client_temp_id: string }).client_temp_id);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(writes()[1]!.body).toMatchObject({ result: 'passed' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// ── final review, invoice, handover ─────────────────────────────────────

const delivery = (over: Partial<DeliveryTab> = {}): DeliveryTab => ({ final_review: null, invoice: null, invoice_preview: null, release: null, handover: null, belongings: ['jack', 'spare wheel'], can: { ready: true, invoice: true, issue: true, handover: true, override_release: false }, ...over });

describe('the final review and the handover', () => {
  it('asks for the belongings, and shows the final review’s refusal as the server words it', async () => {
    const review = { items: [{ key: 'removed', label: 'Removed parts', ok: false, state: 'blocked' as const, detail: '1 removed part with no disposition' }, { key: 'items', label: 'Belongings', ok: false, state: 'confirm' as const, detail: null }], clear: false, missing: [] };
    serve({
      'GET /api/garage/jobs/12/final-review': () => ok({ review, belongings: ['jack', 'spare wheel'] }),
      'POST /api/garage/jobs/12/ready': () => fail(422, 'Final review: 1 removed part with no disposition.', { from: 'quality_check', to: 'ready_for_delivery' }),
    });
    wrap(<Delivery job={job360({ status: 'quality_check', delivery: delivery() } as Partial<g.Job360>)} {...tabProps} />);
    expect(await screen.findByText('1 removed part with no disposition')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /These are in the vehicle: jack, spare wheel/ }));
    await waitFor(() => expect(sent.some((s) => s.path === '/api/garage/jobs/12/final-review' && s.search === '?customer_items_present=1')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /Mark ready for delivery/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Final review: 1 removed part with no disposition.'));
    expect(writes()[0]).toMatchObject({ path: '/api/garage/jobs/12/ready', body: { customer_items_present: true } });
  });

  it('raises the invoice once from the server’s preview, and not while it has problems', async () => {
    const preview = { currency: 'LKR', rate: 1, lines: [{ estimate_item_id: 1, line_type: 'part', description: 'Brake pads (front)', approved_qty: 1, payer: 'customer', qty: 1, unit: 'set', unit_price: '12500.00', discount_pct: '0', basis: 'used' as const, note: null }], excluded: [{ description: 'Wiper blades', why: 'Not used on the vehicle.' }], problems: [], totals: { subtotal: '12500.00', discount: '0.00', tax: '0.00', total: '12500.00' } };
    serve({
      'GET /api/garage/jobs/12/invoice': () => ok({ invoice: null, preview, release: null, can: { create: true, issue: true, terms: false } }),
      'POST /api/garage/jobs/12/invoice': () => ok({ invoice: { id: 9 }, job: job360(), estimate_lines: { invoiced: [1], not_done: [] } }, 'Invoice INV-0042 issued.'),
    });
    wrap(<Delivery job={job360({ status: 'ready_for_delivery', delivery: delivery({ invoice_preview: preview }) } as Partial<g.Job360>)} {...tabProps} />);
    expect(await screen.findByText(/Wiper blades — Not used on the vehicle\./)).toBeTruthy();
    expect(screen.getByText('Total LKR 12,500.00')).toBeTruthy();
    expect((screen.getByLabelText('Payment terms') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Raise the invoice/ }));
    await waitFor(() => expect(writes()[0]).toMatchObject({ path: '/api/garage/jobs/12/invoice', body: { payment_terms_days: 0, issue: true } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Invoice INV-0042 issued.'));

    cleanup();
    const bad = { ...preview, problems: ['1 issued part is not yet marked used or returned.'] };
    serve({ 'GET /api/garage/jobs/12/invoice': () => ok({ invoice: null, preview: bad, release: null, can: { create: true, issue: true, terms: true } }) });
    wrap(<Delivery job={job360({ status: 'ready_for_delivery', delivery: delivery({ invoice_preview: bad }) } as Partial<g.Job360>)} {...tabProps} />);
    expect((await screen.findByRole('alert')).textContent).toBe('1 issued part is not yet marked used or returned.');
    expect((screen.getByRole('button', { name: /Raise the invoice/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('holds the vehicle until it is paid or on terms, and offers the override only to whoever may give it', async () => {
    const invoice = { id: 9, number: 'INV-0042', status: 'sent', issue_date: '2026-09-29', due_date: '2026-09-29', payment_terms_days: 0, currency: 'LKR', deleted: false, total: '12500.00', paid: '0.00', outstanding: '12500.00' };
    const release = { basis: null, why: 'The invoice is due on delivery and not paid.', invoice_status: 'sent' };
    serve({ 'GET /api/garage/jobs/12/invoice': () => ok({ invoice, preview: null, release, can: { create: false, issue: false, terms: false } }) });
    const pending = (can: DeliveryTab['can']) => job360({ status: 'invoice_pending', delivery: delivery({ invoice, release, can }) } as Partial<g.Job360>);
    const view = wrap(<Delivery job={pending(delivery().can)} {...tabProps} />);
    expect(screen.getByText('Not released yet: The invoice is due on delivery and not paid.')).toBeTruthy();
    expect(screen.getByText(/must be paid, or on the customer’s terms/)).toBeTruthy();
    expect(screen.queryByLabelText('Why release without payment')).toBeNull();
    expect((screen.getByRole('button', { name: /Hand over/ }) as HTMLButtonElement).disabled).toBe(true);
    // Payment is Billing's: this tab has no way to take it.
    expect(screen.queryByRole('button', { name: /pay/i })).toBeNull();
    view.unmount();
    wrap(<Delivery job={pending({ ...delivery().can, override_release: true })} {...tabProps} />);
    expect(screen.getByLabelText('Why release without payment')).toBeTruthy();
    view.unmount();
    cleanup();
    wrap(<Delivery job={pending({ ...delivery().can, handover: false })} {...tabProps} />);
    expect(screen.queryByRole('button', { name: /Hand over/ })).toBeNull();
  });

  it('keeps the signed delivery note, and saves a copy through the download manager', async () => {
    serve({ 'GET /api/garage/jobs/12/invoice': () => ok({ invoice: null, preview: null, release: null, can: { create: false, issue: false, terms: false } }) });
    const handover = { id: 1, handed_over_at: '2026-09-29T11:00:00Z', odometer: 84310, fuel_level: 75, delivered_by: { id: 3, name: 'Sanduni Perera' }, received_by: 'Dilani Fernando', items_returned: ['jack'], removed_parts_returned: true, release_basis: 'paid', override: null, signature: { signer: 'Dilani Fernando', relation: 'Owner', signed_at: '2026-09-29T11:00:00Z' }, document_hash: 'ab12', document_intact: true, notes: null, summary: null };
    wrap(<Delivery job={job360({ status: 'completed', delivery: delivery({ handover }) } as Partial<g.Job360>)} {...tabProps} />);
    expect(screen.getByText('Dilani Fernando (Owner)')).toBeTruthy();
    expect(screen.getByText(/Signed document intact · SHA-256 ab12/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save a copy/ }));
    expect(call).toHaveBeenCalledWith('transfers:download', { garageFile: { kind: 'delivery-note', job: 12 }, name: 'delivery-note-JOB-2026-000012.pdf' });
  });
});

// ── history and reports ─────────────────────────────────────────────────

describe('service history and reports', () => {
  it('lists each completed job with its work, parts, people and invoice, and Billing’s totals', () => {
    const onJob = vi.fn();
    render(
      <ServiceHistory
        rows={[{ job_id: 12, number: 'JOB-2026-000012', date: '2026-09-29', checked_in: null, odometer: 84250, odometer_out: 84310, vehicle: { id: 7, vehicle_number: 'WP CAB-1234', make_model: 'Toyota Prius' }, job_type: 'repair', service_type: null, complaints: ['Brakes grinding'], repairs: [{ line_type: 'labour', description: 'Replace front pads', qty: 1 }], parts: [{ product_id: 44, name: 'Brake pads (front)', qty: 1, serial_no: null }], technicians: [{ id: 8, name: 'Nimal J.', role: 'lead' }], labour_hours: 1.5, invoice_id: 9, invoice: { id: 9, number: 'INV-0042', status: 'paid' } }]}
        totals={[{ currency: 'LKR', invoiced: '12500.00', paid: '12500.00', jobs: 1 }]}
        unit="km"
        options={OPTIONS}
        onJob={onJob}
        showVehicle
      />,
    );
    expect(screen.getByText('Repair · 84,250 km → 84,310 km')).toBeTruthy();
    expect(screen.getByText('Work: Replace front pads')).toBeTruthy();
    expect(screen.getByText('Parts: Brake pads (front) × 1')).toBeTruthy();
    expect(screen.getByText('Nimal J. · 1.5 h labour')).toBeTruthy();
    expect(screen.getByText('INV-0042 · paid')).toBeTruthy();
    expect(screen.getAllByText('LKR 12,500.00', { selector: 'b' })).toHaveLength(2);
    fireEvent.click(screen.getByText('JOB-2026-000012'));
    expect(onJob).toHaveBeenCalledWith(12);
  });

  it('reads a report as the server worked it out, asks for the record a history report is about, and exports the server’s CSV', async () => {
    serve({
      'GET /api/garage/reports': () => ok({ items: [{ key: 'open-jobs', title: 'Open jobs', money: false }, { key: 'vehicle-history', title: 'Vehicle history', money: true }], may_export: true }),
      'GET /api/garage/reports/open-jobs': (_b, q) => ok({ key: 'open-jobs', title: 'Open jobs', from: q.get('from'), to: q.get('to'), generated_at: null, columns: [{ key: 'number', label: 'Job', type: 'text' }, { key: 'age_days', label: 'Age (days)', type: 'int' }], rows: [{ number: 'JOB-2026-000012', age_days: 3 }], totals: { age_days: 3 }, notes: ['Counted in company time.'] }),
      'GET /api/garage/reports/vehicle-history': () => ok({ key: 'vehicle-history', title: 'Vehicle history', from: '', to: '', generated_at: null, columns: [{ key: 'number', label: 'Job', type: 'text' }], rows: [], totals: null, notes: [] }),
    });
    wrap(<Reports org="1" options={OPTIONS} online onJob={vi.fn()} />);
    const table = await screen.findByRole('region', { name: 'Open jobs' });
    expect(within(table).getByText('JOB-2026-000012')).toBeTruthy();
    expect(within(table).getByText('Total')).toBeTruthy();
    expect(within(table).getByText('Counted in company time.')).toBeTruthy();
    expect(sent.find((s) => s.path === '/api/garage/reports/open-jobs')?.search).toMatch(/org=1/);
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', expect.objectContaining({ garageFile: { kind: 'report', report: 'open-jobs', query: expect.objectContaining({ org: '1' }) } })));
    fireEvent.click(screen.getByRole('button', { name: 'Vehicle history' }));
    expect(await screen.findByText(/This report is about one vehicle: give its id\./)).toBeTruthy();
    expect(sent.some((s) => s.path === '/api/garage/reports/vehicle-history')).toBe(false);
    fireEvent.change(screen.getByLabelText('Vehicle id'), { target: { value: '7' } });
    await waitFor(() => expect(sent.find((s) => s.path === '/api/garage/reports/vehicle-history')?.search).toMatch(/vehicle_id=7/));
  });

  it('offers no export to whoever may only read the reports', async () => {
    serve({
      'GET /api/garage/reports': () => ok({ items: [{ key: 'open-jobs', title: 'Open jobs', money: false }], may_export: false }),
      'GET /api/garage/reports/open-jobs': () => ok({ key: 'open-jobs', title: 'Open jobs', from: '2026-08-30', to: '2026-09-29', generated_at: null, columns: [{ key: 'number', label: 'Job', type: 'text' }], rows: [], totals: null, notes: [] }),
    });
    wrap(<Reports org="" options={OPTIONS} online onJob={vi.fn()} />);
    expect(await screen.findByText('Nothing in this period.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /CSV/ })).toBeNull();
  });
});
