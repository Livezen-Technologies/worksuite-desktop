// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('sip.js', () => ({
  Invitation: class {},
  Inviter: class {},
  Registerer: class {},
  RegistererState: {},
  SessionState: {},
  UserAgent: { makeURI: () => undefined },
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn(), ringVolume: () => 0.5 }));
const tab = { route: '/phone', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), active: true, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { isNotOffered, optional } from '../../../src/modules/phone/api';
import { phoneAccess } from '../../../src/modules/phone/access';
import { agentState, callsFromChannels } from '../../../src/modules/phone/admin/LiveBoard';
import { bodyOf, splitAri } from '../../../src/modules/phone/admin/ServerEditor';
import { visibleSections } from '../../../src/modules/phone/Nav';
import PhonePage, { sectionOf } from '../../../src/modules/phone/PhonePage';
import { fromRecord } from '../../../src/modules/phone/screens/CallDetail';

/**
 * The Phone's screens (WS-VOIP-SRS-001 §8): navigation shaped by permission, honest states (no PBX, not offered by
 * this server), and the helpers the supervisor and admin screens rely on.
 */
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

let pbxUp = true;
let trunksOffered = true;

beforeEach(() => {
  pbxUp = true;
  trunksOffered = true;
  tab.route = '/phone';
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    switch (path) {
      case '/api/voip/status':
        return { pbx: { ok: pbxUp }, counts: { extensions: 3, trunks: 1, gateways: 0, queues: 1 }, secrets: true, websocket: { path: '/ws', domain: 'pbx.example.lk' }, message: pbxUp ? null : 'No PBX is reachable. Extensions, trunks and history can be managed, but no call can be placed until Asterisk is running and its AMI credentials are set.' };
      case '/api/voip/softphone':
        throw new ApiError(404, 'You do not have an extension yet. An administrator can create one for you.', null);
      case '/api/voip/extensions':
        return { extensions: [] };
      case '/api/voip/calls':
        return { calls: [], page: 1, per_page: 30, total: 0 };
      case '/api/voip/recordings':
        return { recordings: [], page: 1, per_page: 50, total: 0, retention_note: '' };
      case '/api/voip/trunks':
        if (!trunksOffered) throw new ApiError(404, 'The server answered 404.', null);
        return { trunks: [] };
      case '/api/voip/routes':
      case '/api/voip/gateways':
      case '/api/voip/sim-cards':
      case '/api/voip/me':
      case '/api/voip/speed-dials':
        throw new ApiError(404, 'The server answered 404.', null);
      default:
        throw new ApiError(404, 'The server answered 404.', null);
    }
  }) as never);
  app.set({ bootstrap: { permissions: [] } as never });
});

afterEach(() => cleanup());

describe('who sees what', () => {
  it('shapes the sections by permission (§2.2)', () => {
    expect(visibleSections(phoneAccess([]))).toEqual(['dial', 'calls', 'voicemail', 'forwarding']);
    expect(visibleSections(phoneAccess(['voip.reports']))).toEqual(['dial', 'calls', 'voicemail', 'forwarding', 'live', 'reports', 'recordings']);
    expect(visibleSections(phoneAccess(['voip.supervise']))).toEqual(['dial', 'calls', 'voicemail', 'forwarding', 'live']);
    const admin = visibleSections(phoneAccess(['voip.manage']));
    expect(admin).toContain('extensions');
    expect(admin).toContain('settings');
    expect(visibleSections(phoneAccess(['*']))).toHaveLength(14);
  });

  it('maps routes to sections', () => {
    expect(sectionOf(['phone'])).toBe('dial');
    expect(sectionOf(['phone', 'call'])).toBe('dial');
    expect(sectionOf(['phone', 'calls', '12'])).toBe('calls');
    expect(sectionOf(['phone', 'setup'])).toBe('servers');
    expect(sectionOf(['phone', 'nonsense'])).toBe('dial');
  });

  it('shows an agent only My phone, and refuses an admin screen it reaches by link', async () => {
    wrap(<PhonePage tabId="t" route="/phone" active />);
    expect(screen.getByRole('button', { name: 'Calls' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Extensions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Live board' })).toBeNull();
    cleanup();
    tab.route = '/phone/extensions';
    wrap(<PhonePage tabId="t" route="/phone/extensions" active />);
    expect(await screen.findByText('You don’t have access to this part of the Phone')).toBeTruthy();
  });
});

describe('honest states', () => {
  it('says no PBX is reachable and greys out Call (VOIP-SP-05, AC-10)', async () => {
    pbxUp = false;
    wrap(<PhonePage tabId="t" route="/phone" active />);
    expect(await screen.findByText(/No PBX is reachable/)).toBeTruthy();
    const call = screen.getByRole('button', { name: 'Call' }) as HTMLButtonElement;
    expect(call.disabled).toBe(true);
  });

  it('says plainly when this server does not offer trunks yet (G-03)', async () => {
    app.set({ bootstrap: { permissions: ['voip.manage'] } as never });
    tab.route = '/phone/trunks';
    trunksOffered = false;
    wrap(<PhonePage tabId="t" route="/phone/trunks" active />);
    expect(await screen.findByText('Managing trunks, gateways and routes isn’t offered by this WorkSuite server yet')).toBeTruthy();
  });

  it('tells a missing route from a refusal', async () => {
    expect(isNotOffered(new ApiError(404, 'The server answered 404.', null))).toBe(true);
    expect(isNotOffered(new ApiError(403, 'No.', null))).toBe(false);
    expect(await optional(Promise.reject(new ApiError(404, 'x', null)))).toMatchObject({ offered: false });
    expect(await optional(Promise.resolve([1]))).toEqual({ offered: true, data: [1] });
    await expect(optional(Promise.reject(new ApiError(403, 'No.', null)))).rejects.toThrow('No.');
  });

  it('builds the call path only from what the record says (VOIP-HIS-07)', () => {
    const d = {
      call: { id: 1, uniqueid: null, linkedid: null, direction: 'inbound', from_number: '0773124408', to_number: '0112447000', extension_id: 1, user_id: 1, trunk_id: null, queue_id: 3, contact_id: null, disposition: 'answered', ring_seconds: 8, talk_seconds: 372, cost: null, recording_id: null, hangup_cause: 'Normal clearing', quality_mos: null, started_at: '2026-10-02 10:41:02', answered_at: '2026-10-02 10:41:19', ended_at: '2026-10-02 10:47:31', notes: null },
      context: {} as never,
      notes: [],
    } as const;
    expect(fromRecord(d as never).map((e) => e.event)).toEqual(['start', 'queue', 'answer', 'hangup']);
    expect(fromRecord(d as never)[3]!.detail).toBe('Normal clearing');
  });
});

describe('admin helpers', () => {
  it('builds the live board from the switch’s channels: one call per linkedid', () => {
    const exts = [{ id: 1, extension: '1042', name: 'Hasini', user_name: 'Hasini J.', presence: 'online', enabled: true, user_id: 7 }] as never;
    const calls = callsFromChannels(
      [
        { server_id: 1, server: 'Colombo PBX', ok: true, message: null, channels: [
          { channel: 'PJSIP/1042-0001', state: 'Up', caller: '1042', caller_name: 'Hasini', connected: '0773124408', exten: '', context: '', duration: 252, uniqueid: 'a', linkedid: 'L1' },
          { channel: 'PJSIP/SLT-PSTN-0002', state: 'Up', caller: '0773124408', caller_name: '', connected: '1042', exten: '', context: '', duration: 260, uniqueid: 'b', linkedid: 'L1' },
        ] },
      ],
      exts,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ channel: 'PJSIP/1042-0001', seconds: 260, who: 'Hasini J. (1042)', other: '0773124408', internal: false });
    expect(agentState({ extension: '1042', presence: 'online' } as never, new Set(['1042']))).toBe('on_call');
    expect(agentState({ extension: '1015', presence: 'dnd' } as never, new Set())).toBe('paused');
    expect(agentState({ extension: '1015', presence: 'offline' } as never, new Set())).toBe('offline');
  });

  it('reads ARI as a full URL and never sends a blank secret (VOIP-SRV-02, VOIP-DEP-01)', () => {
    expect(splitAri('http://10.88.0.1:8088', '')).toEqual({ host: 'http://10.88.0.1', port: 8088 });
    expect(splitAri('10.88.0.1', '8089')).toEqual({ host: '10.88.0.1', port: 8089 });
    const body = bodyOf({
      name: ' Kandy FreePBX ', description: '', driver: 'freepbx', region: '', timezone: 'Asia/Colombo', hostname: 'kandy-pbx', sip_domain: '', public_ip: '', private_ip: '10.20.0.5',
      api_base: 'https://kandy-pbx', auth_kind: 'oauth_client', client_id: 'worksuite-sync', api_user: '', ami_host: '10.20.0.5', ami_port: '5038', ami_user: 'worksuite', ari_host: 'https://kandy-pbx:8089', ari_port: '8088', ari_user: 'worksuite', ari_app: 'worksuite',
      ws_url: '', stun_url: '', turn_url: '', turn_user: '', sync_interval: '60', is_default: false, enabled: true,
      client_secret: '', api_key: '', api_password: '', ami_secret: 'new-secret', ari_secret: '', turn_secret: '',
    });
    expect(body.name).toBe('Kandy FreePBX');
    expect(body.ari_port).toBe(8089);
    expect(body.ami_secret).toBe('new-secret');
    expect('client_secret' in body).toBe(false);
    expect('ari_secret' in body).toBe(false);
  });
});

describe('the Phone is reachable', () => {
  it('loads its sections lazily', async () => {
    tab.route = '/phone/calls';
    wrap(<PhonePage tabId="t" route="/phone/calls" active />);
    await waitFor(() => expect(screen.getByText('No calls match')).toBeTruthy());
  });
});
