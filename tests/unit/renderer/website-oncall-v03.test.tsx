// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as AttachmentViewer from '../../../src/modules/chat/AttachmentViewer';

/**
 * V-03 "On a voice call with a visitor" (VOICE-UI-02; VOICE-12, VOICE-13, VOICE-14, TEAM-60, WF-V3, VNFR-04): the call
 * controls — "Voice call · Kamal Perera 1:14" over "Good connection · not recorded", Mute, Hold, Invite, Transfer, the
 * audio devices and End; the CALL NOTES · STAFF ONLY panel kept on the server as I write and saved when the call ends;
 * the call's lines in the transcript as staff read them; a colleague invited during the call joining its audio; the
 * media mute key; and the call's pill in the title bar. LiveKit and the media devices are faked, as in the other voice
 * tests: jsdom has no audio.
 */
const lk = vi.hoisted(() => {
  class FakeRoom {
    static made: FakeRoom[] = [];
    static devices: Record<string, Array<{ deviceId: string; label: string; kind: string }>> = { audioinput: [], audiooutput: [] };
    static getLocalDevices = async (kind: string) => FakeRoom.devices[kind] ?? [];
    handlers: Record<string, (...a: unknown[]) => void> = {};
    localParticipant = { setMicrophoneEnabled: vi.fn(async (_on: boolean, _opts?: unknown) => undefined) };
    connect = vi.fn(async (_url: string, _token: string) => undefined);
    disconnect = vi.fn(async () => undefined);
    switchActiveDevice = vi.fn(async (_kind: string, _id: string) => true);
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
  createLocalAudioTrack: vi.fn(),
  createLocalVideoTrack: vi.fn(),
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
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<Record<string, unknown>>()), navigate: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div>, websiteNoteDraftKey: (id: number) => `note-${id}` }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/modules/chat/AttachmentViewer', async (orig) => ({ ...(await orig<typeof AttachmentViewer>()), openChatAttachment: vi.fn() }));
const tab = { query: 'view=website&website=41' };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams(tab.query), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { navigate } from '../../../src/core/tabs';
import { ActiveCalls } from '../../../src/app/ActiveCalls';
import type { WebsiteCall, WebsiteConversation, WebsiteMessage, WebsiteTeam } from '../../../src/modules/chat/website/api';
import { callNotice } from '../../../src/modules/chat/website/CallBar';
import { websiteCall } from '../../../src/modules/chat/website/call';
import { handoffDetail } from '../../../src/modules/chat/website/Ringing';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
let voice: WebsiteCall | null = null;
let team: WebsiteTeam | null = null;
let messages: WebsiteMessage[] = [];
let draftFails = false;
// Each test its own call: the session joins a call by itself only once.
let cid = 500;
const thread = (): WebsiteConversation => ({
  conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: 3, visitor_typing: false, started_at: ago(600_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: { name: 'Kamal Perera' } as WebsiteConversation['visitor'],
  messages,
  journey: [],
  history: [],
  team,
  call: voice,
  can_call: true,
  can: { view: true, reply: true, manage: false },
});
const answered = (over: Partial<WebsiteCall> = {}): WebsiteCall => ({
  call_id: cid, conversation_id: 41, status: 'active', requested_at: ago(86_000), answered_at: ago(74_000), answered_by: 3, answered_by_name: 'Samali Perera', duration: null,
  on_call: true, rings_me: false, on: [{ user_id: 3, name: 'Samali Perera' }], recorded: false, my_notes: '', ...over,
});
const owner = (over: Partial<WebsiteTeam> = {}): WebsiteTeam => ({
  people: [{ user_id: 3, name: 'Samali Perera', role: 'owner' } as WebsiteTeam['people'][number]], pending: [], my_role: 'owner', max: 4, transfer_count: 0,
  can: { invite: true, transfer: true, leave: true, remove: true, note: true, monitor: false, join: false, take_over: false }, ...over,
});

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  lk.FakeRoom.made = [];
  lk.FakeRoom.devices = { audioinput: [], audiooutput: [] };
  cid += 1;
  voice = null;
  team = null;
  messages = [{ id: 1, body: 'OK. Price for 5 seats?', from: 'visitor', agent: null, at: ago(60_000), file: null }];
  draftFails = false;
  tab.query = 'view=website&website=41';
  localStorage.clear();
  app.set({ auth: { stage: 'ready', user: { id: '3' } } as never });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations/41') return thread();
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/widget-admin/agents') return { agents: [] };
    return {};
  }) as never);
  vi.mocked(apiPost).mockReset().mockImplementation((async (path: string) => {
    if (path === `/api/chat/widget-admin/calls/${cid}/join`) return { call_id: cid, conversation_id: 41, url: 'wss://lk.example', room: 'room-uuid', token: 'staff-token' };
    if (path === `/api/chat/widget-admin/calls/${cid}/draft` && draftFails) throw new Error('offline');
    return {};
  }) as never);
});
afterEach(() => {
  websiteCall.over(cid);
  websiteCall.clear(cid);
  cleanup();
  Reflect.deleteProperty(navigator, 'mediaSession');
});

const mount = (ui = <WebsiteThread id="41" />) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

/** On the call with me, joined on this computer (WorkSuite came forward on it with `call=`). */
const onIt = async () => {
  voice ??= answered();
  tab.query = `view=website&website=41&call=${cid}`;
  const view = mount();
  await waitFor(() => expect(lk.FakeRoom.made).toHaveLength(1));
  await screen.findByRole('button', { name: 'Mute' });
  return { room: lk.FakeRoom.made[0]!, view };
};
const bar = () => screen.getByRole('region', { name: 'Call controls' });

describe('the call controls (VOICE-UI-02, VOICE-13)', () => {
  it('say who, how long, how the line is and that it is not recorded; then Mute, Hold, Invite, Transfer, devices and End', async () => {
    team = owner();
    const { room } = await onIt();
    await waitFor(() => expect(bar().textContent).toMatch(/Voice call · Kamal Perera 1:1\d/));
    expect(bar().textContent).toContain('Connected · not recorded');
    // LiveKit says how the line is: "Good connection".
    act(() => room.handlers.cq!('excellent', { isLocal: true }));
    await waitFor(() => expect(bar().textContent).toContain('Good connection · not recorded'));
    const names = within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(names).toEqual(['Mute', 'Hold', 'Invite', 'Transfer', 'Audio devices', 'End']);
  });

  it('a recorded call says so', async () => {
    voice = answered({ recorded: true });
    await onIt();
    await waitFor(() => expect(bar().textContent).toContain('Recording'));
    expect(bar().textContent).not.toContain('not recorded');
  });

  it('announces state changes, never the clock; on hold the bar turns amber and says the visitor hears the tone (VNFR-04)', async () => {
    await onIt();
    const heard = within(bar()).getByRole('status');
    expect(heard.textContent).toBe('On a call with Kamal Perera');
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    await screen.findByRole('button', { name: 'Resume' });
    expect(heard.textContent).toBe('Call on hold');
    expect(bar().textContent).toContain('On hold — they hear the hold tone');
    expect(bar().className).toContain('bg-warning-bg');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByRole('button', { name: 'Hold' });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(heard.textContent).toBe('On the call, muted'));
    expect(bar().textContent).toContain('you are muted');
  });

  it('Invite and Transfer open the team dialogs, the call going on under them (WF-V3)', async () => {
    team = owner();
    await onIt();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Invite' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('call notes, staff only (VOICE-13, TEAM-60)', () => {
  it('start from what the server kept, are saved as I write, and End sends them', async () => {
    voice = answered({ my_notes: 'Wants 5 seats' });
    await onIt();
    const panel = await screen.findByRole('region', { name: 'Call notes' });
    expect(within(panel).getByText('Call notes · staff only')).toBeTruthy();
    expect(within(panel).getByText('Saved as an internal note when the call ends.')).toBeTruthy();
    const box = within(panel).getByRole('textbox', { name: 'Call notes' }) as HTMLTextAreaElement;
    expect(box.value).toBe('Wants 5 seats');

    fireEvent.change(box, { target: { value: 'Wants 5 seats, student studio.' } });
    fireEvent.blur(box);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/draft`, { notes: 'Wants 5 seats, student studio.' }));

    // The End dialog has the same notes: one text, wherever it is written.
    fireEvent.click(within(bar()).getByRole('button', { name: 'End' }));
    const dialog = await screen.findByRole('dialog', { name: 'End the call' });
    expect((dialog.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Wants 5 seats, student studio.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'End call' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/end`, { for_everyone: true, notes: 'Wants 5 seats, student studio.' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Call notes' })).toBeNull());
  });

  it('a save that does not reach the server says they are kept and go with End', async () => {
    draftFails = true;
    await onIt();
    const box = await screen.findByRole('textbox', { name: 'Call notes' });
    fireEvent.change(box, { target: { value: 'Send the edu form' } });
    fireEvent.blur(box);
    expect(await screen.findByText('Not saved yet — kept here, and saved when you end the call.')).toBeTruthy();
  });

  it('are not there for a colleague\'s call I am not on', async () => {
    voice = answered({ answered_by: 7, answered_by_name: 'Nimal Silva', on_call: false, on: [{ user_id: 7, name: 'Nimal Silva' }] });
    mount();
    await screen.findByRole('button', { name: 'Join call' });
    expect(screen.queryByRole('region', { name: 'Call notes' })).toBeNull();
  });
});

describe('the call in the transcript (VOICE-12)', () => {
  it('"Voice call started by the visitor · you answered after 0:12", as a green pill; a missed one red', async () => {
    messages = [
      ...messages,
      { id: 2, body: 'Voice call started · Samali Perera answered after 0:12', from: 'system', agent: 'Samali Perera', agent_id: 3, at: ago(50_000), file: null },
      { id: 3, body: 'Missed voice call', from: 'system', agent: null, agent_id: null, at: ago(40_000), file: null },
    ];
    mount();
    const started = await screen.findByText(/Voice call started by the visitor · you answered after 0:12/);
    expect(started.closest('[data-tone]')?.getAttribute('data-tone')).toBe('call');
    expect(screen.getByText(/^Missed voice call/).closest('[data-tone]')?.getAttribute('data-tone')).toBe('missed');
  });

  it('names a colleague who answered, and leaves other notices alone', () => {
    expect(callNotice('Voice call started · Nimal Silva answered after 1:05', 7, 3)).toEqual({ body: 'Voice call started by the visitor · Nimal Silva answered after 1:05', tone: 'call' });
    expect(callNotice('Voice call ended · 2:14', 3, 3)).toEqual({ body: 'Voice call ended · 2:14', tone: 'call' });
    expect(callNotice('Voice call dropped · 0:40', null, 3)?.tone).toBe('missed');
    expect(callNotice('Nimal joined the chat', 7, 3)).toBeNull();
    expect(callNotice(null, 7, 3)).toBeNull();
  });
});

describe('invited or transferred during the call (WF-V3, AC-V07)', () => {
  it('Join chat on the card opens the chat on the call, and I join its audio as a participant who takes calls', async () => {
    voice = answered({ answered_by: 7, answered_by_name: 'Nimal Silva', on_call: false, on: [{ user_id: 7, name: 'Nimal Silva' }] });
    team = owner({ my_role: 'participant', can: { invite: false, transfer: false, leave: true, remove: false, note: true, monitor: false, join: false, take_over: false } });
    tab.query = `view=website&website=41&call=${cid}`;
    mount();
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/api/chat/widget-admin/calls/${cid}/join`, {}));
    await waitFor(() => expect(lk.FakeRoom.made).toHaveLength(1));
  });

  it('the card says a call is on, and that joining joins it', () => {
    const base = { kind: 'invite' as const, mode: 'warm' as const, from: 'Samali Perera', toAny: false, department: null };
    expect(handoffDetail({ ...base, onCall: true })).toBe('On a voice call now — you join the call too');
    expect(handoffDetail({ ...base, kind: 'transfer', onCall: true })).toBe('On a voice call now — you join the call too · Warm transfer — Samali stays until you join');
    expect(handoffDetail(base)).toBeNull();
  });
});

describe('devices, the mute key and the title bar (VOICE-14)', () => {
  it('Audio devices switches the microphone now and keeps it for the next call', async () => {
    lk.FakeRoom.devices = {
      audioinput: [{ deviceId: 'default', label: 'Default', kind: 'audioinput' }, { deviceId: 'headset', label: 'Jabra Evolve2', kind: 'audioinput' }],
      audiooutput: [{ deviceId: 'speakers', label: 'MacBook Speakers', kind: 'audiooutput' }],
    };
    const { room } = await onIt();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Audio devices' }));
    const menu = await screen.findByRole('menu', { name: 'Audio devices' });
    expect(within(menu).getByRole('menuitemradio', { name: /MacBook Speakers/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Jabra Evolve2/ }));
    await waitFor(() => expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'headset'));
    expect(JSON.parse(localStorage.getItem('ws.meet.devices') ?? '{}').micId).toBe('headset');

    // The next call opens that microphone.
    websiteCall.over(cid);
    cid += 1;
    voice = answered();
    cleanup();
    lk.FakeRoom.made = [];
    await onIt();
    await waitFor(() => expect(lk.FakeRoom.made[0]!.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true, { deviceId: 'headset' }));
  });

  it('the system\'s microphone key toggles Mute while the call is on', async () => {
    const handlers: Record<string, (() => void) | null> = {};
    const setMicrophoneActive = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: { setActionHandler: (a: string, fn: (() => void) | null) => (handlers[a] = fn), setMicrophoneActive } });
    const { room } = await onIt();
    expect(handlers.togglemicrophone).toBeTypeOf('function');
    act(() => handlers.togglemicrophone!());
    await screen.findByRole('button', { name: 'Unmute' });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(setMicrophoneActive).toHaveBeenLastCalledWith(false);
    websiteCall.over(cid);
    expect(handlers.togglemicrophone).toBeNull();
  });

  it('the title bar shows the call with its time; a click opens its chat', async () => {
    await onIt();
    mount(<ActiveCalls />);
    const pill = await screen.findByRole('button', { name: /^On a call: Kamal Perera, \d+:\d{2}\. Back to it$/ });
    fireEvent.click(pill);
    expect(navigate).toHaveBeenCalledWith('/chat?view=website&website=41');
  });
});
