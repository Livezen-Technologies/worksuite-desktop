import { afterEach, describe, expect, it, vi } from 'vitest';
import { canOpenApp, canOpenLink, canOpenRoute, categoryVisible, notificationAllowed, visibleAppIds } from '@shared/access';
import { APP_CATALOGUE, isAppVisible } from '@shared/apps';
import { parseDeepLink } from '@shared/deeplink';
import { contract } from '@shared/ipc/contract';
import { resolveWebLink } from '@shared/links';
import { validateManifest } from '@shared/manifest';
import { ApiError } from '../../../src/core/api';
import { parseRoute } from '../../../src/modules/registry';
import * as g from '../../../src/modules/garage/api';
import { neighbour, requestMove } from '../../../src/modules/garage/Board';
import { landing } from '../../../src/modules/garage/GarageShell';
import { movesOf } from '../../../src/modules/garage/JobCard';
import { checkinBody, draftFrom, odometerLower } from '../../../src/modules/garage/job/Checkin';
import { markAt, zoneLabel, zonesOf } from '../../../src/modules/garage/job/DamageMap';
import { LISTS, readRoute } from '../../../src/modules/garage/parts';
import { EXTRA_VIEWS, JOB_TABS, tabFor, tabsFor } from '../../../src/modules/garage/registry';
import { valueIn, valueOut } from '../../../src/modules/garage/Setup';
import { deferredKey } from '../../../src/modules/garage/Vehicle360';
import { vehicleBody, vehicleDraft } from '../../../src/modules/garage/Vehicles';
import { adoptAdded, walkInBody, walkInGaps, type WalkInDraft } from '../../../src/modules/garage/WalkIn';
import { can, checkin, company, fail, job, job360, ok, OPTIONS } from './garage-fixtures';

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (channel: string, cb: (payload: unknown) => void) => {
    handlers.set(channel, cb);
    return () => undefined;
  },
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  hasDesktop: () => false,
  registerDropped: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

// ── the app in the catalogue, links and notifications ──────────────────

describe('Garage in the catalogue', () => {
  const garage = APP_CATALOGUE.find((a) => a.id === 'garage')!;

  it('is a native app behind the garage app and garage.access — not the browser', () => {
    expect(garage).toMatchObject({ surface: 'native', app: 'garage', perm: 'garage.access', webPath: '/garage' });
    expect(isAppVisible(garage, { apps: ['garage'], permissions: ['garage.access'] })).toBe(true);
    expect(isAppVisible(garage, { apps: ['garage'], permissions: [] })).toBe(false);
    expect(isAppVisible(garage, { apps: ['crm'], permissions: ['garage.access'] })).toBe(false);
    // A desktop-API server that did not return the app has the last word.
    expect(isAppVisible(garage, { apps: '*', permissions: ['*'], serverApps: ['crm'] })).toBe(false);
  });

  it('is only there for people the server lets open it — a route, a link and a notification alike', () => {
    const without = visibleAppIds({ apps: ['mail', 'chat'], permissions: [] });
    const withIt = visibleAppIds({ apps: ['mail', 'garage'], permissions: ['garage.access'] });
    expect(canOpenApp('garage', without)).toBe(false);
    expect(canOpenRoute('/garage/jobs/12', without)).toBe(false);
    expect(canOpenRoute('/garage/jobs/12', withIt)).toBe(true);
    expect(canOpenLink('/garage?job=12', without)).toBe(false);
    expect(canOpenLink('/garage?job=12', withIt)).toBe(true);
    expect(categoryVisible('garage', without)).toBe(false);
    expect(notificationAllowed({ category: 'garage', link: '/garage?job=12' }, without)).toBe(false);
    expect(notificationAllowed({ category: 'garage', link: '/garage?job=12' }, withIt)).toBe(true);
  });

  it('opens the server’s notification links in a tab here, never in the browser', () => {
    expect(resolveWebLink('/garage?job=12')).toEqual({ kind: 'tab', route: '/garage?job=12', app: 'garage' });
    expect(resolveWebLink('/garage')).toEqual({ kind: 'tab', route: '/garage', app: 'garage' });
  });
});

describe('live updates', () => {
  it('reads the board and the lists again when a garage notice arrives, and not for other apps’', async () => {
    const { queryClient, wireQueryInvalidation } = await import('../../../src/core/query');
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    wireQueryInvalidation();
    const emit = handlers.get('realtime:event')!;
    emit({ type: 'notification', category: 'garage', link: '/garage?job=12' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['garage'] });
    spy.mockClear();
    emit({ type: 'notification', category: 'crm', link: '/crm/leads/4' });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['garage'] });
    spy.mockRestore();
  });
});

describe('the module manifest', () => {
  it('declares READ_CACHE for the lists and the board, the quick actions and the deep links', async () => {
    const { moduleFor } = await import('../../../src/modules/registry');
    const m = moduleFor('garage')!;
    expect(m).toBeTruthy();
    expect(m.manifest.offline.mode).toBe('READ_CACHE');
    expect(m.manifest.offline.cache).toEqual(expect.arrayContaining(['/api/garage/board', '/api/garage/jobs', '/api/garage/dashboard', '/api/garage/options']));
    expect(m.manifest.quickActions.map((q) => q.route)).toEqual(['/garage?view=walkin', '/garage?view=board']);
    expect(m.manifest.deepLinks).toEqual(['garage/jobs/:id', 'garage/vehicles/:id']);
    expect(validateManifest(m.manifest).ok).toBe(true);
  });
});

// ── routes and deep links ───────────────────────────────────────────────

describe('deep links and routes', () => {
  const at = (route: string) => {
    const { path, query } = parseRoute(route);
    return readRoute(path, query);
  };

  it('opens worksuite://garage/jobs/<id> on that job card, and …/vehicles/<id> on its 360°', () => {
    const j = parseDeepLink('worksuite://garage/jobs/12');
    expect(j.ok && j.link).toMatchObject({ module: 'garage', route: '/garage/jobs/12' });
    expect(at(j.ok ? j.link.route : '')).toMatchObject({ job: 12, vehicle: null });
    const v = parseDeepLink('worksuite://garage/vehicles/7?org=1');
    expect(v.ok && v.link).toMatchObject({ route: '/garage/vehicles/7', organizationId: '1' });
    expect(at(v.ok ? v.link.route : '')).toMatchObject({ vehicle: 7, job: null });
    expect(parseDeepLink('worksuite://garage/jobs/..').ok).toBe(false);
    expect(parseDeepLink('worksuite://garage/jobs/12?x=1').ok).toBe(false);
  });

  it('reads the notification link /garage?job=ID, the tab, a new walk-in and the lists', () => {
    expect(at('/garage?job=12&jt=checkin')).toMatchObject({ job: 12, jobTab: 'checkin' });
    expect(at('/garage?new=1').view).toBe('walkin');
    expect(at('/garage?view=board').view).toBe('board');
    expect(at('/garage?view=jobs&list=overdue')).toMatchObject({ view: 'jobs', list: 'overdue' });
    expect(at('/garage?view=nowhere').view).toBeNull();
    expect(at('/garage?job=abc').job).toBeNull();
    expect(at('/garage?view=parts').view).toBeNull();
    expect(readRoute([], new URLSearchParams('view=parts'), new Set(['parts'])).view).toBe('parts');
  });

  it('carries a dashboard tile’s filter to the jobs list, and only the keys the list knows', () => {
    expect(g.jobsRoute({ status: 'awaiting_customer_approval,additional_approval_required' })).toBe('/garage?view=jobs&status=awaiting_customer_approval%2Cadditional_approval_required');
    expect(g.jobsRoute({ overdue: '1', evil: 'x' }, 'overdue')).toBe('/garage?view=jobs&list=overdue&overdue=1');
    expect(g.jobFilterOf(new URLSearchParams('view=jobs&started=2026-09-29&q=%20&junk=1'))).toEqual({ started: '2026-09-29' });
    expect(LISTS.find((l) => l.id === 'parts')?.filter).toEqual({ column: 'waiting_parts' });
  });
});

// ── what the person may do ──────────────────────────────────────────────

describe('permissions per company', () => {
  const opts: g.Options = { ...OPTIONS, companies: [company(1, { can: can({ settings: true }), setup_complete: false }), company(2, { can: can({ create: false, dashboard: false }) })] };

  it('asks the company the record is in, or any company in view', () => {
    expect(g.canIn(opts, 1, 'create')).toBe(true);
    expect(g.canIn(opts, 2, 'create')).toBe(false);
    expect(g.canIn(opts, 3, 'view')).toBe(false);
    expect(g.canAny(opts, 'create')).toBe(true);
    expect(g.canAny(opts, 'create', '2')).toBe(false);
    expect(g.companiesWhere(opts, 'settings').map((c) => c.id)).toEqual([1]);
  });

  it('sends whoever may set the garage up to the wizard until it is set up (FR-APP-04), others to what they may use', () => {
    expect(g.needsSetup(opts).map((c) => c.id)).toEqual([1]);
    expect(landing(opts, '')).toBe('setup');
    expect(landing(opts, '2')).toBe('board');
    expect(landing({ ...opts, companies: [company(3, { can: can({ dashboard: false, view: false }) })] }, '')).toBe('vehicles');
  });

  it('offers the moves the server allows, says what stands in the way, and never shows one the reader may not ask for', () => {
    const t = (to: string, allowed: boolean, why: string | null = null, needs: string[] = []): g.Transition => ({ to, label: to, on: to, allowed, why, needs });
    const { offered, blocked } = movesOf([t('approved', true), t('estimate_preparation', false, 'Say why.'), t('in_progress', false, 'You do not have permission to do that.'), t('cancelled', true, null, ['reason'])]);
    expect(offered.map((x) => x.to)).toEqual(['approved']);
    expect(blocked.map((x) => x.to)).toEqual(['estimate_preparation']);
  });

  it('lists the job card’s tabs from the registry: a stage’s tabs only where the server has it, money only for those who may see it', () => {
    const b = { inspections: [], estimate: null, additional_work: [], work_orders: { items: [] } };
    const b3 = { parts: { requests: [] }, qc: { current: null }, road_tests: { tests: [] }, delivery: { handover: null } };
    const tabs = tabsFor(job360(b), company(1, { can: can({ estimates: false }) }));
    expect(tabs.map((t) => t.id)).not.toContain('estimate');
    expect(tabsFor(job360(b), company(1, { can: can({ estimates: true }) })).map((t) => t.id)).toEqual(expect.arrayContaining(['inspection', 'diagnosis', 'estimate', 'work-orders']));
    // Every P1 area, in the order FR-JOB-07 lists them, on a server with all three stages.
    expect(tabsFor(job360({ ...b, ...b3 }), company(1, { can: can({ estimates: true }) })).map((t) => t.id)).toEqual(['overview', 'checkin', 'inspection', 'diagnosis', 'estimate', 'work-orders', 'parts', 'qc', 'road-test', 'invoice', 'media', 'notes', 'activity']);
    // A stage-A server has none of stage B's keys: its tabs are not offered.
    expect(tabsFor(job360(), company(1, { can: can({ estimates: true }) })).map((t) => t.id)).toEqual(['overview', 'checkin', 'media', 'notes', 'activity']);
    // Without the permission to see them, the server sends inspections, work orders and the quality check as null.
    const hidden = tabsFor(job360({ ...b, ...b3, inspections: null, work_orders: null, qc: null }), company(1)).map((t) => t.id);
    expect(hidden).not.toContain('inspection');
    expect(hidden).not.toContain('work-orders');
    expect(hidden).not.toContain('qc');
    expect(hidden).toEqual(expect.arrayContaining(['diagnosis', 'parts', 'road-test', 'invoice']));
    // Every tab P1 lists is built: none is left dimmed.
    expect(JOB_TABS.every((t) => !!t.component)).toBe(true);
    expect(tabFor('parts', tabs)?.id).toBe('overview');
    expect(tabFor('parts', tabsFor(job360({ ...b, ...b3 }), company(1)))?.id).toBe('parts');
    expect(tabFor('checkin', tabs)?.id).toBe('checkin');
  });

  it('adds the parts counter and the reports to the rail for those who may use them', () => {
    const ids = EXTRA_VIEWS.map((v) => `${v.id}:${v.group}:${v.can}`);
    expect(ids).toEqual(expect.arrayContaining(['parts-counter:workshop:parts_issue', 'reports:reports:reports']));
    expect(readRoute(['garage'], new URLSearchParams('view=parts-counter'), new Set(EXTRA_VIEWS.map((v) => v.id))).view).toBe('parts-counter');
  });
});

// ── the board: a drop asks the server (C9) ──────────────────────────────

describe('moving a card on the board', () => {
  const approval = { code: 'approval', label: 'Approval', statuses: ['awaiting_customer_approval', 'additional_approval_required'] };
  const parts = { code: 'waiting_parts', label: 'Waiting parts', statuses: ['approved', 'waiting_parts'] };
  const estimate = { code: 'estimate', label: 'Estimate', statuses: ['estimate_preparation'] };

  it('sends the column with the version the board showed, and hands back the server’s refusal word for word', async () => {
    const calls: Array<{ url: string; method: string; ifMatch: string | null; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', ifMatch: new Headers(init.headers).get('If-Match'), body: init.body ? JSON.parse(String(init.body)) : null });
      if (init.method === 'GET') return ok({ job: job360({ transitions: [{ to: 'approved', label: 'Approved', on: 'customer_approved', allowed: false, why: 'Estimate not approved: record the customer’s decision on the estimate.', needs: [] }] }) });
      return fail(422, 'Estimate not approved: record the customer’s decision on the estimate.', { from: 'awaiting_customer_approval', to: 'approved' });
    });

    const out = await requestMove(job(), parts, true);

    expect(out).toEqual({ kind: 'refused', message: 'Estimate not approved: record the customer’s decision on the estimate.', conflict: false });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET app://bundle/__api/api/garage/jobs/12', 'POST app://bundle/__api/api/garage/jobs/12/transition']);
    expect(calls[1]).toMatchObject({ ifMatch: '3', body: { column: 'waiting_parts' } });
  });

  it('asks for a reason first when the move needs one, and sends nothing until it has it', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') posts.push(JSON.parse(String(init.body)));
      return init.method === 'GET' ? ok({ job: job360({ transitions: [{ to: 'estimate_preparation', label: 'Ask for changes', on: 'changes_requested', allowed: true, why: null, needs: ['reason'] }] }) }) : ok({ job: job360() }, 'Moved to Estimate preparation.');
    });

    expect(await requestMove(job(), estimate, true)).toEqual({ kind: 'ask', label: 'Ask for changes' });
    expect(posts).toEqual([]);
    expect(await requestMove(job(), estimate, true, 'Customer wants the pads only')).toEqual({ kind: 'moved', message: 'Moved to Estimate preparation.' });
    expect(posts).toEqual([{ column: 'estimate', reason: 'Customer wants the pads only' }]);
  });

  it('says so when somebody else moved the job first', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => (init.method === 'GET' ? ok({ job: job360() }) : fail(409, 'Somebody changed this job after you read it.', { code: 'version_conflict', server_version: 4 })));
    expect(await requestMove(job(), parts, true)).toEqual({ kind: 'refused', message: 'Somebody changed this job after you read it.', conflict: true });
  });

  it('does nothing for the column the card is in, and nothing at all offline', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await requestMove(job(), approval, true)).toEqual({ kind: 'same' });
    expect(await requestMove(job(), parts, false)).toEqual({ kind: 'offline' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('finds the next and previous column for the keyboard', () => {
    const cols = [approval, parts].map((c) => ({ ...c, count: 0, jobs: [] }));
    expect(neighbour(cols, 'approval', 1)?.code).toBe('waiting_parts');
    expect(neighbour(cols, 'approval', -1)).toBeNull();
    expect(neighbour(cols, 'nope', 1)).toBeNull();
  });
});

// ── walk-in ─────────────────────────────────────────────────────────────

describe('a walk-in', () => {
  const base: WalkInDraft = { org: 1, branch: '', customer: null, vehicle: null, priority: 'normal', jobType: 'service', requestedWork: '', promised: '', confirmOpenJob: false };

  it('says what is still needed before it can be sent', () => {
    expect(walkInGaps({ ...base, org: null })).toEqual(['the company', 'the vehicle', 'the customer']);
    expect(walkInGaps({ ...base, vehicle: { kind: 'existing', id: 7, vehicle_number: 'WP CAB-1234', label: '', customer_id: 1, open_job: null } })).toEqual([]);
    expect(walkInGaps({ ...base, customer: { kind: 'new', name: ' ', phone: '', email: '' }, vehicle: { kind: 'new', vehicle_number: '', make: '', model: '', year: '', vin: '', vehicle_type: 'car', odometer: '' } })).toEqual(['the vehicle number', 'the customer’s name']);
  });

  it('opens a job for a known vehicle and its owner, at normal priority', () => {
    expect(walkInBody({ ...base, vehicle: { kind: 'existing', id: 7, vehicle_number: 'WP CAB-1234', label: '', customer_id: 1, open_job: null }, requestedWork: ' Brakes grinding ' })).toEqual({ org_id: 1, priority: 'normal', job_type: 'service', customer_id: 1, vehicle_id: 7, requested_work: 'Brakes grinding' });
  });

  it('adds a missing customer and vehicle with the job, and confirms a second open job only when asked', () => {
    const body = walkInBody({
      ...base,
      branch: '2',
      customer: { kind: 'new', name: 'Kamal Silva', phone: '0771234567', email: '' },
      vehicle: { kind: 'new', vehicle_number: 'CAR-1234', make: 'Honda', model: 'Vezel', year: '2019', vin: '', vehicle_type: 'car', odometer: '52,000' },
      confirmOpenJob: true,
    });
    expect(body).toEqual({
      org_id: 1,
      priority: 'normal',
      job_type: 'service',
      branch_id: 2,
      customer: { name: 'Kamal Silva', phone: '0771234567', email: null },
      vehicle: { vehicle_number: 'CAR-1234', make: 'Honda', model: 'Vezel', year: 2019, vin: null, vehicle_type: 'car', odometer: 52000 },
      confirm_open_job: true,
    });
  });

  it('takes what a refused walk-in had already added, so the next try does not add it twice', () => {
    const d = adoptAdded({ ...base, customer: { kind: 'new', name: 'Kamal Silva', phone: '', email: '' } }, { customer: { id: 44, name: 'Kamal Silva', phone: null, email: null } });
    expect(d.customer).toEqual({ kind: 'existing', id: 44, name: 'Kamal Silva', phone: null });
    expect(adoptAdded(base, null)).toBe(base);
  });

  it('reads the open-job refusal, the duplicate and what was added from the server’s answer', () => {
    const r = g.refusalOf(new ApiError(409, 'This vehicle already has a job open.', null, { code: 'open_job', open_job: { id: 12, job_number: 'JOB-2026-000012', status: 'checked_in' }, added: { customer: { id: 44, name: 'Kamal' } } }));
    expect(r).toMatchObject({ status: 409, code: 'open_job', openJob: { id: 12, job_number: 'JOB-2026-000012' }, added: { customer: { id: 44 } }, missing: [] });
    expect(g.refusalOf(new Error('boom'))).toMatchObject({ status: 0, message: 'boom', code: null, openJob: null });
  });
});

// ── check-in ────────────────────────────────────────────────────────────

describe('the check-in', () => {
  const j = job360({ status: 'draft', checkin: checkin({ odometer: 84300, fuel_level: 50, complaints: [{ id: 1, text: 'Warning light', quick_pick: 'warning_light' }], conditions: [{ area: 'doors', value: 'scratch', note: 'rear left' }], accessories: ['Jack'], signer: { name: 'Dilani', relation: 'owner', signed: true } }) });

  it('starts from what the server has', () => {
    const d = draftFrom(j);
    expect(d).toMatchObject({ odometer: '84300', fuel: 50, complaints: [{ text: 'Warning light', quick_pick: 'warning_light' }], conditions: { doors: { value: 'scratch', note: 'rear left' } }, accessories: ['Jack'], signer: 'Dilani', relation: 'owner', signature: null });
  });

  it('sends lists whole, complaints as picks or words, and asks to complete only when told', () => {
    const d = { ...draftFrom(j), complaints: [{ text: 'Warning light', quick_pick: 'warning_light' }, { text: 'Grinding when braking', quick_pick: null }], conditions: { doors: { value: 'scratch', note: '' }, front_bumper: { value: '', note: '' } } };
    const body = checkinBody(d, true, 84250);
    expect(body).toMatchObject({ odometer: 84300, fuel_level: 50, complaints: [{ quick_pick: 'warning_light', text: 'Warning light' }, 'Grinding when braking'], conditions: [{ area: 'doors', value: 'scratch', note: null }], accessories: ['Jack'], complete: true });
    expect(body).not.toHaveProperty('odometer_override_reason');
    expect(body).not.toHaveProperty('signature');
    expect(checkinBody(d, false, 84250).complete).toBe(false);
  });

  it('sends a lower reading with its reason, and the signature with the signer', () => {
    const d = { ...draftFrom(j), odometer: '80000', overrideReason: 'Cluster replaced', signature: 'data:image/png;base64,AAAA' };
    expect(odometerLower(d, 84250)).toBe(true);
    expect(odometerLower({ odometer: '' }, 84250)).toBe(false);
    const body = checkinBody(d, true, 84250);
    expect(body).toMatchObject({ odometer: 80000, odometer_override_reason: 'Cluster replaced', signature: { signer_name: 'Dilani', relation: 'owner', image: 'data:image/png;base64,AAAA' } });
  });

  it('marks damage in the web page’s zones, at the middle of the zone', () => {
    expect(zonesOf('top').map((z) => z.zone)).toEqual(['fb', 'hd', 'lf', 'rf', 'lr', 'rr', 'rb', 'bt']);
    expect(zonesOf('front')).toHaveLength(9);
    expect(zoneLabel('front', 'mc')).toBe('Middle centre');
    expect(markAt('top', zonesOf('top')[0]!, 'scratch', null, 55)).toEqual({ view: 'top', zone: 'fb', mark: 'scratch', x: 0.1667, y: 0.125, note: null, media_id: 55 });
  });
});

// ── vehicles and set-up ─────────────────────────────────────────────────

describe('vehicles and set-up forms', () => {
  const v = { id: 7, org_id: 1, branch_id: null, vehicle_number: 'WP CAB-1234', vin: null, engine_number: null, vehicle_type: 'car', make: 'Toyota', model: 'Prius', variant: null, make_model: 'Toyota Prius', year: 2016, colour: null, fuel_type: 'hybrid', transmission: null, engine_capacity_cc: null, engine_hours: null, odometer: 84250, odometer_unit: 'km', odometer_updated_at: null, customer_id: 1, registration_date: null, insurance: null, warranty: null, notes: null, created_at: null, updated_at: null, customer: { id: 1, name: 'Dilani', phone: null, email: null }, readings: [], owners: [], open_job: null } as g.Vehicle;

  it('sends an edit as only what changed — a new customer is a new owner', () => {
    const was = vehicleDraft(v, '');
    expect(vehicleBody({ ...was, colour: 'Silver', customer: { id: 9, name: 'ABC Trading' } }, was)).toEqual({ colour: 'Silver', customer_id: 9 });
    expect(vehicleBody(was, was)).toEqual({});
  });

  it('sends a new vehicle whole, with its company and first reading', () => {
    const d = { ...vehicleDraft(null, '1'), customer: { id: 1, name: 'Dilani' }, vehicle_number: 'CAR-1', odometer: '1200' };
    expect(vehicleBody(d, null)).toMatchObject({ org_id: 1, customer_id: 1, vehicle_number: 'CAR-1', vehicle_type: 'car', odometer: 1200, make: null });
  });

  it('keeps deferred work from an estimate and from an inspection apart on Vehicle 360°', () => {
    const row = { job_id: 12, line_type: 'service', description: 'Wiper blades', vhc: 'amber', decided_at: null };
    const keys = [deferredKey({ ...row, source: 'estimate', item_id: 5 }), deferredKey({ ...row, source: 'inspection', item_id: null, inspection_item_id: 5 }), deferredKey({ ...row, item_id: 6 })];
    expect(keys).toEqual(['estimate-5', 'inspection-5', 'estimate-6']);
  });

  it('reads and writes set-up fields in the server’s types', () => {
    expect(valueIn({ key: 'active', label: '', type: 'bool' }, undefined)).toBe('1');
    expect(valueIn({ key: 'is_default', label: '', type: 'bool' }, undefined)).toBe('0');
    expect(valueOut({ key: 'skills', label: '', type: 'multi' }, 'general,ac')).toEqual(['general', 'ac']);
    expect(valueOut({ key: 'branch_id', label: '', type: 'select' }, '')).toBeNull();
    expect(valueOut({ key: 'workshop_id', label: '', type: 'select' }, '4')).toBe(4);
    expect(valueOut({ key: 'default_minutes', label: '', type: 'number' }, '90')).toBe(90);
    expect(valueOut({ key: 'amount', label: '', type: 'money' }, ' 4500.00 ')).toBe('4500.00');
  });
});

describe('saying things', () => {
  it('colours a status by what it means, and keeps money as text', () => {
    expect(g.statusTone('completed')).toBe('green');
    expect(g.statusTone('awaiting_customer_approval')).toBe('amber');
    expect(g.statusTone('quality_check')).toBe('violet');
    expect(g.statusTone('in_progress')).toBe('blue');
    expect(g.priorityTone('normal')).toBeNull();
    expect(g.priorityTone('urgent')).toBe('red');
    expect(g.amount('81000.5', 'LKR')).toBe('LKR 81,000.50');
    expect(g.amount(null)).toBe('—');
    expect(g.distance(84250, 'km')).toBe('84,250 km');
    expect(g.distance(null)).toBe('—');
    expect(g.fuelMark(48, OPTIONS.checkin.fuel_marks)).toBe('1/2');
    expect(g.fuelMark(null, OPTIONS.checkin.fuel_marks)).toBeNull();
    expect(g.vehicleLine(job().vehicle)).toBe('Toyota Prius · WP CAB-1234');
  });
});

describe('garage files are downloaded by what they are, never by a path', () => {
  const input = contract['transfers:download'].input;
  it('takes a report as CSV with its short filters, or a job’s delivery note — one at a time', () => {
    expect(input.safeParse({ garageFile: { kind: 'report', report: 'open-jobs', query: { org: '1', from: '2026-09-01', to: '2026-09-29' } }, name: 'garage-open-jobs.csv' }).success).toBe(true);
    expect(input.safeParse({ garageFile: { kind: 'delivery-note', job: 12 }, name: 'delivery-note.pdf' }).success).toBe(true);
    expect(input.safeParse({ garageFile: { kind: 'report', report: '../jobs', query: {} }, name: 'x.csv' }).success).toBe(false);
    expect(input.safeParse({ garageFile: { kind: 'report', report: 'open-jobs', query: { 'a&b': '1' } }, name: 'x.csv' }).success).toBe(false);
    expect(input.safeParse({ garageFile: { kind: 'delivery-note', job: 0 }, name: 'x.pdf' }).success).toBe(false);
    expect(input.safeParse({ garageFile: { kind: 'delivery-note', job: 12 }, tenderDocument: 4, name: 'x.pdf' }).success).toBe(false);
  });
});
