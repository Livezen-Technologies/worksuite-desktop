// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { b64 } from '@shared/remote-control/channel';

/**
 * The remote-control surface over a shared screen in the meeting window:
 * Request control or the reason it can't be asked for, this computer's
 * policy, the wait with its Cancel, the step-up, and the controlling bar.
 */

const policy = vi.hoisted(() => ({ controller: 'allowed' as 'allowed' | 'disabled' }));
const room = vi.hoisted(() => ({ localParticipant: { identity: 'u5-me', publishData: async () => undefined } }));

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', () => ({
  app: { get: () => ({ bootstrap: { policy: { remote_control_controller: policy.controller } } }), subscribe: () => () => undefined },
}));
vi.mock('../../../src/modules/meet/session', () => ({ meet: { room } }));

import { ApiError, apiDelete, apiGet, apiPost } from '../../../src/core/api';
import type { CallPerson } from '../../../src/modules/calls/ui/people';
import type { ControlSession, ControlState, Share } from '../../../src/modules/meet/remote/api';
import { remote } from '../../../src/modules/meet/remote/controller';
import { RemoteControlLayer } from '../../../src/modules/meet/remote/ControllerSurface';

const get = vi.mocked(apiGet);
const post = vi.mocked(apiPost);

const avail = { can_request: true, code: 'available', reason: '', pointer: true, annotate: true, handover: false, notes: [] };
const share = (over: Partial<Share> = {}): Share => ({
  id: 44, user_id: 3, name: 'Hasarinda', identity: 'u3-hana', client: 'desktop', surface: 'screen', label: 'Screen 1', allow_requests: true,
  quality: 'auto', status: 'SHARING_VIEW_ONLY', paused: false, started_at: '2026-09-28 10:00:00',
  device: { platform: 'windows', os_version: '11', desktop_version: '0.2.40', display_server: null, displays: 1, report: '' }, availability: avail, ...over,
});
const session = (over: Partial<ControlSession> = {}): ControlSession => ({
  id: 12, share_id: 44, status: 'CONTROL_APPROVED', role: 'controller', pause_reason: null,
  caps: { mouse: true, keyboard: true, clipboard: 'off', file_transfer: false, monitor_switch: false }, caps_label: 'Mouse and keyboard',
  sharer: { id: 3, name: 'Hasarinda', identity: 'u3-hana' }, controller: { id: 5, name: 'Samali', identity: 'u5-me' },
  reason: null, duration: '15', approved_at: null, started_at: null, expires_at: null, key_version: 1, grant_waiting: true,
  type: 'meeting', ticket_id: null, mfa_passed: false, ...over,
});
const state = (shares: Share[], sessions: ControlSession[] = []): ControlState => ({
  shares, requests: [], asked: [], sessions,
  options: { remote_control_mode: 'participants', viewer_pointer: true, share_mode: 'everyone', record_type: null, can_edit: false, is_host: false },
  server: { signing: true, lease_s: 30, lease_renew_s: 10 }, at: 0,
});

const sharer: CallPerson = { id: 'u3-hana', name: 'Hasarinda', self: false, speaking: false, micOn: true, camera: null, screen: null, screenPaused: false };
let current: ControlState;

async function show(s: ControlState) {
  current = s;
  remote.start('m-1');
  await act(() => remote.refresh());
  render(<RemoteControlLayer sharer={sharer} />);
}

beforeEach(() => {
  policy.controller = 'allowed';
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/control/state')) return structuredClone(current);
    if (path.endsWith('/grant')) return { token: 't', key: b64(new Uint8Array(32).fill(7)), claims: { grant_id: 'g-1', session_id: 12, meeting_id: 'm-1', sharer_identity: 'u3-hana', controller_identity: 'u5-me', caps: session().caps, exp: Date.now() / 1000 + 600, lease_s: 30, lease_renew_s: 10, key_version: 1 }, public_key: null, rate: {} };
    return { id: 12, termination: null, ended_by: 'Hasarinda', ended_at: null };
  });
  post.mockImplementation(async (path: string) => {
    if (path.endsWith('/control/requests')) {
      current = { ...current, requests: [{ id: 9, session_id: 12, share_id: 44, kind: 'request', requester: { id: 5, name: 'Samali' }, sharer: { id: 3, name: 'Hasarinda' }, reason: null, expires_in: 60, status: 'pending' }] };
      return { request_id: 9, session_id: 12, expires_in: 60, handover: false };
    }
    return {};
  });
  vi.mocked(apiDelete).mockImplementation(async () => {
    current = { ...current, requests: [] };
    return {};
  });
});

afterEach(async () => {
  cleanup();
  if (remote.session) await remote.release();
  remote.stop();
});

describe('under a shared screen', () => {
  it('offers Request control, asks with an optional reason, then waits with a countdown and a Cancel', async () => {
    await show(state([share()]));
    fireEvent.click(screen.getByRole('button', { name: /Request control/ }));

    expect(screen.getByText('Ask Hasarinda for control')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Printer driver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/meet/m-1/control/requests', { share_id: 44, identity: 'u5-me', reason: 'Printer driver' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/Request sent\. Waiting for Hasarinda to allow control… \((59|60) s\)/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/meet/control/requests/9'));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: /Request control/ })).toBeTruthy();
  });

  it("doesn't offer it when this computer's policy turns controlling off, and says so", async () => {
    policy.controller = 'disabled';
    await show(state([share()]));

    expect(screen.queryByRole('button', { name: /Request control/ })).toBeNull();
    expect(screen.getByTestId('control-reason').textContent).toBe('Controlling other computers is turned off on this computer by its policy.');
  });

  it("shows the server's sentence when control can't be asked for", async () => {
    await show(state([share({ client: 'web', availability: { ...avail, can_request: false, code: 'browser', reason: 'Browsers can share a screen but can never be controlled.' } })]));

    expect(screen.queryByRole('button', { name: /Request control/ })).toBeNull();
    expect(screen.getByTestId('control-reason').textContent).toBe('Browsers can share a screen but can never be controlled.');
  });

  it('asks for the authenticator code when policy wants a step-up, and tries again', async () => {
    let n = 0;
    const original = post.getMockImplementation()!;
    post.mockImplementation(async (path: string, body?: unknown) => {
      if (path.endsWith('/control/requests') && n++ === 0) throw new ApiError(428, "Confirm it's you first.", null, { code: 'step_up' });
      return original(path, body);
    });
    await show(state([share()]));
    fireEvent.click(screen.getByRole('button', { name: /Request control/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await screen.findByText("Confirm it's you first.");
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/meet/control/step-up', { code: '123456' }));
    await screen.findByText(/Waiting for Hasarinda to allow control/);
    expect(post.mock.calls.filter(([p]) => p.endsWith('/control/requests'))).toHaveLength(2);
  });
});

describe('while controlling', () => {
  it('shows the state, the special keys and Release control; paused, why', async () => {
    await show(state([share()], [session()]));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/meet/control/sessions/12/confirm', { end: 'controller' }));
    current = state([share()], [session({ status: 'CONTROL_ACTIVE', grant_waiting: false })]);
    await act(() => remote.refresh());

    expect(screen.getByText('Control active')).toBeTruthy();
    expect(screen.getByTestId('control-surface').getAttribute('aria-label')).toBe("Hasarinda's screen. Click to control it; your keys go to their computer.");
    fireEvent.click(screen.getByRole('button', { name: /Special keys/ }));
    expect(screen.getByRole('menuitem', { name: /Ctrl \+ Alt \+ Delete/ })).toBeTruthy();

    current = state([share()], [session({ status: 'CONTROL_PAUSED', grant_waiting: false, pause_reason: 'protected_app' })]);
    await act(() => remote.refresh());
    expect(screen.getByText('Protected screen')).toBeTruthy();
    expect(screen.getByText(/a password manager or banking app is in front on Hasarinda's computer/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Release control' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/meet/control/sessions/12/stop', { reason: 'released' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release control' })).toBeNull());
  });
});
