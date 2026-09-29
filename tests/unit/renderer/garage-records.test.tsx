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
import { mayIn, type CustomerView, type Options, type SetupStatus, type Vehicle360 as Vehicle360Data, type WorkshopData } from '../../../src/modules/garage/api';
import Customers from '../../../src/modules/garage/Customers';
import Reports from '../../../src/modules/garage/Reports';
import Setup from '../../../src/modules/garage/Setup';
import Vehicle360 from '../../../src/modules/garage/Vehicle360';
import Workshop from '../../../src/modules/garage/Workshop';
import { GarageContext, type Garage } from '../../../src/modules/garage/parts';

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const options = (can: Record<string, boolean> = {}): Options => ({
  org: 3, companies: [{ id: 3, name: 'Livezen Motors' }], currency: 'LKR', units: 'km', can: { job_view: true, vehicle_view: true, vehicle_manage: true, ...can },
  setup: { complete: true, done: 17, total: 17, next: null },
  branches: [{ id: 1, name: 'Colombo', code: 'CMB', active: true, garage: true }],
  technicians: [], models: [], priorities: ['NORMAL'], job_types: ['SERVICE'], vehicle_types: ['car'], fuels: ['petrol'], transmissions: ['auto'],
  complaints: [], cancel_reasons: [], require_vin: false, bay_manual: ['AVAILABLE', 'CLEANING', 'MAINTENANCE', 'BLOCKED'], bay_types: ['general', 'lift'],
});

const garage = (can: Record<string, boolean> = {}, over: Partial<Garage> = {}): Garage => {
  const o = options(can);
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

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockReset();
});
afterEach(cleanup);

const v360 = (over: Partial<Vehicle360Data> = {}): Vehicle360Data => ({
  vehicle: {
    id: 7, vehicle_number: 'CAB-1234', vin: 'NHP10-1234', vehicle_type: 'car', make: 'Toyota', model: 'Prius', year: 2019, colour: 'White', odometer: 90000, client_id: 8,
    customer_name: 'Kamal', customer_phone: null, variant: null, fuel_type: 'petrol', engine_number: null, transmission: 'auto', engine_cc: 1800, engine_hours: null,
    driver_name: null, driver_phone: null, registration_date: null, insurance: { insurer: 'Ceylinco', policy: 'P-77', until: null }, warranty: null, notes: null, odometer_at: null,
  },
  customer: { id: 8, name: 'Kamal Perera', phone: '0771234567', email: null },
  last_service: null, current_job: null, open_jobs: [],
  history: [
    {
      id: 30, number: 'JOB-2026-000030', status: 'COMPLETED', priority: 'NORMAL', job_type: 'SERVICE', checkin_at: '2026-06-01 04:00:00', completed_at: '2026-06-01 10:00:00', odometer: 80000,
      requested: 'Full service', total: 25000, target: null, repairs: ['Oil and filter change'], parts: ['Oil filter'], technicians: ['Nimal'], invoice: { number: 'INV-0042', status: 'paid' },
      warranty_until: '2026-09-01', warranty_km: 5000, odometer_out: 80010,
    },
  ],
  mileage: [{ reading: 90000, source: 'checkin', at: '2026-09-01 04:00:00', override: null, job_id: null }], km_per_day: 40, owners: [], photos: [], notes: [], activity: [],
  can: { manage: true, create_job: true, odometer_override: true },
  ...over,
});

describe('Garage: the Vehicle 360°', () => {
  it('shows the service history with the work, parts, invoice and warranty', async () => {
    vi.mocked(apiGet).mockResolvedValue(v360());
    wrap(<Vehicle360 id={7} onBack={() => undefined} />);
    expect(await screen.findByText('JOB-2026-000030')).toBeTruthy();
    expect(screen.getByText(/Oil and filter change/)).toBeTruthy();
    expect(screen.getByText(/invoice INV-0042/)).toBeTruthy();
    expect(screen.getByText('Ceylinco')).toBeTruthy();
  });

  it('asks why a reading is lower than the last one before it is kept (FR-VEH-03)', async () => {
    vi.mocked(apiGet).mockResolvedValue(v360());
    vi.mocked(request)
      .mockRejectedValueOnce(new ApiError(422, 'Say why the reading is lower than the last one (90,000).', null, { code: 'odometer_reason', last: 90000 }))
      .mockResolvedValueOnce(ok({}, 'Reading kept.'));
    wrap(<Vehicle360 id={7} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record odometer' }));
    fireEvent.change(screen.getByLabelText('Reading'), { target: { value: '12,000' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/vehicles/7/odometer']);
    expect(sent(0)[2]?.body).toEqual({ reading: 12000 });
    expect(await screen.findByText('Lower than the last reading')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Cluster replaced' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept the reading' }));
    });
    expect(sent(1)[2]?.body).toEqual({ reading: 12000, reason: 'Cluster replaced' });
  });

  it('starts a new job from the vehicle at the walk-in, with its plate', async () => {
    const g = garage();
    vi.mocked(apiGet).mockResolvedValue(v360());
    wrap(<Vehicle360 id={7} onBack={() => undefined} />, g);
    fireEvent.click(await screen.findByRole('button', { name: 'New job' }));
    expect(g.go).toHaveBeenCalledWith('walkin', { q: 'CAB-1234' });
  });

  it('only reads for someone who may not manage vehicles', async () => {
    vi.mocked(apiGet).mockResolvedValue(v360({ can: { manage: false, create_job: false, odometer_override: false } }));
    wrap(<Vehicle360 id={7} onBack={() => undefined} />);
    await screen.findByText('CAB-1234');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record odometer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New job' })).toBeNull();
  });
});

const customer = (over: Partial<CustomerView> = {}): CustomerView => ({
  id: 8, name: 'Kamal Perera', phone: '0771234567', email: null, prefs: { whatsapp: '0771234567', preferred_channel: 'whatsapp', notes: null },
  vehicles: [{ id: 7, vehicle_number: 'CAB-1234', make: 'Toyota', model: 'Prius', year: 2019, odometer: 90000 }], open_jobs: 1, completed_jobs: 3, outstanding: 17700, ...over,
});

describe('Garage: customers', () => {
  it('opens a customer with what they owe, how to reach them, and the history of every vehicle', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path === '/api/garage/v1/customers' ? { total: 1, page: 1, per_page: 25, customers: [{ id: 8, name: 'Kamal Perera', phone: '0771234567', email: null, vehicles: 1, open_jobs: 1 }] } : path === '/api/garage/v1/customers/8' ? customer() : v360(),
    );
    wrap(<Customers open={null} />, garage({ settings_manage: false }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kamal Perera' }));
    const panel = await screen.findByRole('complementary', { name: 'Kamal Perera' });
    expect(panel.textContent).toContain('LKR 17,700.00');
    expect(panel.textContent).toContain('Whatsapp');
    expect(await screen.findByText('JOB-2026-000030')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Credit terms' })).toBeNull();
  });

  it('saves how a customer likes to be reached', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/garage/v1/customers' ? { total: 0, page: 1, per_page: 25, customers: [] } : path === '/api/garage/v1/customers/8' ? customer() : v360()));
    vi.mocked(request).mockResolvedValue(ok({}, 'Saved.'));
    wrap(<Customers open={8} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('WhatsApp'), { target: { value: '0719999999' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/customers/8/prefs']);
    expect(sent(0)[2]?.body).toMatchObject({ whatsapp: '0719999999', preferred_channel: 'whatsapp', org: '3' });
  });
});

const setup = (over: Partial<SetupStatus> = {}): SetupStatus => ({
  steps: [
    { key: 'branches', title: 'Configure garage branches', what: 'Which branches run a workshop', kind: 'required', done: true, skipped: false, todo: '' },
    { key: 'workflow', title: 'Configure job workflow', what: 'Standard and express pipelines', kind: 'default', done: false, skipped: false, todo: 'Confirm the defaults.' },
    { key: 'packages', title: 'Create service packages', what: 'Fixed-price packages', kind: 'skip', done: false, skipped: false, todo: 'Optional — skip it for now if you like.' },
  ],
  ready: true, complete: false, completed_at: null, next: null, done: 1, total: 3, inventory: true, manage: true, ...over,
});

describe('Garage: set-up', () => {
  it('confirms a defaulted step, skips an optional one, and finishes', async () => {
    const g = garage({ settings_manage: true });
    vi.mocked(apiGet).mockResolvedValue(setup());
    vi.mocked(request).mockResolvedValue(ok(setup(), 'Saved.'));
    wrap(<Setup />, g);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Use the defaults' }));
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/setup/steps/workflow']);
    expect(sent(0)[2]?.body).toEqual({ how: 'done', org: '3' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    });
    expect(sent(1)[2]?.body).toEqual({ how: 'skipped', org: '3' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Finish set-up' }));
    });
    expect(sent(2).slice(0, 2)).toEqual(['POST', '/api/garage/v1/setup/finish']);
    await waitFor(() => expect(g.go).toHaveBeenCalledWith('overview'));
  });

  it('will not finish while a required step is open', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path.endsWith('/setup') ? setup({ ready: false, steps: [{ key: 'bays', title: 'Create service bays', what: 'Bays and their types', kind: 'required', done: false, skipped: false, todo: 'Add a service bay.' }] }) : new Promise(() => undefined),
    );
    wrap(<Setup />, garage({ settings_manage: true }));
    expect(await screen.findByText('Add a service bay.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Finish set-up' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

const workshop = (over: Partial<WorkshopData> = {}): WorkshopData => ({
  branches: [{ id: 1, name: 'Colombo', code: 'CMB', active: true, garage: true, warehouse_id: null, warehouse: null }],
  warehouses: [], workshops: [{ id: 4, branch_id: 1, name: 'Main workshop', code: 'MW', active: true }],
  bays: [{ id: 2, branch_id: 1, workshop_id: 4, code: 'B1', name: 'Lift 1', bay_type: 'lift', capabilities: [], status: 'OCCUPIED', status_note: null, status_at: null, active: true, current: { job_id: 40, number: 'JOB-2026-000040', vehicle: 'CAB-1234' } }],
  technicians: [], rates: [], service_types: [], models: [], skills: [], manage: false, assign: true, financials: false, inspection_templates: [], inspection_types: ['VHC'], ...over,
});

describe('Garage: the workshop', () => {
  it('shows each bay with its vehicle and job, and opens the job', async () => {
    const g = garage();
    vi.mocked(apiGet).mockResolvedValue(workshop());
    wrap(<Workshop />, g);
    fireEvent.click(await screen.findByRole('button', { name: 'CAB-1234 · JOB-2026-000040' }));
    expect(g.openJob).toHaveBeenCalledWith(40);
    expect(screen.queryByRole('button', { name: 'Add workshop' })).toBeNull();
  });

  it('takes a bay out of use only with a reason', async () => {
    vi.mocked(apiGet).mockResolvedValue(workshop());
    vi.mocked(request).mockResolvedValue(ok({}, 'Bay B1 is under maintenance.'));
    wrap(<Workshop />);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Set bay B1' }));
    fireEvent.click(screen.getByRole('option', { name: 'Maintenance' }));
    const set = screen.getByRole('button', { name: 'Set' }) as HTMLButtonElement;
    expect(set.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Lift hydraulics' } });
    await act(async () => {
      fireEvent.click(set);
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/bays/2/status']);
    expect(sent(0)[2]?.body).toEqual({ status: 'MAINTENANCE', note: 'Lift hydraulics', org: '3' });
  });
});

describe('Garage: the workshop, for a manager', () => {
  it('keeps a branch’s opening hours and invoice series', async () => {
    vi.mocked(apiGet).mockResolvedValue(workshop({ manage: true }));
    vi.mocked(request).mockResolvedValue(ok({}, 'Branch saved.'));
    wrap(<Workshop initial="branches" />, garage({ settings_manage: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hours & invoices' }));
    fireEvent.change(screen.getByLabelText('Invoice prefix'), { target: { value: 'cmb-g' } });
    fireEvent.change(screen.getByLabelText('Monday opens'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('Monday closes'), { target: { value: '17:30' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(sent(0).slice(0, 2)).toEqual(['POST', '/api/garage/v1/workshop/branches/1']);
    expect(sent(0)[2]?.body).toEqual({ invoice_prefix: 'CMB-G', hours: { mon: { open: '08:00', close: '17:30' } }, org: '3' });
  });

  it('keeps a model’s type when it is hidden', async () => {
    vi.mocked(apiGet).mockResolvedValue(workshop({ manage: true, models: [{ id: 5, vehicle_type: 'motorcycle', make: 'Honda', model: 'CB', active: true }] }));
    vi.mocked(request).mockResolvedValue(ok({}, 'Saved.'));
    wrap(<Workshop initial="models" />, garage({ settings_manage: true }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    });
    expect(sent(0)[2]?.body).toEqual({ active: false, vehicle_type: 'motorcycle', org: '3' });
  });
});

describe('Garage: reports', () => {
  it('runs a report and saves its CSV through the download manager', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path === '/api/garage/v1/reports'
        ? { reports: [{ key: 'aging', title: 'Job aging', about: 'Open jobs by days since check-in.' }], export: true }
        : { title: 'Job aging', about: 'Open jobs by days since check-in.', columns: [{ key: 'bucket', label: 'Days' }, { key: 'jobs', label: 'Jobs' }], rows: [{ bucket: '0–1', jobs: 4 }] },
    );
    vi.mocked(call).mockResolvedValue({} as never);
    wrap(<Reports />);
    expect(await screen.findByText('0–1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    });
    expect(call).toHaveBeenCalledWith('transfers:download', { garageDoc: { kind: 'report', report: 'aging', query: { org: '3', from: '2026-09-01' } }, name: 'garage-aging-2026-09-01.csv', open: false });
  });

  it('offers no export to someone who may only read', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path === '/api/garage/v1/reports' ? { reports: [{ key: 'aging', title: 'Job aging', about: '' }], export: false } : { title: 'Job aging', about: '', columns: [], rows: [] },
    );
    wrap(<Reports />);
    expect(await screen.findByText('Nothing in this period.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull();
  });
});
