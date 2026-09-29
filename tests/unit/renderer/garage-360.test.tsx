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
import { mayIn, type CheckinScreen, type DeliveryView, type EstimatesView, type JobView, type Options, type WorkView } from '../../../src/modules/garage/api';
import CheckIn from '../../../src/modules/garage/CheckIn';
import JobCard, { jobTabs } from '../../../src/modules/garage/JobCard';
import DeliveryTab from '../../../src/modules/garage/job/Delivery';
import EstimateTab from '../../../src/modules/garage/job/Estimate';
import WorkTab from '../../../src/modules/garage/job/Work';
import { GarageContext, type Garage } from '../../../src/modules/garage/parts';

const options = (over: Partial<Options> = {}): Options => ({
  org: 3, companies: [{ id: 3, name: 'Livezen Motors' }], currency: 'LKR', units: 'km',
  can: { job_view: true, job_create: true, work_order_view: true, estimate_view: true, inspection_view: true, checkin_create: true, vehicle_view: true },
  setup: { complete: true, done: 17, total: 17, next: null },
  branches: [{ id: 1, name: 'Colombo', code: 'CMB', active: true, garage: true }],
  technicians: [{ id: 21, employee_id: 4, user_id: 5, name: 'Nimal', skills: [], is_lead: true, active: true }],
  models: [], priorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], job_types: ['SERVICE', 'REPAIR'], vehicle_types: ['car'], fuels: [], transmissions: [],
  complaints: [], cancel_reasons: ['customer_declined'], require_vin: false,
  steps: ['Check-In', 'Inspection', 'Diagnosis', 'Estimate', 'Approval', 'Parts', 'Repair', 'Quality Check', 'Ready', 'Delivered'],
  ...over,
});

const garage = (over: Partial<Garage> = {}): Garage => {
  const o = options();
  return { org: '3', options: o, may: (p) => mayIn(o, p), go: vi.fn(), openJob: vi.fn(), openCheckin: vi.fn(), openVehicle: vi.fn(), online: true, ...over };
};

const wrap = (ui: ReactNode, g = garage()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GarageContext.Provider value={g}>{ui}</GarageContext.Provider>
    </QueryClientProvider>,
  );

const ok = <T,>(data: T, message = 'Done.') => ({ data, offline: false, cachedAt: null, message });
const sent = (i: number) => vi.mocked(request).mock.calls[i]!;

const jobView = (over: Partial<JobView['job']> = {}, rest: Partial<JobView> = {}): JobView => ({
  job: {
    id: 40, number: 'JOB-2026-000040', status: 'IN_PROGRESS', status_label: 'In progress', priority: 'NORMAL', job_type: 'SERVICE',
    vehicle: { id: 3, number: 'CAB-1234', make: 'Toyota', model: 'Prius', type: 'car' }, fleet: false, customer: { id: 8, name: 'Kamal Perera', phone: null },
    advisor: 'Hasarinda', advisor_initials: 'H', target: null, overdue: false, late_minutes: 0, checkin_at: '2026-09-29 04:00:00', created_at: null, completed_at: null,
    additional: false, total: null, workshop: null, branch: { id: 1, name: 'Colombo' }, requested_services: null, odometer_in: 85200, fuel_in: 50, cancel_reason: null,
    source: 'walk_in', pipeline: 'standard', step: 6, ...over,
  },
  customer: { id: 8, name: 'Kamal Perera', phone: '0771234567', email: null },
  vehicle: { id: 3, vehicle_number: 'CAB-1234', vin: null, vehicle_type: 'car', make: 'Toyota', model: 'Prius', year: 2019, colour: null, odometer: 85200, client_id: 8, customer_name: 'Kamal', customer_phone: null },
  checkin: { complaints: ['AC not cooling'], completed_at: '2026-09-29 04:20:00' },
  diagnostics: [], history: [{ from: null, to: 'CHECKED_IN', label: 'Checked in', waiting: null, reason: null, by: 'H', at: '2026-09-29 04:20:00' }],
  media: [], notes: [], activity: [], choices: [], steps: options().steps, cancel_reasons: ['customer_declined'],
  can: { edit: true, checkin: true, cancel: true, publish: false },
  ...rest,
});

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(toast).mockReset();
});
afterEach(cleanup);

describe('Garage: the Job 360°', () => {
  it('shows each tab once the job has reached it, and only to whoever may see it', () => {
    const may = (p: string) => p !== 'garage.estimate.view';
    expect(jobTabs(jobView({ status: 'DRAFT' }), () => true)).toEqual(['overview', 'checkin', 'media', 'activity']);
    const approved = jobView({}, { history: [{ from: null, to: 'APPROVED', label: 'Approved', waiting: null, reason: null, by: null, at: '' }] });
    expect(jobTabs(approved, () => true)).toEqual(['overview', 'checkin', 'inspection', 'diagnosis', 'estimate', 'work', 'media', 'activity']);
    expect(jobTabs(approved, may)).not.toContain('estimate');
    const inQc = jobView({ status: 'QUALITY_CHECK' }, { history: [{ from: null, to: 'QUALITY_CHECK', label: 'QC', waiting: null, reason: null, by: null, at: '' }] });
    expect(jobTabs(inQc, () => true)).toContain('delivery');
  });

  it('offers the check-in sheet through the download manager once the check-in is complete', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path.endsWith('/work') ? { job_status: 'IN_PROGRESS', work_orders: [], parts: [] } : jobView()));
    vi.mocked(call).mockResolvedValue({} as never);
    wrap(<JobCard id={40} onBack={() => undefined} />);
    await screen.findByText('JOB-2026-000040');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open the check-in sheet' }));
    });
    expect(call).toHaveBeenCalledWith('transfers:download', { garageDoc: { kind: 'checkin-sheet', job: 40 }, name: 'JOB-2026-000040 check-in sheet.html', open: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the check-in sheet' }));
    });
    expect(call).toHaveBeenLastCalledWith('transfers:download', { garageDoc: { kind: 'checkin-sheet', job: 40 }, name: 'JOB-2026-000040 check-in sheet.html', open: false });
  });

  it('keeps notes to staff for someone who may not publish, and opens the vehicle from the plate', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path.endsWith('/work') ? { job_status: 'IN_PROGRESS', work_orders: [], parts: [] } : jobView()));
    const g = garage();
    wrap(<JobCard id={40} onBack={() => undefined} />, g);
    await screen.findByText('JOB-2026-000040');
    expect(screen.queryByText('The customer may see it')).toBeNull();
    expect(screen.getByText('Staff only.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CAB-1234' }));
    expect(g.openVehicle).toHaveBeenCalledWith(3);
  });

  it('disables the moves while WorkSuite cannot be reached', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path.endsWith('/work') ? { job_status: 'CHECKED_IN', work_orders: [], parts: [] } : jobView({ status: 'CHECKED_IN' }, { choices: [{ to: 'INSPECTION', label: 'Start inspection' }] })));
    wrap(<JobCard id={40} onBack={() => undefined} />, garage({ online: false }));
    const move = await screen.findByRole('button', { name: 'Start inspection' });
    expect((move as HTMLButtonElement).disabled).toBe(true);
  });
});

const checkin = (over: Partial<CheckinScreen> = {}): CheckinScreen => ({
  config: {
    areas: ['front_bumper', 'hood'], slots: ['front', 'rear', 'damage'], required_slots: ['front'], min_photos: 1, signature: true, complaints: ['AC not cooling'],
    conditions: ['GOOD', 'SCRATCH', 'DENT'], fuel: [0, 25, 50, 75, 100], views: ['front', 'rear'], marks: ['SCRATCH', 'DENT'], accessories: ['Spare wheel', 'Jack'], units: 'km',
  },
  checkin: {
    id: 1, odometer: 85200, fuel_level: 50, accessories: [], valuables: '', estimated_handover_at: null, requested_services: null, complaints: ['AC not cooling'],
    conditions: {}, marks: [], photos: [], signer_name: null, signer_relation: null, signature: null, completed_at: null, completed_by: null,
  },
  last_odometer: 90000,
  missing: [],
  editable: true,
  can: { odometer_override: true },
  ...over,
});

describe('Garage: check-in', () => {
  it('saves what was captured, with a change marked on the diagram', async () => {
    vi.mocked(apiGet).mockResolvedValue(checkin());
    vi.mocked(request).mockResolvedValue(ok(checkin(), 'Saved.'));
    wrap(<CheckIn jobId={40} onBack={() => undefined} />);
    await screen.findByText('Vehicle check-in');
    expect(screen.getByText('Lower than the last reading — check it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '¾' }));
    fireEvent.click(screen.getByRole('button', { name: 'Spare wheel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Front A2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark the rest good' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    const [method, path, opts] = sent(0);
    expect([method, path]).toEqual(['POST', '/api/garage/v1/jobs/40/checkin']);
    expect(opts?.body).toMatchObject({
      fuel_level: 75,
      accessories: ['Spare wheel'],
      marks: [{ view: 'front', zone: 'A2', kind: 'SCRATCH', note: null, media_id: null }],
      conditions: { front_bumper: { value: 'GOOD', note: null }, hood: { value: 'GOOD', note: null } },
    });
  });

  it('says what is still missing and will not complete until it is there', async () => {
    vi.mocked(apiGet).mockResolvedValue(checkin({ missing: [{ key: 'photo_front', text: 'A photo of the front.' }] }));
    wrap(<CheckIn jobId={40} onBack={() => undefined} />);
    expect(await screen.findByLabelText('Still needed')).toBeTruthy();
    expect(screen.getByText(/A photo of the front\./)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Complete check-in' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks why a reading is lower than the last one, then completes with the reason and a fresh key', async () => {
    const onBack = vi.fn();
    vi.mocked(apiGet).mockResolvedValue(checkin());
    vi.mocked(request)
      .mockRejectedValueOnce(new ApiError(422, 'Say why the reading is lower than the last one (90,000).', null, { code: 'odometer_reason', last: 90000 }))
      .mockResolvedValueOnce(ok({}, 'Checked in.'));
    wrap(<CheckIn jobId={40} onBack={onBack} />);
    await screen.findByText('Vehicle check-in');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Complete check-in' }));
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/jobs/40/checkin/complete']);
    expect(await screen.findByText('The odometer is lower than last time')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Instrument cluster replaced' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept the reading' }));
    });
    expect(sent(1)[2]?.body).toEqual({ email: true, odometer_reason: 'Instrument cluster replaced' });
    expect(sent(1)[2]?.headers?.['Idempotency-Key']).not.toBe(sent(0)[2]?.headers?.['Idempotency-Key']);
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  it('sends a photo into its slot as a multipart upload', async () => {
    vi.mocked(apiGet).mockResolvedValue(checkin());
    vi.mocked(request).mockResolvedValue(ok({ id: 77, signature_cleared: false }, 'Photo kept.'));
    wrap(<CheckIn jobId={40} onBack={() => undefined} />);
    await screen.findByText('Vehicle check-in');
    const file = new File(['jpeg-bytes'], 'front.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.drop(screen.getByLabelText('Photo: Front'), { dataTransfer: { files: [file], types: ['Files'] } });
    });
    await waitFor(() => expect(request).toHaveBeenCalled());
    const [method, path, opts] = sent(0);
    expect([method, path]).toEqual(['POST', '/api/garage/v1/jobs/40/media']);
    const form = opts?.body as FormData;
    expect(form.get('subject')).toBe('checkin');
    expect(form.get('slot')).toBe('front');
    expect((form.get('file') as File).name).toBe('front.jpg');
  });

  it('is read-only once complete, with the sheet to view or save', async () => {
    vi.mocked(apiGet).mockResolvedValue(checkin({ editable: false, checkin: { ...checkin().checkin, completed_at: '2026-09-29 04:20:00' } }));
    wrap(<CheckIn jobId={40} onBack={() => undefined} />);
    await screen.findByText('Vehicle check-in');
    expect(screen.queryByRole('button', { name: 'Complete check-in' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the check-in sheet' })).toBeTruthy();
  });
});

const estimates = (over: Partial<EstimatesView> = {}): EstimatesView => ({
  versions: [
    {
      id: 5, version: 1, kind: 'MAIN', status: 'DRAFT', currency: 'LKR', subtotal: 15000, discount: 0, tax: 2700, total: 17700, approved_total: 0, deferred_total: 0,
      valid_until: null, change_summary: null, sent_at: null, viewed_at: null, decided_at: null, created_at: null, created_by: 'H',
      lines: [
        { id: 11, line_type: 'LABOUR', description: 'AC diagnosis', product_id: null, rate_class: 'general', labour_minutes: 60, qty: 1, unit_price: 4500, discount_pct: 0, tax_rate: 18, net: 4500, tax: 810, total: 5310, coverage: 'customer', priority: 'AMBER', decision: 'PROPOSED', availability: null, source_type: null },
        { id: 12, line_type: 'PART', description: 'AC gas', product_id: 100, rate_class: null, labour_minutes: null, qty: 1, unit_price: 10500, discount_pct: 0, tax_rate: 18, net: 10500, tax: 1890, total: 12390, coverage: 'customer', priority: null, decision: 'PROPOSED', availability: 'IN_STOCK', source_type: null },
      ],
    },
  ],
  approvals: [], recommendations: [], job_status: 'ESTIMATE_PREPARATION', currency: 'LKR', rates: [], line_types: ['LABOUR', 'PART', 'SERVICE'], coverage: ['customer', 'warranty'], discount_limit: 10,
  can: { create: true, edit: true, send: true, record: true, discount_override: false },
  ...over,
});

describe('Garage: the estimate', () => {
  it('sends a draft and shows the customer’s link once', async () => {
    vi.mocked(apiGet).mockResolvedValue(estimates());
    vi.mocked(request).mockResolvedValue(ok({ link: 'https://ws.test/garage/estimate/abc123' }, 'Estimate sent.'));
    wrap(<EstimateTab jobId={40} number="JOB-2026-000040" customerName="Kamal Perera" onChange={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Send' }).at(-1)!);
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/estimates/5/send']);
    expect(sent(0)[2]?.body).toEqual({ message: '', email: true });
    expect(sent(0)[2]?.headers?.['Idempotency-Key']).toMatch(/^est-send-/);
    expect(((await screen.findByLabelText('Estimate link')) as HTMLInputElement).value).toBe('https://ws.test/garage/estimate/abc123');
  });

  it('records a decision only with every line answered, who gave it and a note', async () => {
    const e = estimates();
    vi.mocked(apiGet).mockResolvedValue(estimates({ versions: [{ ...e.versions[0]!, status: 'SENT' }] }));
    vi.mocked(request).mockResolvedValue(ok({}, 'Recorded.'));
    wrap(<EstimateTab jobId={40} number="JOB-2026-000040" customerName="Kamal Perera" onChange={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record decision' }));
    const save = () => screen.getAllByRole('button', { name: 'Record decision' }).at(-1) as HTMLButtonElement;
    fireEvent.click(screen.getAllByRole('radio', { name: 'Approved' })[0]!);
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('radio', { name: 'Later' })[1]!);
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Called at 10:15, spoke to the owner.' } });
    expect(save().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save());
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/estimates/5/decision']);
    expect(sent(0)[2]?.body).toMatchObject({ method: 'phone', decisions: { 11: 'APPROVED', 12: 'DEFERRED' }, name: 'Kamal Perera', note: 'Called at 10:15, spoke to the owner.' });
  });

  it('prints a version through the download manager', async () => {
    vi.mocked(apiGet).mockResolvedValue(estimates());
    vi.mocked(call).mockResolvedValue({} as never);
    wrap(<EstimateTab jobId={40} number="JOB-2026-000040" customerName="Kamal" onChange={() => undefined} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open the estimate' }));
    });
    expect(call).toHaveBeenCalledWith('transfers:download', { garageDoc: { kind: 'estimate', estimate: 5 }, name: 'JOB-2026-000040 estimate v1.html', open: true });
  });
});

const work = (over: Partial<WorkView> = {}): WorkView => ({
  job_status: 'READY_TO_START',
  work_orders: [
    {
      id: 9, job_id: 40, code: 'WO-1', work_type: 'AC repair', description: null, status: 'ASSIGNED', is_additional: false, estimated_minutes: 90, logged_minutes: 0,
      started_at: null, completed_at: null, bay: null, technicians: [{ id: 21, name: 'Nimal', role: 'LEAD', user_id: 5, running: false }], lines: [],
    },
  ],
  parts: [], labour: [], additional: [], removed: [], me: null, bays: [], technicians: [], skills: [], pause_reasons: ['break', 'parts'], conditions: [], dispositions: ['SCRAP'],
  can: { assign: true, execute: true, request: true, issue: false, return: false, correct: false, price: false, override: false, financials: false },
  ...over,
});

describe('Garage: the work', () => {
  it('starts a technician’s timer for someone who assigns the work', async () => {
    vi.mocked(apiGet).mockResolvedValue(work());
    vi.mocked(request).mockResolvedValue(ok({}, 'Timer started.'));
    wrap(<WorkTab jobId={40} onChange={() => undefined} onEstimate={() => undefined} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Start Nimal' }));
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/work-orders/9/start']);
    expect(sent(0)[2]?.body).toEqual({ technician_id: 21 });
    expect(sent(0)[2]?.headers?.['Idempotency-Key']).toMatch(/^wo-start-/);
  });

  it('keeps a start with its moment when WorkSuite cannot be reached', async () => {
    vi.mocked(apiGet).mockResolvedValue(work());
    vi.mocked(request).mockRejectedValue(new ApiError(0, 'unreachable', 'INTERNAL'));
    vi.mocked(call).mockResolvedValue({ delivered: false, queued: true, id: 'q1', status: null, data: null, error: null, code: null } as never);
    wrap(<WorkTab jobId={40} onChange={() => undefined} onEstimate={() => undefined} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Start Nimal' }));
    });
    expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ module: 'garage', entity: 'work_order', entityId: '9', path: '/api/garage/v1/work-orders/9/start' }));
    expect(toast).toHaveBeenCalledWith('info', expect.stringMatching(/^Offline/));
  });

  it('cancels work not started only with a reason', async () => {
    vi.mocked(apiGet).mockResolvedValue(work());
    vi.mocked(request).mockResolvedValue(ok({}, 'Work order cancelled.'));
    wrap(<WorkTab jobId={40} onChange={() => undefined} onEstimate={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const confirm = screen.getByRole('button', { name: 'Cancel work order' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Customer declined on the phone' } });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/work-orders/9/cancel']);
    expect(sent(0)[2]?.body).toEqual({ reason: 'Customer declined on the phone' });
  });

  it('changes what the work is before it starts', async () => {
    vi.mocked(apiGet).mockResolvedValue(work());
    vi.mocked(request).mockResolvedValue(ok({}, 'Work order saved.'));
    wrap(<WorkTab jobId={40} onChange={() => undefined} onEstimate={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '120' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/work-orders/9']);
    expect(sent(0)[2]?.body).toEqual({ work_type: 'AC repair', description: '', required_skill: '', estimated_minutes: 120 });
  });

  it('hides what this person may not do', async () => {
    vi.mocked(apiGet).mockResolvedValue(work({ can: { assign: false, execute: false, request: false, issue: false, return: false, correct: false, price: false, override: false, financials: false } }));
    wrap(<WorkTab jobId={40} onChange={() => undefined} onEstimate={() => undefined} />);
    await screen.findByText('WO-1 · AC repair');
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask for a part' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the work order sheet' })).toBeTruthy();
  });
});

const delivery = (over: Partial<DeliveryView> = {}): DeliveryView => ({
  job_status: 'QUALITY_CHECK',
  checks: [
    {
      id: 3, attempt: 1, status: 'IN_PROGRESS', inspector_id: 5, inspector: 'Sunil', started_at: null, completed_at: null, fail_reason: null, note: null,
      items: [
        { id: 1, label: 'No warning lights', mandatory: true, result: 'PASS', note: null },
        { id: 2, label: 'AC outlet temperature', mandatory: true, result: 'FAIL', note: 'Still 18 °C' },
      ],
    },
  ],
  rework: [], road_tests: [], road_test_needed: false, review: [],
  work_orders: [{ id: 9, code: 'WO-1', work_type: 'AC repair', status: 'COMPLETED', technicians: [{ id: 21, name: 'Nimal', role: 'LEAD', user_id: 6, running: false }] }],
  handover: null, odometer_in: 85200, odometer_now: 85210, accessories: ['Spare wheel'], customer: 'Kamal Perera', client_id: 8, me: 5, self_qc: true,
  can: { perform: true, approve: true, road_test: true, complete: true, invoice: false, pay: false, override: false, credit: false, money: false },
  ...over,
});

describe('Garage: quality and delivery', () => {
  it('fails a check only naming what failed and the work that goes back', async () => {
    vi.mocked(apiGet).mockResolvedValue(delivery());
    vi.mocked(request).mockResolvedValue(ok({}, 'Sent back for rework.'));
    wrap(<DeliveryTab jobId={40} number="JOB-2026-000040" onChange={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fail' }));
    const go = screen.getByRole('button', { name: 'Fail and send back' }) as HTMLButtonElement;
    expect((screen.getByLabelText('What is wrong') as HTMLTextAreaElement).value).toBe('Still 18 °C');
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /WO-1/ }));
    await act(async () => {
      fireEvent.click(go);
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/quality-checks/3/fail']);
    expect(sent(0)[2]?.body).toEqual({ reason: 'Still 18 °C', work_order_ids: [9] });
  });

  it('tells someone who worked on the job that another person checks it', async () => {
    vi.mocked(apiGet).mockResolvedValue(delivery({ checks: [{ ...delivery().checks[0]!, status: 'PENDING', inspector_id: null }], self_qc: false }));
    wrap(<DeliveryTab jobId={40} number="JOB-2026-000040" onChange={() => undefined} />);
    expect(await screen.findByText('You worked on this job; someone else checks it.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hands over unpaid only with a manager’s reason and the signature', async () => {
    const ctx = { beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined, stroke: () => undefined, clearRect: () => undefined };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,c2ln');
    vi.mocked(apiGet).mockResolvedValue(
      delivery({ job_status: 'INVOICE_PENDING', checks: [], release: { basis: null, outstanding: 17700, credit_limit: null, owed_elsewhere: 0, message: 'LKR 17,700.00 is still owed.' }, can: { ...delivery().can, override: true } }),
    );
    vi.mocked(request).mockResolvedValue(ok({}, 'Handed over.'));
    wrap(<DeliveryTab jobId={40} number="JOB-2026-000040" onChange={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hand over' }));
    const go = () => screen.getAllByRole('button', { name: 'Hand over' }).at(-1) as HTMLButtonElement;
    expect(go().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why it leaves unpaid'), { target: { value: 'Fleet manager will pay on Friday' } });
    expect(go().disabled).toBe(true);
    const pad = screen.getByRole('img', { name: /Signature/ });
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(pad, { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(pad);
    expect(go().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(go());
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/jobs/40/handover']);
    expect(sent(0)[2]?.body).toMatchObject({ received_by: 'Kamal Perera', odometer: 85210, items: ['Spare wheel'], signature: 'data:image/png;base64,c2ln', override_reason: 'Fleet manager will pay on Friday' });
    expect(sent(0)[2]?.headers?.['Idempotency-Key']).toMatch(/^handover-/);
  });

  it('keeps the delivery note once the vehicle has gone', async () => {
    vi.mocked(apiGet).mockResolvedValue(
      delivery({
        job_status: 'COMPLETED',
        handover: { delivered_at: '2026-09-29 10:00:00', odometer_out: 85210, fuel_out: 50, delivered_by: 'H', received_by: 'Kamal', received_relation: null, items: [], removed_returned: true, release_basis: 'PAID', override_reason: null, notes: null },
      }),
    );
    vi.mocked(call).mockResolvedValue({} as never);
    wrap(<DeliveryTab jobId={40} number="JOB-2026-000040" onChange={() => undefined} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Save the delivery note' }));
    });
    expect(call).toHaveBeenCalledWith('transfers:download', { garageDoc: { kind: 'delivery-note', job: 40 }, name: 'JOB-2026-000040 delivery note.html', open: false });
  });
});
