// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('sip.js', () => ({ Invitation: class {}, Inviter: class {}, Registerer: class {}, RegistererState: {}, SessionState: {}, UserAgent: { makeURI: () => undefined } }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn(), ringVolume: () => 0.5 }));
const tab = { route: '/phone' };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: vi.fn(), navigate: vi.fn(), openInNewTab: vi.fn(), active: true, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import PhonePage from '../../../src/modules/phone/PhonePage';

/**
 * Every Phone screen draws, as an administrator, against today's server (proposed endpoints answer 404) and against
 * one that offers them — no crash, no render loop, and the screen's heading on it.
 */
const today = '2026-10-06 09:00:00';
const ext = (id: number, extension: string, name: string, user: string | null) => ({ id, extension, name, user_id: user ? id : null, user_name: user, caller_id: '+94112447000', email: null, device_type: 'both', presence: 'online', dnd: false, forward_to: null, record_calls: 'inbound', voicemail: true, enabled: true, branch: null, has_secret: true, created_at: today, department: 'Sales', server: 'Colombo PBX', server_id: 1 });
const server = { id: 1, name: 'Colombo PBX', description: null, driver: 'asterisk', hostname: 'pbx.example.lk', public_ip: null, private_ip: '10.88.0.1', sip_domain: 'pbx.example.lk', api_base: null, auth_kind: 'none', client_id: null, api_user: null, ami_host: '10.88.0.1', ami_port: 5038, ami_user: 'worksuite', ari_host: null, ari_port: 8088, ari_user: null, ari_app: 'worksuite', ws_url: 'wss://pbx.example.lk:8089/ws', stun_url: null, turn_url: null, turn_user: null, timezone: 'Asia/Colombo', region: null, asterisk_version: '20.9', freepbx_version: null, status: 'online', status_message: null, last_seen_at: today, enabled: true, maintenance: false, is_default: true, sync_interval: 60, driver_verified: true, owns_configuration: true, has_client_secret: false, has_api_key: false, has_api_password: false, has_jwt: false, has_ami_secret: true, has_ari_secret: false, has_turn_secret: false, health: { reachable: true, cpu_pct: 23, memory_pct: null, disk_pct: null, active_calls: 7, registered: 41, endpoints_total: 48, trunks_up: 3, trunks_total: 3, queued_callers: 4, latency_ms: 18, uptime_seconds: null, note: null, sampled_at: today }, extensions: 2 };
const call = { id: 1, direction: 'inbound', from: '0773124408', to: '1042', extension: '1042', agent: 'Hasini', queue: 'Sales', disposition: 'answered', ring: 8, talk: 372, cost: 0, recording_id: 3, started_at: today, ended_at: today, notes: null };
const pop = { number: '0773124408', matched: true, confidence: 'contact', contact: { id: 9, name: 'Nimal Perera', company: 'Lanka Agro Exports', job_title: 'Procurement Manager', email: null, phone: null, customer_id: 4, colour: null }, account: { id: 4, name: 'Lanka Agro Exports', contact: null, email: null, phone: null, status: 'Customer', industry: null, health: null }, lead: null, deals: [{ id: 1, name: 'Q4 fertiliser supply', amount: 8_400_000, currency: 'LKR', stage: 'Negotiation', close_date: null, open: true }], quotes: [], invoices: [{ id: 2, number: 'INV-0412', status: 'sent', total: 640_000, outstanding: 640_000, currency: 'LKR', due_date: '2026-09-20', overdue: true }], tasks: [], meetings: [], calls: [] };
const range = { from: '2026-09-07', to: '2026-10-06' };

function answer(offered: boolean) {
  return async (path: string): Promise<unknown> => {
    const proposed: Record<string, unknown> = {
      '/api/voip/me': { extensions: [], devices: [], caller_ids: [{ value: '1042', label: 'Ext 1042 · Sales line' }], caller_id: null, dnd: false, sync_presence: false, presence: 'online', hotdesk: null, shared_phones: [] },
      '/api/voip/speed-dials': { speed_dials: [{ id: 1, label: 'Reception', number: '1000', slot: 1, contact_id: null }] },
      '/api/voip/registrations': { registrations: [] },
      '/api/voip/supervisor/board': { queues: [{ id: 1, name: 'Sales', number: '600', strategy: 'rrmemory', agents: 6, waiting: 1, longest_wait: 21, free: 2, logged_in: 6, sla_rate: 88, sla_seconds: 30 }], agents: [{ extension_id: 1, extension: '1042', name: 'Hasini', state: 'on_call', since_seconds: 252, detail: 'Sales', queue: 'Sales' }], calls: [{ channel: 'PJSIP/1042-1', started_seconds: 252, agent: 'Hasini', extension: '1042', other: '0773124408', queue: 'Sales 600', direction: 'inbound' }], totals: { calls_now: 9, external: 6, internal: 3, waiting: 4, longest_wait: 112, agents_free: 5, agents_total: 14, agents_paused: 2, answered_today: 312, answer_rate: 94, abandoned_today: 19, avg_abandon_wait: 48 } },
      '/api/voip/trunks': { trunks: [{ id: 1, name: 'SLT-PSTN', provider: 'HT813 FXO', kind: 'sip', host: '192.168.10.21', port: 5060, username: '9001', has_secret: true, from_domain: null, from_user: null, registers: true, codecs: 'alaw', caller_id: null, transport: 'udp', max_channels: 1, priority: 1, cost_per_min: 1.8, gateway_id: null, status: 'registered', status_at: null, enabled: true }] },
      '/api/voip/routes': { routes: [{ id: 1, name: 'Emergency', pattern: '119', trunk_id: 1, failover_trunk_id: null, strip_digits: 0, prepend: null, priority: 1, kind: 'emergency', enabled: true }] },
      '/api/voip/gateways': { gateways: [{ id: 1, name: 'DINSTAR-GSM', vendor: 'Dinstar', model: 'UC2000-VE-4G', ip: '192.168.10.22', port: 5060, channels: 4, firmware: null, imei: null, status: 'online', last_seen_at: today, enabled: true, notes: null }] },
      '/api/voip/sim-cards': { sims: [{ id: 1, gateway_id: 1, channel: 1, msisdn: '0771002020', iccid: null, imsi: null, operator: 'Dialog', has_pin: true, has_puk: true, balance: 4820, currency: 'LKR', expires_on: '2026-11-30', signal_dbm: -71, status: 'ready', department_id: null, monthly_limit: null, enabled: true, last_seen_at: today }] },
      '/api/voip/inbound-routes': { routes: [{ id: 1, did: '0112447000', server_id: 1, trunk: 'SLT-PSTN', open_dest: { kind: 'ivr', value: '800' }, closed_dest: { kind: 'voicemail', value: '1000' }, holiday_dest: null, hours: '08:30-18:00,mon-fri,*,*', calendar_id: null, open_now: true, enabled: true }] },
      '/api/voip/ivr-flows': { flows: [{ id: 1, name: 'Main menu', number: '800', greeting: 'Thank you for calling.', greeting_file_id: null, nodes: { '1': { kind: 'queue', value: '600' }, '4': { kind: 'ring_group', value: '640', missing: true } }, timeout: 5, repeat: 2, direct_dial: true, invalid_to: null, timeout_to: null, hours: '08:30-18:00,mon-fri,*,*', enabled: true }] },
      '/api/voip/queues': { queues: [{ id: 1, name: 'Sales', number: '600', strategy: 'rrmemory', timeout: 20, max_wait: 300, max_callers: 0, announce_position: true, music_class: 'default', overflow_to: null, sla_seconds: 30, department_id: null, enabled: true, agents: [{ id: 1, queue_id: 1, extension_id: 1, extension: '1042', name: 'Hasini', penalty: 0, skill: 'Sinhala', paused: false, calls_today: 38, talk_today: 7260, state: 'on_call' }] }] },
      '/api/voip/ring-groups': { ring_groups: [{ id: 1, name: 'Accounts desk', number: '650', strategy: 'ringall', members: '1031-1042', timeout: 25, fallback_to: '1000', enabled: true }] },
      '/api/voip/wrapup-codes': { codes: [{ code: 'resolved', label: 'Resolved' }] },
      '/api/voip/mappings': { mappings: [] },
    };
    if (path in proposed) {
      if (!offered) throw new ApiError(404, 'The server answered 404.', null);
      return proposed[path];
    }
    if (/^\/api\/voip\/calls\/\d+\/events$/.test(path)) {
      if (!offered) throw new ApiError(404, 'The server answered 404.', null);
      return { events: [{ at: today, event: 'start', text: 'Call arrived on DID +94 11 244 7000' }] };
    }
    switch (path) {
      case '/api/voip/status':
        return { pbx: { ok: true }, counts: { extensions: 2, trunks: 1, gateways: 1, queues: 1 }, secrets: true, websocket: { path: '/ws', domain: 'pbx.example.lk' }, message: null };
      case '/api/voip/softphone':
        throw new ApiError(404, 'You do not have an extension yet.', null);
      case '/api/voip/extensions':
        return { extensions: [ext(1, '1042', 'Hasini', 'Hasini Jayawardena'), ext(2, '1090', 'Kandy front desk', null)] };
      case '/api/voip/calls':
        return { calls: [call], page: 1, per_page: 30, total: 1 };
      case '/api/voip/calls/1':
        return { call: { id: 1, uniqueid: '1.1', linkedid: '1.1', direction: 'inbound', from_number: '0773124408', to_number: '1042', extension_id: 1, user_id: 1, trunk_id: 1, queue_id: 1, contact_id: 9, disposition: 'answered', ring_seconds: 8, talk_seconds: 372, cost: null, recording_id: 3, hangup_cause: null, quality_mos: '4.3', started_at: today, answered_at: today, ended_at: today, notes: null }, context: pop, notes: [{ id: 1, body: 'Wants a revised quote.', author: 'Hasini', at_second: 91, created_at: today }] };
      case '/api/voip/calls/1/intelligence':
        return { status: { available: false, provider: 'none', reason: 'No engine or provider is configured.', missing: ['An on-server speech engine'] }, jobs: [] };
      case '/api/voip/intelligence/status':
        return { available: false, provider: 'none', reason: 'No engine or provider is configured.', missing: [] };
      case '/api/voip/screen-pop':
        return { context: pop };
      case '/api/voip/recordings':
        return { recordings: [{ id: 3, kind: 'voicemail', call_id: null, file_id: 4, extension: '1042', agent: 'Hasini', direction: 'inbound', from: '0112573390', to: null, category: 'Sales', duration: 42, bytes: 330_000, listened: false, retain_until: '2027-10-02', created_at: today }], page: 1, per_page: 50, total: 1, retention_note: 'Recordings are deleted once their retention date passes.' };
      case '/api/voip/forwards':
        return { forwards: [{ id: 1, extension_id: 1, department_id: null, condition: 'time', destination_kind: 'mobile', destination: '+94774551290', ring_seconds: 20, time_spec: '18:00-23:59,mon-fri,*,*', priority: 20, enabled: true, summary: 'At certain times, forward to the mobile +94774551290.' }] };
      case '/api/voip/short-codes':
        return { short_codes: [{ id: 1, code: '640', label: 'Warehouse', target_kind: 'ring_group', target_id: null, target_value: '640', department: null, branch: null, server: 'Colombo PBX', server_id: 1, generated: false, enabled: true, resolves: false, problem: 'The ring group is gone.' }] };
      case '/api/voip/config':
        return { files: { 'pjsip_worksuite.conf': '[1042]\ntype=endpoint', 'extensions_worksuite.conf': '[from-internal]\nexten => 1042,1,NoOp(Hasini)', 'queues_worksuite.conf': '[sales]' } };
      case '/api/voip/settings':
        return { settings: { ami_host: 'localhost', ami_port: '5038', ami_user: 'worksuite', ami_secret: '********', ws_path: '/ws', sip_domain: 'pbx.example.lk', recording_retention_days: '365', record_all_calls: '0', sync_enabled: '1', auto_provision: '1', codec_policy: 'opus,ulaw,alaw' } };
      case '/api/voip/servers':
        return { servers: [server], notes: { freepbx: 'Not run against a real FreePBX.', secrets: null } };
      case '/api/voip/servers/1':
        return { server, mappings: [{ id: 1, scope: 'organisation', scope_id: null, label: 'CreativeFX', range_from: 1000, range_to: 1999, prefix: null, priority: 10 }], health: [] };
      case '/api/voip/sync-runs':
        return { runs: [{ id: 1, server: 'Colombo PBX', server_id: 1, kind: 'full', trigger: 'scheduled', state: 'partial', examined: 48, created: 1, updated: 1, skipped: 0, failed: 1, by: null, started_at: today, ended_at: today, has_detail: true }] };
      case '/api/voip/live':
        return { servers: [{ server_id: 1, server: 'Colombo PBX', ok: true, message: null, channels: [] }] };
      case '/api/voip/reports/summary':
        return { range, totals: { calls: 6842, inbound: 3910, outbound: 2512, internal: 420, answered: 6254, unanswered: 588, answer_rate: 91.4, talk_seconds: 1_483_200, ring_seconds: 1000, avg_talk_seconds: 217 }, cost: { total: 48210, calls_priced: 2100 }, coverage: { known: true, samples: 100, reachable_pct: 98, message: 'Kandy FreePBX unreachable 14 Sep 13:10–15:40.' } };
      case '/api/voip/reports/volume':
        return { range, daily: [{ date: '2026-10-05', total: 230, inbound: 120, outbound: 100, answered: 210 }, { date: '2026-10-06', total: 12, inbound: 6, outbound: 6, answered: 12 }], hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, total: hour * 2, answered: hour })) };
      case '/api/voip/reports/agents':
        return { range, agents: [{ extension: '1020', name: 'Sanduni', department: 'Support', calls: 612, answered: 594, inbound: 400, outbound: 212, talk_seconds: 150_000, avg_talk_seconds: 242, avg_ring_seconds: 6, answer_rate: 97 }] };
      case '/api/voip/reports/queues':
        return { range, queues: [{ name: 'Sales', number: '600', calls: 1422, answered: 1300, abandoned: 122, avg_wait_seconds: 19, max_wait_seconds: 300, sla_seconds: 30, sla_rate: 86, live: { waiting: 1, holdtime: 21, members: 6 } }] };
      case '/api/voip/reports/departments':
        return { range, departments: [{ department: 'Sales', calls: 900, answered: 850, talk_seconds: 90_000, cost: 12000 }] };
      case '/api/contacts/directory':
        return [{ id: 1, name: 'Hasini Jayawardena', email: 'hasini@example.lk', phone: null }];
      case '/api/directory/departments':
        return [{ id: 1, name: 'Sales' }];
      case '/api/hr/holidays':
        return { holidays: [{ on_date: '2026-10-20', name: 'Deepavali' }] };
      default:
        throw new ApiError(404, `The server answered 404 (${path}).`, null);
    }
  };
}

const ROUTES: Array<[string, RegExp]> = [
  ['/phone', /Recent/],
  ['/phone/calls', /Supervisors see the whole team/],
  ['/phone/calls/1', /Call recording/],
  ['/phone/voicemail', /Dial \*97 from any phone/],
  ['/phone/forwarding', /Where my calls go/],
  ['/phone/live', /Live board/],
  ['/phone/reports', /Call reports/],
  ['/phone/recordings', /Recordings are/],
  ['/phone/extensions', /New extension/],
  ['/phone/servers', /Which part of the business uses which switch/],
  ['/phone/servers/1', /Connection test/],
  ['/phone/servers/new', /New server/],
  ['/phone/setup', /Set up a cloud FreePBX/],
  ['/phone/trunks', /Trunks & routes/],
  ['/phone/inbound', /Inbound & IVR/],
  ['/phone/queues', /Queues & ring groups/],
  ['/phone/dialplan', /Short codes/],
  ['/phone/settings', /Telephony settings/],
  ['/phone/compact', /Global shortcuts/],
];

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'], organizations: [] } as never });
});
afterEach(() => cleanup());

describe.each([
  ['today’s server', false],
  ['a server with the proposed endpoints', true],
])('every Phone screen against %s', (_name, offered) => {
  it.each(ROUTES)('%s draws', async (route, heading) => {
    vi.mocked(apiGet).mockImplementation(answer(offered) as never);
    tab.route = route;
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhonePage tabId="t" route={route} active />
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText(heading, undefined, { timeout: 4000 })).length).toBeGreaterThan(0);
    // Let the queries settle: a render loop or a crash shows up here.
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });
});
