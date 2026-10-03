// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * A visitor's voice call in their thread on the desktop (WS-WCHAT ENH-WCHAT-05, VOICE-10…15, VOICE-UI-03): Answer and
 * Decline while it rings for me, the call's own room with the microphone only, Mute, Hold, End with notes; Join for a
 * colleague in the chat; joining once when WorkSuite came forward on a call answered in the call window; Offer call.
 */
const lk = vi.hoisted(() => {
  class FakeRoom {
    static made: FakeRoom[] = [];
    handlers: Record<string, (...a: unknown[]) => void> = {};
    localParticipant = { setMicrophoneEnabled: vi.fn(async (_on: boolean) => undefined) };
    connect = vi.fn(async (_url: string, _token: string) => undefined);
    disconnect = vi.fn(async () => undefined);
    constructor() {
      FakeRoom.made.push(this);
    }
    on(ev: string, fn: (...a: unknown[]) => void) {
      this.handlers[ev] = fn;
      return this;
    }
  }
  return { FakeRoom };
});
vi.mock('livekit-client', () => ({
  Room: lk.FakeRoom,
  RoomEvent: { TrackSubscribed: 'ts', TrackUnsubscribed: 'tu', ActiveSpeakersChanged: 'as', ConnectionQualityChanged: 'cq', Reconnecting: 'rc', Reconnected: 'rd', Disconnected: 'dc' },
  Track: { Kind: { Audio: 'audio' } },
  ConnectionQuality: { Excellent: 'excellent', Good: 'good', Poor: 'poor', Lost: 'lost', Unknown: 'unknown' },
  VideoPresets: { h720: { resolution: {} } },
  createLocalTracks: vi.fn(),
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => []),
  on: () => () => undefined,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div> }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/modules/chat/AttachmentViewer', () => ({ openChatAttachment: vi.fn() }));
const tab = { query: 'view=website&website=41' };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams(tab.query), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import type { WebsiteCall, WebsiteConversation } from '../../../src/modules/chat/website/api';
import { canJoinCall } from '../../../src/modules/chat/website/CallBar';
import { websiteCall } from '../../../src/modules/chat/website/call';
import { watchMicrophone } from '../../../src/modules/chat/website/mic';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
let voice: WebsiteCall | null = null;
// Each test its own call: the session joins a call by itself only once (a thread opened again on it does not rejoin).
let cid = 100;
const thread = (): WebsiteConversation => ({
  conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: 3, visitor_typing: false, started_at: ago(600_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: { name: 'Kamal Perera' } as WebsiteConversation['visitor'],
  messages: [{ id: 1, body: 'Can I call you?', from: 'visitor', agent: null, at: ago(60_000), file: null }],
  journey: [],
  history: [],
  team: null,
  call: voice,
  can_call: true,
  can: { view: true, reply: true, manage: false },
});
const ringing = (over: Partial<WebsiteCall> = {}): WebsiteCall => ({
  call_id: cid, conversation_id: 41, status: 'ringing', requested_at: ago(9_000), answered_at: null, answered_by: null, answered_by_name: null, duration: null,
  on_call: false, rings_me: true, on: [], ...over,
});
const answered = (over: Partial<WebsiteCall> = {}): WebsiteCall => ringing({ status: 'active', answered_at: ago(74_000), answered_by: 3, answered_by_name: 'Samali Perera', on_call: true, rings_me: false, on: [{ user_id: 3, name: 'Samali Perera' }], ...over });

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  lk.FakeRoom.made = [];
  cid += 1;
  voice = null;
  tab.query = 'view=website&website=41';
  app.set({ auth: { stage: 'ready', user: { id: '3' } } as never });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations/41') return thread();
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/widget-admin/agents') return { agents: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPost).mockReset().mockImplementation((async (path: string) => {
    if (path === `/api/chat/widget-admin/calls/${cid}/join`) return { call_id: cid, conversation_id: 41, url: 'wss://lk.example', room: 'room-uuid', token: 'staff-token' };
    if (path === `/api/chat/widget-admin/calls/${cid}/answer`) {
      voice = answered();
      return { call_id: cid, url: 'wss://lk.example', token: 'staff-token' };
    }
    return {};
  }) as never);
  vi.mocked(call).mockClear();
});
afterEach(() => {
  websiteCall.over(cid);
  websiteCall.clear(cid);
  cleanup();
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WebsiteThread id="41" />
    </QueryClientProvider>,
  );

describe('a call ringing in the thread (VOICE-10, VOICE-12)', () => {
  it('Answer takes it and joins its room with the microphone only; the bar says how long, and the tray is told', async () => {
    voice = ringing();
    mount();
    const bar = await screen.findByRole('status', { name: 'Voice call ringing' });
    expect(bar.textContent).toContain('Kamal Perera is calling');
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await waitFor(() => expect(lk.FakeRoom.made).toHaveLength(1));
    expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/answer`, {});
    const room = lk.FakeRoom.made[0]!;
    await waitFor(() => expect(room.connect).toHaveBeenCalledWith('wss://lk.example', 'staff-token'));
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Voice call' }).textContent).toMatch(/On a call1:1\d/));
    expect(call).toHaveBeenCalledWith('ring:onCall', expect.objectContaining({ conversationId: 41, visitor: 'Kamal Perera', held: false }));
    expect(call).toHaveBeenCalledWith('updates:setActiveCall', { active: true });
  });

  it('Decline says no for me', async () => {
    voice = ringing();
    mount();
    await screen.findByRole('status', { name: 'Voice call ringing' });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/decline`, {}));
    expect(lk.FakeRoom.made).toHaveLength(0);
  });

  it('ringing for the team but not for me, only says so', async () => {
    voice = ringing({ rings_me: false });
    mount();
    const bar = await screen.findByRole('status', { name: 'Voice call ringing' });
    expect(bar.textContent).toContain('Kamal Perera is calling the team');
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
  });
});

describe('on the call (VOICE-13)', () => {
  const onIt = async () => {
    voice = answered();
    tab.query = `view=website&website=41&call=${cid}`;
    mount();
    await waitFor(() => expect(lk.FakeRoom.made).toHaveLength(1));
    await screen.findByRole('button', { name: 'Mute' });
    return lk.FakeRoom.made[0]!;
  };

  it('joins once when WorkSuite came forward on a call answered in the call window', async () => {
    const room = await onIt();
    expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/join`, {});
    expect(room.connect).toHaveBeenCalledWith('wss://lk.example', 'staff-token');
    expect(websiteCall.triedOnce(cid)).toBe(true);
  });

  it('Mute, and Ctrl+Shift+M; Hold tells the server and turns the microphone off', async () => {
    const room = await onIt();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true');
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', ctrlKey: true, shiftKey: true })));
    await waitFor(() => expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true));

    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/hold`, { on: true }));
    await screen.findByRole('button', { name: 'Resume' });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('status', { name: 'Voice call' }).textContent).toContain('On hold');
  });

  it('End asks for notes, ends it for everybody and lets the room go', async () => {
    const room = await onIt();
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    const dialog = await screen.findByRole('dialog', { name: 'End the call' });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Wants the yearly plan; send a quote.' } });
    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/end`, { for_everyone: true, notes: 'Wants the yearly plan; send a quote.' }));
    expect(room.disconnect).toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith('ring:onCall', null);
  });

  it('with a colleague on it too, I can leave it to them', async () => {
    voice = answered({ on: [{ user_id: 3, name: 'Samali Perera' }, { user_id: 7, name: 'Nimal Silva' }] });
    tab.query = `view=website&website=41&call=${cid}`;
    mount();
    await screen.findByRole('button', { name: 'Mute' });
    expect(screen.getByRole('status', { name: 'Voice call' }).textContent).toContain('with Nimal Silva');
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    await screen.findByRole('dialog', { name: 'End the call' });
    fireEvent.click(screen.getByRole('button', { name: 'Leave the call' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/end`, { for_everyone: false, notes: null }));
  });
});

describe('a colleague\'s call, and offering one', () => {
  it('a colleague on a call in my chat: I can join it (WF-V3)', async () => {
    voice = answered({ answered_by: 7, answered_by_name: 'Nimal Silva', on_call: false, on: [{ user_id: 7, name: 'Nimal Silva' }] });
    mount();
    const bar = await screen.findByRole('status', { name: 'Voice call' });
    expect(bar.textContent).toContain('Nimal Silva is on a call with Kamal Perera');
    fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
    await waitFor(() => expect(lk.FakeRoom.made).toHaveLength(1));
    expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/join`, {});
  });

  it('only the chat\'s owner and participants who take calls can join', () => {
    const base = { conversation: { assigned_to: 3 } as WebsiteConversation['conversation'], team: null, can_call: true };
    expect(canJoinCall(base, 3)).toBe(true);
    expect(canJoinCall(base, 8)).toBe(false);
    expect(canJoinCall({ ...base, team: { my_role: 'participant' } as WebsiteConversation['team'] }, 8)).toBe(true);
    expect(canJoinCall({ ...base, team: { my_role: 'observer' } as WebsiteConversation['team'] }, 8)).toBe(false);
    expect(canJoinCall({ ...base, can_call: false }, 3)).toBe(false);
  });

  it('the server ending the call lets the room go', async () => {
    voice = answered();
    tab.query = `view=website&website=41&call=${cid}`;
    const view = mount();
    await waitFor(() => expect(lk.FakeRoom.made).toHaveLength(1));
    await screen.findByRole('button', { name: 'Mute' });
    voice = { ...answered(), status: 'ended', on_call: false };
    view.unmount();
    mount();
    await waitFor(() => expect(lk.FakeRoom.made[0]!.disconnect).toHaveBeenCalled());
  });

  it('Offer call asks the server to offer the visitor a call that rings me (VOICE-15)', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Offer call' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/offer-call', {}));
  });
});

describe('whether this computer can take a call (VOICE-11)', () => {
  it('tells the main process whether there is a microphone, and again when devices change', async () => {
    let devices: Array<{ kind: string }> = [{ kind: 'audiooutput' }, { kind: 'audioinput' }];
    const listeners: Array<() => void> = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: vi.fn(async () => devices), addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: vi.fn() },
    });
    const stop = watchMicrophone();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:mic', { has: true }));
    devices = [{ kind: 'audiooutput' }];
    listeners.forEach((fn) => fn());
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:mic', { has: false }));
    // The same answer again is not news.
    const n = vi.mocked(call).mock.calls.filter(([c]) => c === 'ring:mic').length;
    listeners.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(call).mock.calls.filter(([c]) => c === 'ring:mic').length).toBe(n);
    stop();
  });
});
