// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { currentVersion, declinedSafety, measured, undecided, type EstimateTab, type InspectionItem, type Line, type Version } from '../../../src/modules/garage/api-b1';
import { clock, minutesLabel, workedSeconds, type WorkOrder } from '../../../src/modules/garage/api-b2';
import { findingBody } from '../../../src/modules/garage/job/Diagnosis';
import Estimate, { approvalBody, lineBody } from '../../../src/modules/garage/job/Estimate';
import Inspection from '../../../src/modules/garage/job/Inspection';
import WorkOrders, { assignBody } from '../../../src/modules/garage/job/WorkOrders';
import { placeOf } from '../../../src/modules/garage/views/Calendar';
import { can, company, fail, job360, ok, OPTIONS } from './garage-fixtures';

/** Stages B1 and B2 on the job card, against their contracts (`web-api-b1.md`, `web-api-b2.md`). */
let sent: Array<{ method: string; path: string; body: unknown }> = [];
function serve(routes: Record<string, (body: unknown) => Response>) {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace(/^\/__api/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    sent.push({ method, path, body });
    const h = routes[`${method} ${path}`];
    return h ? h(body) : fail(404, `No route for ${method} ${path}`);
  });
}
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

beforeEach(() => vi.mocked(toast).mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const line = (over: Partial<Line> = {}): Line => ({
  id: 31, line_key: 'L1', sort: 1, line_type: 'part', type_label: 'Part', product_id: 1, warehouse_id: 1, description: 'Front brake pads', qty: '1', unit: 'set', unit_price: '12500.0000', discount_pct: '0', tax_rate_ids: [1],
  labour_hours: null, labor_rate_id: null, rate_type: null, coverage: 'none', payer: 'customer', source: 'inspection', source_id: 90, vhc: 'red', safety: true, decision: 'proposed', decision_label: 'Proposed', decided_at: null,
  follow_up_on: null, chargeable: false, net: '12500.00', tax: '2250.00', total: '14750.00', availability: null, ...over,
});
const version = (over: Partial<Version> = {}): Version => ({
  id: 2, estimate_id: 1, job_id: 12, version_no: 1, label: 'EST-2026-000001-v1', kind: 'initial', kind_label: 'Initial', status: 'sent', status_label: 'Sent', latest: true, editable: false, change_summary: null, currency: 'LKR',
  totals: { subtotal: '20500.00', discount: '0.00', tax: '3690.00', total: '24190.00', approved: null }, max_discount_pct: '0', by_payer: { customer: '24190.00' }, valid_until: '2026-10-06T18:29:59Z', expires_at: null,
  created_at: null, created_by: null, sent_at: '2026-09-29T06:00:00Z', sent_by: null, sent_channel: 'link', viewed_at: null, approved_at: null, superseded_at: null,
  lines: [line(), line({ id: 32, line_key: 'L2', line_type: 'labour', type_label: 'Labour', product_id: null, description: 'Fit pads', vhc: null, safety: false, total: '9440.00', labour_hours: '2' })],
  approvals: [], links: [], discount_approval: null, additional_work: [], ...over,
});
const tab = (over: Partial<EstimateTab> = {}): EstimateTab => ({
  estimate: { id: 1, number: 'EST-2026-000001', currency: 'LKR', current_version_id: 2 },
  versions: [version()],
  totals: { estimate: '24190.00', approved: null },
  recommendations: { diagnostics: [], inspection: [] },
  deferred: [],
  deferred_elsewhere: [],
  discount_limit_pct: '10.00',
  can: { create: true, edit: true, send: true, record_decision: true, override_discount: false },
  ...over,
});
const b1Job = () => job360({ status: 'awaiting_customer_approval', inspections: [], estimate: null, additional_work: [] });

// ── the rules as the screens use them ───────────────────────────────────

describe('stage B rules on this side', () => {
  it('colours a measurement by its thresholds as it is typed (the server sets the result the same way)', () => {
    const t: InspectionItem['thresholds'] = { amber_below: '4', red_below: '3', amber_above: null, red_above: null };
    expect(measured('5', t)).toBe('green');
    expect(measured('3.5', t)).toBe('amber');
    expect(measured('2.1', t)).toBe('red');
    expect(measured('', t)).toBeNull();
    expect(measured('5', { amber_below: null, red_below: null, amber_above: null, red_above: null })).toBeNull();
  });

  it('needs an answer on every line, and the customer’s acknowledgement to decline a safety line', () => {
    const v = version();
    expect(undecided(v, { 31: 'approved' })).toEqual([32]);
    expect(declinedSafety(v, { 31: 'deferred', 32: 'approved' }).map((l) => l.id)).toEqual([31]);
    expect(declinedSafety(v, { 31: 'approved', 32: 'rejected' })).toEqual([]);
    expect(currentVersion(tab({ versions: [version({ id: 1, latest: false }), version({ id: 2 })] }), null)?.id).toBe(2);
    expect(currentVersion(tab({ versions: [version({ id: 1, latest: false }), version({ id: 2 })] }), 1)?.id).toBe(1);
  });

  it('sends a line with only what its type takes — the server prices parts and labour', () => {
    const base = { description: 'Pads', product_id: null, qty: '2', unit_price: '100', labour_hours: '', labor_rate_id: '', discount_pct: '', tax_rate_ids: [1], coverage: '', payer: '', safety: false };
    expect(lineBody({ ...base, line_type: 'service' })).toEqual({ line_type: 'service', description: 'Pads', discount_pct: '0', tax_rate_ids: [1], coverage: 'none', payer: 'customer', safety: false, qty: '2', unit_price: '100' });
    expect(lineBody({ ...base, line_type: 'part', product_id: 7 })).not.toHaveProperty('unit_price');
    expect(lineBody({ ...base, line_type: 'labour', labour_hours: '1.5', labor_rate_id: '3' })).toMatchObject({ labour_hours: '1.5', labor_rate_id: 3 });
    expect(lineBody({ ...base, line_type: 'labour', labour_hours: '1.5' })).not.toHaveProperty('qty');
  });

  it('records a spoken answer with its method, approver, note, lines, follow-up dates and acknowledgement', () => {
    expect(approvalBody({ method: 'phone', approver: ' Dilani ', note: 'Called 10:05', picks: { 31: 'deferred', 32: 'approved' }, followUp: { 31: '2027-01-15' }, ack: true, signature: null })).toEqual({
      method: 'phone',
      approver_name: 'Dilani',
      note: 'Called 10:05',
      lines: [
        { id: 31, decision: 'deferred', follow_up_on: '2027-01-15' },
        { id: 32, decision: 'approved' },
      ],
      acknowledge_safety: true,
    });
  });

  it('records a finding — "no fault found" resolves it with those words', () => {
    const f = { complaint: 'Noise', finding: '', cause: '', repair: '', hours: '', priority: 'normal', resolved: false, noFault: true, parts: [{ product_id: 4, qty: '', name: 'Pads' }] };
    expect(findingBody(f, true)).toMatchObject({ complaint: 'Noise', finding: 'No fault found', status: 'resolved', no_fault_found: true, required_parts: [{ product_id: 4, qty: '1' }] });
    expect(findingBody({ ...f, noFault: false, finding: 'Worn pads', resolved: true }, false)).not.toHaveProperty('complaint');
  });

  it('gives a work order one lead, and books a slot only with a bay and a start', () => {
    expect(assignBody([{ id: 7, role: 'assistant' }, { id: 8, role: 'assistant' }], '', '', '').technicians).toEqual([
      { id: 7, role: 'lead' },
      { id: 8, role: 'assistant' },
    ]);
    expect(assignBody([{ id: 7, role: 'assistant' }, { id: 8, role: 'lead' }], '1', '', '90')).toEqual({ technicians: [{ id: 7, role: 'assistant' }, { id: 8, role: 'lead' }], service_bay_id: 1 });
    expect(assignBody([], '1', '2026-09-29T10:00', '90')).toMatchObject({ service_bay_id: 1, minutes: 90, starts_at: expect.stringMatching(/Z$/) });
  });

  it('counts a timer from the server’s fields, and says minutes in words', () => {
    const t = { state: 'running' as const, started_at: '2026-09-29T10:00:00Z', paused_at: null, paused_seconds: 60, pause_reason: null, stopped_at: null, worked_seconds: 0 };
    expect(workedSeconds(t, Date.parse('2026-09-29T10:43:17Z'))).toBe(42 * 60 + 17);
    expect(workedSeconds({ ...t, state: 'paused', paused_at: '2026-09-29T10:10:00Z' }, Date.parse('2026-09-29T12:00:00Z'))).toBe(9 * 60);
    expect(workedSeconds(null)).toBe(0);
    expect(clock(3909)).toBe('1:05:09');
    expect(clock(2537)).toBe('42:17');
    expect(minutesLabel(70)).toBe('1 h 10 min');
    expect(minutesLabel(null)).toBe('—');
  });

  it('places a booking on the day’s strip on the reader’s clock', () => {
    expect(placeOf({ starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T11:30:00Z' }, 'UTC')).toEqual({ left: (180 / 780) * 100, width: (90 / 780) * 100 });
    expect(placeOf({ starts_at: '2026-09-29T03:00:00Z', ends_at: '2026-09-29T05:00:00Z' }, 'UTC')).toBeNull();
  });
});

// ── the estimate ────────────────────────────────────────────────────────

describe('the estimate tab', () => {
  const opts = { line_types: { part: 'Part', labour: 'Labour', service: 'Service' }, payers: { customer: 'Customer' }, coverage: { none: 'None' }, sources: { inspection: 'Inspection' }, availability: {}, decisions: { approved: 'Approve', rejected: 'Reject', deferred: 'Later' }, line_states: {}, version_statuses: {}, version_kinds: {}, channels: { link: 'Secure link', whatsapp: 'WhatsApp' }, methods: {}, staff_methods: { phone: 'Phone', in_person: 'In person', email: 'Email' }, inspection_types: {}, inspection_results: {}, recommendations: {}, companies: [{ id: 1, currency: 'LKR', validity_days: 7, link_days: 7, my_discount_limit_pct: '10', may_override_discount: false, signature_required: false, auto_approve_limit: '0', tax_rates: [], labour_rates: [] }] };

  it('records the customer’s answer only once every line is decided, asking for the safety acknowledgement, with the server’s live total', async () => {
    serve({
      'GET /api/garage/jobs/12/estimate': () => ok({ estimate: tab() }),
      'GET /api/garage/estimates/options': () => ok(opts),
      'GET /api/garage/jobs/12/additional-work': () => ok({ items: [], job_status: 'awaiting_customer_approval' }),
      'POST /api/garage/versions/2/preview': () => ok({ approved: { subtotal: '8000.00', discount: '0.00', tax: '1440.00', total: '9440.00' }, lines: [], currency: 'LKR' }),
      'POST /api/garage/versions/2/approvals': () => ok({ estimate: tab({ versions: [version({ status: 'partially_approved', status_label: 'Partially approved' })] }), job_status: 'ready_to_start', job_version: 5, outcome: 'partially_approved' }, 'The customer’s answer is recorded.'),
    });
    const onChanged = vi.fn();
    wrap(<Estimate job={b1Job()} company={company(1, { can: can({ estimates: true }) })} options={OPTIONS} online onChanged={onChanged} onJob={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Record the customer’s answer/ }));
    const dialog = screen.getByRole('dialog');
    const record = within(dialog).getByRole('button', { name: 'Record' }) as HTMLButtonElement;

    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Front brake pads decision' })).getByRole('radio', { name: 'Later' }));
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Fit pads decision' })).getByRole('radio', { name: 'Approve' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note' }), { target: { value: 'Called at 10:05' } });
    expect(record.disabled).toBe(true); // the safety line is declined, and not yet acknowledged
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(record.disabled).toBe(false);
    await waitFor(() => expect(within(dialog).getByText(/Approved total LKR 9,440.00/)).toBeTruthy());

    await act(async () => {
      fireEvent.click(record);
    });
    expect(sent.find((s) => s.path === '/api/garage/versions/2/approvals')?.body).toEqual({
      method: 'phone',
      approver_name: 'Dilani Fernando',
      note: 'Called at 10:05',
      lines: [
        { id: 31, decision: 'deferred' },
        { id: 32, decision: 'approved' },
      ],
      acknowledge_safety: true,
    });
    expect(toast).toHaveBeenCalledWith('success', 'The customer’s answer is recorded.');
    expect(onChanged).toHaveBeenCalled();
  });

  it('sends a draft and shows the customer’s link and message once, to copy or open in WhatsApp', async () => {
    const draft = version({ status: 'draft', status_label: 'Draft', editable: true, sent_at: null });
    serve({
      'GET /api/garage/jobs/12/estimate': () => ok({ estimate: tab({ versions: [draft] }) }),
      'GET /api/garage/estimates/options': () => ok(opts),
      'GET /api/garage/jobs/12/additional-work': () => ok({ items: [], job_status: 'estimate_preparation' }),
      'POST /api/garage/versions/2/send': () =>
        ok({ estimate: tab(), job_status: 'awaiting_customer_approval', job_version: 5, status: 'sent', link: { id: 9, token: 't0k', url: 'https://ws.example/garage-approval/t0k', expires_at: '2026-10-06T18:29:59Z' }, text: 'Acme Motors: the estimate … here: https://ws.example/garage-approval/t0k' }, 'Sent.'),
    });
    wrap(<Estimate job={job360({ status: 'estimate_preparation', inspections: [], additional_work: [] })} company={company(1, { can: can({ estimates: true }) })} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Send to the customer/ }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send' }));
    });
    expect(sent.find((s) => s.path === '/api/garage/versions/2/send')?.body).toEqual({ channel: 'link' });
    const shown = await screen.findByRole('textbox', { name: 'Message for the customer' });
    expect((shown as HTMLTextAreaElement).value).toContain('https://ws.example/garage-approval/t0k');
    fireEvent.click(screen.getByRole('button', { name: /WhatsApp/ }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: expect.stringMatching(/^https:\/\/wa\.me\/94771234567\?text=/) });
  });

  it('offers no send, no answer and no edit to somebody who may only read it', async () => {
    serve({
      'GET /api/garage/jobs/12/estimate': () => ok({ estimate: tab({ can: { create: false, edit: false, send: false, record_decision: false, override_discount: false } }) }),
      'GET /api/garage/estimates/options': () => ok(opts),
      'GET /api/garage/jobs/12/additional-work': () => ok({ items: [], job_status: 'awaiting_customer_approval' }),
    });
    wrap(<Estimate job={b1Job()} company={company(1, { can: can({ estimates: true }) })} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    expect(await screen.findByText('Front brake pads')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Record the customer’s answer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /New link/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /New version/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit Front brake pads/ })).toBeNull();
  });
});

// ── the inspection ──────────────────────────────────────────────────────

describe('the inspection tab', () => {
  const item = (over: Partial<InspectionItem>): InspectionItem => ({ id: 90, section: 'Brakes', sort: 1, label: 'Front brake pads', result_type: 'traffic_light', unit: null, spec: null, thresholds: null, mandatory: true, result: null, result_label: null, measurement: null, note: null, recommendation: null, customer_visible: true, next_step: 'none', estimate_item_id: null, answered_by: null, answered_at: null, media: [], ...over });
  const inspection = { id: 7, job_id: 12, inspection_type: 'vhc', type_label: 'Vehicle health check', template: { id: 3, code: 'vhc-standard', name: 'Vehicle health check', version: 1 }, status: 'in_progress', status_label: 'In progress', performed_by: null, started_at: null, completed_at: null, summary: { good: 0, attention: 0, urgent: 0, unanswered: 2, total: 2 }, customer_summary: null, items: [item({}), item({ id: 91, label: 'Wipers', mandatory: true })] };

  it('saves an answer as it is given, and names the mandatory items still open when completing', async () => {
    serve({
      'GET /api/garage/jobs/12/inspections': () => ok({ items: [inspection] }),
      'PATCH /api/garage/inspections/7/items': () => ok({ inspection }),
      'POST /api/garage/inspections/7/complete': () => fail(422, '1 required item still to be answered: Wipers.', { missing: [91] }),
    });
    wrap(<Inspection job={job360({ status: 'inspection', inspections: [] })} company={company(1, { can: can({ inspect: true }) })} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    const group = await screen.findByRole('radiogroup', { name: 'Front brake pads result' });
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: 'Urgent' }));
    });
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ items: [{ id: 90, result: 'red' }] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Complete the inspection/ }));
    });
    expect(toast).toHaveBeenCalledWith('error', '1 required item still to be answered: Wipers.');
    expect(screen.getByRole('alert').textContent).toContain('Still to answer: Wipers.');
  });

  it('is read-only for somebody who may not perform inspections', async () => {
    serve({ 'GET /api/garage/jobs/12/inspections': () => ok({ items: [inspection] }) });
    wrap(<Inspection job={job360({ status: 'inspection', inspections: [] })} company={company(1, { can: can({ inspect: false }) })} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    const group = await screen.findByRole('radiogroup', { name: 'Front brake pads result' });
    expect((within(group).getByRole('radio', { name: 'Good' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Complete the inspection/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Start an inspection/ })).toBeNull();
  });
});

// ── work orders ─────────────────────────────────────────────────────────

describe('the work orders tab', () => {
  const wo = (over: Partial<WorkOrder> = {}): WorkOrder => ({
    id: 5, org_id: 1, job_id: 12, code: 'WO-01', work_type: 'Replace front brake pads', description: null, required_skill: 'general', required_skill_name: 'General mechanic', status: 'assigned', status_label: 'Assigned', pause_reason: null, pause_reason_label: null, internal: false,
    bay: null, bookings: [], estimated_minutes: 90, actual_minutes: 0, started_at: null, completed_at: null, sort: 1, version: 2,
    technicians: [{ id: 5, name: 'Kasun R.', role: 'lead', role_label: 'Lead', assigned_at: null, has_skill: true, minutes: 0, timer: null }], running: 0, lines: [], my_role: 'lead', my_timer: null,
    can: { start: true, pause: false, complete: false, assign: false, edit: false, cancel: false }, ...over,
  });
  const tabOf = (w: WorkOrder) => ({ items: [w], lines_waiting: 0, can: { create: false, assign: false, correct_labour: false } });
  const labour = { items: [], minutes: 0, billable_minutes: 0, rework_minutes: 0, running: 0, by_technician: [], can_correct: false };

  it('starts the caller’s own timer, and shows the server’s refusal when it runs elsewhere', async () => {
    serve({
      'GET /api/garage/jobs/12/work-orders': () => ok(tabOf(wo())),
      'GET /api/garage/jobs/12/labour': () => ok(labour),
      'POST /api/garage/work-orders/5/timer/start': () => fail(422, 'Your timer is running on another work order: pause it first.', { code: 'timer_running', running: { work_order_id: 9, code: 'WO-02' } }),
    });
    wrap(<WorkOrders job={job360({ status: 'ready_to_start', work_orders: { items: [] } })} company={company(1, { can: can({ work: true }) })} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Start/ }));
    });
    expect(sent.find((s) => s.method === 'POST')?.path).toBe('/api/garage/work-orders/5/timer/start');
    expect(toast).toHaveBeenCalledWith('error', 'Your timer is running on another work order: pause it first.');
  });

  it('asks why before pausing, and sends the reason', async () => {
    const running = wo({ status: 'in_progress', status_label: 'In progress', running: 1, my_timer: { state: 'running', started_at: new Date(Date.now() - 60_000).toISOString(), paused_at: null, paused_seconds: 0, pause_reason: null, stopped_at: null, worked_seconds: 60 }, can: { start: false, pause: true, complete: true, assign: false, edit: false, cancel: false } });
    serve({
      'GET /api/garage/jobs/12/work-orders': () => ok(tabOf(running)),
      'GET /api/garage/jobs/12/labour': () => ok(labour),
      'POST /api/garage/work-orders/5/timer/pause': () => ok({ work_order: running, warnings: [] }, 'Paused.'),
    });
    wrap(<WorkOrders job={job360({ status: 'in_progress', work_orders: { items: [] } })} company={company(1, { can: can({ work: true }) })} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    expect((await screen.findByLabelText('My timer')).textContent).toMatch(/^1:0\d$/);
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Waiting for parts' }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    });
    expect(sent.find((s) => s.method === 'POST')).toMatchObject({ path: '/api/garage/work-orders/5/timer/pause', body: { reason: 'waiting_parts' } });
  });

  it('hides what the reader may not do on a work order', async () => {
    serve({
      'GET /api/garage/jobs/12/work-orders': () => ok({ ...tabOf(wo({ my_role: null, can: { start: false, pause: false, complete: false, assign: false, edit: false, cancel: false } })), lines_waiting: 2 }),
      'GET /api/garage/jobs/12/labour': () => ok(labour),
    });
    wrap(<WorkOrders job={job360({ status: 'approved', work_orders: { items: [] } })} company={company(1, { can: can({ edit: false }) })} options={OPTIONS} online onChanged={() => undefined} onJob={() => undefined} />);
    expect(await screen.findByText('WO-01')).toBeTruthy();
    for (const name of [/Start/, /Complete/, /Technicians and bay/, /Make work orders/, /Internal work/, /^Cancel$/, /Found more work/]) expect(screen.queryByRole('button', { name })).toBeNull();
  });
});
