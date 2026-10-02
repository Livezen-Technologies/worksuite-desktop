// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Meet Home (worksuite-desktop#67) and the pre-join screen (#69): the rules first, then the screens.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: nav, go: nav, query: new URLSearchParams(), path: ['meet'] }), useTabTitle: () => undefined }));
vi.mock('livekit-client', () => ({
  Room: { getLocalDevices: vi.fn(async (kind: string) => (kind === 'audioinput' ? [{ deviceId: 'mic-2', label: 'USB microphone', kind }] : [])) },
  // No camera or microphone in a test: they never start.
  createLocalVideoTrack: vi.fn(() => new Promise(() => undefined)),
  createLocalAudioTrack: vi.fn(() => new Promise(() => undefined)),
  Track: {},
}));
const nav = vi.fn();

const { ApiError, apiGet, apiPost } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { byDay, checkMeetingInput, historyJoinable, lengthLabel, meetingMinutes, upcomingJoinable } = await import('../../../src/modules/meet/home');
const { MeetHome } = await import('../../../src/modules/meet/MeetHome');
const { meet } = await import('../../../src/modules/meet/session');
const { MeetLobby } = await import('../../../src/modules/meet/MeetLobby');
const { present, readPrefs, troubleOf } = await import('../../../src/modules/meet/devices');

const at = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000).toISOString().replace('T', ' ').slice(0, 19);
const UUID = 'b5d1c8e2-4f7a-4c1e-9a3b-2e6f8d0c1a77';

beforeEach(() => {
  localStorage.clear();
  nav.mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(apiGet).mockReset();
  app.set({ auth: { user: { id: 1, name: 'Hasarinda Manjula' }, server: { origin: 'https://app.worksuite.lk' } }, bootstrap: { permissions: ['*'] }, apps: [{ id: 'meetings' }, { id: 'chat' }, { id: 'meet' }] } as never);
});
afterEach(cleanup);

describe('the rules', () => {
  it('reads a code or a link, and says what is wrong with anything else', () => {
    expect(checkMeetingInput(`https://meet.worksuite.lk/meet/${UUID}`)).toEqual({ uuid: UUID });
    expect(checkMeetingInput(`worksuite://meet/${UUID}?x=1`)).toEqual({ uuid: UUID });
    expect(checkMeetingInput('482 119 330')).toEqual({ code: '482119330' });
    expect(checkMeetingInput('482-119-330')).toEqual({ code: '482119330' });
    expect(checkMeetingInput(UUID)).toEqual({ uuid: UUID });
    expect(checkMeetingInput('abc-defg-hij')).toEqual({ code: 'abc-defg-hij' });
    expect(checkMeetingInput('https://zoom.us/j/123')).toEqual({ error: 'err.notMeetLink' });
    expect(checkMeetingInput('1234')).toEqual({ error: 'err.badCode' });
    expect(checkMeetingInput('hello there!')).toEqual({ error: 'err.badChars' });
    expect(checkMeetingInput('   ')).toBeNull();
  });

  it('offers Join from 15 minutes before a meeting until its end, and whenever it is live', () => {
    const now = Date.now();
    expect(upcomingJoinable({ scheduled_at: at(10), ends_at: at(40) }, now, false)).toBe(true);
    expect(upcomingJoinable({ scheduled_at: at(60), ends_at: at(90) }, now, false)).toBe(false);
    expect(upcomingJoinable({ scheduled_at: at(60), ends_at: at(90) }, now, true)).toBe(true);
    expect(upcomingJoinable({ scheduled_at: at(-30), ends_at: at(-5) }, now, false)).toBe(false);
    expect(upcomingJoinable({ scheduled_at: at(-30), ends_at: null }, now, false)).toBe(true);
    expect(historyJoinable({ status: 'live' })).toBe(true);
    expect(historyJoinable({ status: 'ended' })).toBe(false);
  });

  it('shows a length only when it is believable, in hours and minutes', () => {
    expect(meetingMinutes(at(-45), at(0))).toBe(45);
    // Left running until somebody ended it days later: not "2880 min".
    expect(meetingMinutes(at(-2 * 24 * 60), at(0))).toBeNull();
    expect(meetingMinutes(at(-0.2), at(0))).toBeNull();
    expect(meetingMinutes(null, at(0))).toBeNull();
    expect(lengthLabel(45)).toBe('45 min');
    expect(lengthLabel(80)).toBe('1 h 20 min');
    expect(lengthLabel(120)).toBe('2 h');
    expect(lengthLabel(null)).toBeNull();
  });

  it('groups upcoming meetings by day, in order', () => {
    // A morning clock, so +30 and +90 minutes fall on the same day whatever time the suite runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 9, 0, 0));
    try {
      const g = byDay([{ scheduled_at: at(60 * 26) }, { scheduled_at: at(30) }, { scheduled_at: at(90) }]);
      expect(g.map((x) => x.rows.length)).toEqual([2, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remembers devices, and falls back to the default for one that has gone', () => {
    expect(readPrefs()).toEqual({ micId: '', camId: '', speakerId: '', mic: true, cam: true });
    localStorage.setItem('ws.meet.devices', JSON.stringify({ micId: 'mic-9', mic: false }));
    expect(readPrefs()).toMatchObject({ micId: 'mic-9', mic: false, cam: true });
    expect(present('mic-9', [{ deviceId: 'mic-2' } as MediaDeviceInfo])).toBe('');
    expect(present('mic-2', [{ deviceId: 'mic-2' } as MediaDeviceInfo])).toBe('mic-2');
    expect(troubleOf(Object.assign(new Error('x'), { name: 'NotAllowedError' }), 'camera')).toEqual({ kind: 'blocked', what: 'camera' });
    expect(troubleOf(Object.assign(new Error('x'), { name: 'NotReadableError' }), 'microphone')).toEqual({ kind: 'busy', what: 'microphone' });
  });
});

function serve(data: { upcoming?: unknown[]; history?: unknown[]; recordings?: unknown[] }) {
  vi.mocked(apiGet).mockImplementation((async (path: string, q?: Record<string, string>) => {
    if (path === '/api/meet/upcoming') return { meetings: data.upcoming ?? [] };
    if (path === '/api/meet/history') return { meetings: data.history ?? [] };
    if (path === '/api/meet/recordings') return { recordings: data.recordings ?? [] };
    if (path === '/api/meet/resolve') {
      if (q?.code === '482119330') return { uuid: UUID, title: 'Design review', ended: false };
      throw new ApiError(404, 'Not found', null);
    }
    return {};
  }) as never);
}
const home = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeetHome /></QueryClientProvider>);
const hist = (o: Record<string, unknown>) => ({ uuid: UUID, title: 'Weekly team sync', type: 'instant', code: '482119330', started_at: at(-24 * 60), ended_at: at(-24 * 60 + 30), scheduled_at: null, created_at: at(-24 * 60), status: 'ended', in_call: null, is_host: true, host_name: 'Me', people: ['A', 'B', 'C', 'D'], room_id: 12, join_url: `https://meet.worksuite.lk/meet/${UUID}`, recording: false, recording_ready: false, ...o });

describe('Meet Home', () => {
  it('New meeting offers Start now, a link for later and Schedule in Calendar, and closes with Escape', async () => {
    serve({});
    home();
    fireEvent.click(screen.getByRole('button', { name: /New meeting/ }));
    const menu = screen.getByRole('menu', { name: 'New meeting' });
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual([
      'Start nowStart a meeting and invite others.',
      'Create link for laterGet a meeting link to share.',
      'Schedule in CalendarChoose a time and invite participants.',
    ]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('New meeting: one highlight that follows the pointer and the arrow keys, and one meeting per choice (worksuite-desktop#90)', async () => {
    serve({});
    home();
    fireEvent.click(screen.getByRole('button', { name: /New meeting/ }));
    const items = [...screen.getByRole('menu', { name: 'New meeting' }).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    // Each is an icon beside a title, with the description under it.
    expect(items[0]!.querySelectorAll('svg')).toHaveLength(1);
    expect(items[0]!.lastElementChild!.children).toHaveLength(2);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.mouseEnter(items[2]!);
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[1]);
    // Chosen twice before the menu is gone: one link is made.
    fireEvent.click(items[1]!);
    fireEvent.click(items[1]!);
    await waitFor(() => expect(vi.mocked(apiPost).mock.calls.filter(([p]) => p === '/api/meet/create')).toHaveLength(1));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('says what is wrong with a code or link, inline, and joins a good one', async () => {
    serve({});
    home();
    const box = screen.getByRole('textbox', { name: 'Meeting code or link' });
    fireEvent.change(box, { target: { value: 'https://zoom.us/j/1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a WorkSuite Meet link/);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(box, { target: { value: '111 222 333' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/No meeting has that ID/);
    fireEvent.change(box, { target: { value: '482 119 330' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('windows:open', expect.objectContaining({ kind: 'meet', route: `/meet/${UUID}` })));
  });

  it('shows upcoming meetings by day, with Join only when the meeting can be joined', async () => {
    serve({
      upcoming: [
        { uuid: UUID, title: 'Design review', scheduled_at: at(10), ends_at: at(40), is_host: false, host_name: 'Samali', people: 5, record_id: 3 },
        { uuid: 'c5d1c8e2-4f7a-4c1e-9a3b-2e6f8d0c1a78', title: 'Project planning', scheduled_at: at(180), ends_at: at(225), is_host: true, host_name: 'Me', people: 3, record_id: 4 },
      ],
    });
    home();
    const card = await screen.findByRole('region', { name: 'Upcoming meetings' });
    await within(card).findByText('Design review');
    const first = within(card).getByText('Design review').closest('div')!;
    expect(within(first).getByText(/30 min · Hosted by Samali/)).toBeTruthy();
    expect(within(first).getByRole('button', { name: 'Join' })).toBeTruthy();
    const second = within(card).getByText('Project planning').closest('div')!;
    expect(within(second).queryByRole('button', { name: 'Join' })).toBeNull();
    fireEvent.click(within(second).getByRole('button', { name: 'Open details' }));
    expect(nav).toHaveBeenCalledWith('/meetings?meeting=4');
  });

  it('empty sections say so, with something to do', async () => {
    serve({});
    home();
    expect(await screen.findByText('Nothing scheduled')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schedule a meeting' })).toBeTruthy();
    expect(await screen.findByText('No meetings yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a meeting' })).toBeTruthy();
    expect(await screen.findByText('No recordings')).toBeTruthy();
  });

  it('a past meeting has one action and a ⋯ menu for the rest; an unbelievable length is not shown', async () => {
    serve({ history: [hist({}), hist({ uuid: 'd5d1c8e2-4f7a-4c1e-9a3b-2e6f8d0c1a79', title: 'Client catch-up', started_at: at(-5 * 24 * 60), ended_at: at(0), status: 'ended' }), hist({ uuid: 'e5d1c8e2-4f7a-4c1e-9a3b-2e6f8d0c1a70', title: 'Standup', status: 'live', ended_at: null, started_at: at(-5) })] });
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
    home();
    const card = await screen.findByRole('region', { name: 'Recent meetings' });
    await within(card).findByText('Weekly team sync');
    expect(within(card).getByText(/Yesterday · 30 min · 4 people/)).toBeTruthy();
    expect(within(card).getByText('Client catch-up').parentElement!.textContent).not.toMatch(/min/);
    const standup = within(card).getByText('Standup').closest('div')!;
    expect(within(standup).getByRole('button', { name: 'Join' })).toBeTruthy();
    const weekly = within(card).getByText('Weekly team sync').closest('div')!;
    expect(within(weekly).queryByRole('button', { name: 'Join' })).toBeNull();
    fireEvent.click(within(weekly).getByRole('button', { name: 'Open chat' }));
    expect(nav).toHaveBeenCalledWith('/chat?room=12');
    fireEvent.click(within(weekly).getByRole('button', { name: 'More for Weekly team sync' }));
    const menu = screen.getByRole('menu', { name: 'More for Weekly team sync' });
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Copy link', 'Copy meeting ID']);
    fireEvent.click(within(menu).getByText('Copy link'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`https://meet.worksuite.lk/meet/${UUID}`);
  });

  it('recordings are compact, with See all and a ⋯ menu', async () => {
    serve({ recordings: [1, 2, 3, 4].map((id) => ({ id, title: `Recording ${id}`, created_at: at(-60 * id), ready: id !== 2, size: 1_000_000 })) });
    home();
    const card = await screen.findByRole('region', { name: 'Recordings' });
    await within(card).findByText('Recording 1');
    expect(within(card).queryByText('Recording 4')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /See all/ }));
    expect(within(card).getByText('Recording 4')).toBeTruthy();
    expect(within(card).getByText('Processing')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'More for Recording 1' }));
    const menu = screen.getByRole('menu', { name: 'More for Recording 1' });
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Download', 'Rename', 'Delete']);
  });

  it('says how each recording stands: its upload in the queue, a stuck one, a download apart from Ready to play (#89)', async () => {
    const t0 = new Date().toISOString();
    vi.mocked(call).mockImplementation((async (channel: string) => {
      if (channel === 'meetrec:list') {
        return [{ id: 'r1', meeting: UUID, title: 'Here', state: 'uploading', error: null, failedAt: null, bytes: 200, uploaded: 0, startedAt: t0, endedAt: t0, durationMs: 1000, fileName: 'Here.webm', driveFileId: null, deleteAfter: null, recovered: false, stepAt: t0, transferId: 'up1' }];
      }
      if (channel === 'meetrec:downloads') return { '1': 'dl1' };
      return null;
    }) as never);
    const xfer = { source: '', destination: '', speed: 0, error: null, createdAt: t0, movedAt: t0 };
    app.set({ transfers: [{ ...xfer, id: 'up1', direction: 'upload', name: 'Here.webm', bytes: 100, total: 200, state: 'running' }, { ...xfer, id: 'dl1', direction: 'download', name: 'Board.mp4', bytes: 9, total: 9, state: 'done' }] } as never);
    serve({
      recordings: [
        { id: 1, title: 'Board', created_at: at(-60), ready: true, size: 9, status: 'ready', method: 'cloud', drive_file_id: 41, playable: true },
        { id: 2, title: 'Stuck one', created_at: at(-120), ready: false, size: null, status: 'processing', method: 'cloud', stalled: true, guidance: 'Ask your administrator to check the recording service.' },
      ],
    });
    home();
    const card = await screen.findByRole('region', { name: 'Recordings' });
    // Recorded here: uploading, measured, with the queue's own Pause and Cancel transfer.
    await within(card).findByText('Uploading to Drive');
    expect(within(card).getByRole('progressbar', { name: 'Uploading to Drive' }).getAttribute('aria-valuenow')).toBe('50');
    fireEvent.click(within(card).getByRole('button', { name: 'Pause' }));
    expect(call).toHaveBeenCalledWith('transfers:pause', { id: 'up1' });
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel transfer' }));
    expect(call).toHaveBeenCalledWith('transfers:cancel', { id: 'up1' });
    // Ready to play, in Drive, and separately downloaded here, with Open and Show in folder.
    await within(card).findByText('Board');
    expect(within(card).getByText('Ready to play')).toBeTruthy();
    expect(within(card).getByText('Saved to Drive')).toBeTruthy();
    expect(within(card).getByText('Downloaded')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Show in folder' }));
    expect(call).toHaveBeenCalledWith('transfers:reveal', { id: 'dl1' });
    fireEvent.click(within(card).getByRole('button', { name: 'Play Board' }));
    expect(nav).toHaveBeenCalledWith('/files?file=41&play=1');
    // A stuck one says what to do instead of moving for ever.
    expect(within(card).getByRole('alert').textContent).toBe('Ask your administrator to check the recording service.');
    expect((within(card).getByRole('button', { name: 'Play Stuck one' }) as HTMLButtonElement).disabled).toBe(true);
    app.set({ transfers: [] } as never);
  });

  it('checks the camera and microphone from here', async () => {
    serve({});
    home();
    fireEvent.click(screen.getByRole('button', { name: 'Check camera and microphone' }));
    const settings = await screen.findByRole('region', { name: 'Device settings' });
    const { Room } = await import('livekit-client');
    await waitFor(() => expect(Room.getLocalDevices).toHaveBeenCalledWith('audioinput'));
    fireEvent.click(within(settings).getByRole('combobox', { name: 'Microphone' }));
    expect(await screen.findByRole('option', { name: 'USB microphone' })).toBeTruthy();
  });
});

describe('the pre-join screen', () => {
  const info = { uuid: UUID, title: 'Instant meeting', host_name: 'Hasarinda Manjula', scheduled_at: null, started_at: null, mode: 'video' as 'audio' | 'video', room_id: null, joined_count: 0, ended: false, has_passcode: false, needs_passcode: false, is_host: true, join_url: '' };

  function lobby(over: Partial<typeof info> = {}, phase: 'lobby' | 'joining' | 'waiting' = 'lobby', error: string | null = null) {
    Object.assign(meet, { info: { ...info, ...over }, phase, error });
    return render(<MeetLobby />);
  }

  it('shows the meeting: title, organizer, host, and who is in it', () => {
    lobby();
    expect(screen.getByRole('heading', { name: 'Ready to join?' })).toBeTruthy();
    expect(screen.getByText('Instant meeting')).toBeTruthy();
    expect(screen.getByText('Organized by Hasarinda Manjula')).toBeTruthy();
    expect(screen.getByText('You’re the host')).toBeTruthy();
    expect(screen.getByText('You’ll be the first to join')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /Your name/ }) as HTMLInputElement).value).toBe('Hasarinda Manjula');
    cleanup();
    lobby({ is_host: false, joined_count: 3 });
    expect(screen.getByText('3 people are in the meeting')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ask to join/ })).toBeTruthy();
  });

  it('switches the microphone and camera with icon buttons that say their state, remembered for next time', () => {
    lobby();
    const mic = screen.getByRole('button', { name: 'Turn off microphone' });
    expect(mic.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(mic);
    expect(screen.getByRole('button', { name: 'Turn on microphone' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off camera' }));
    // The camera off: the person's avatar in its place.
    expect(screen.getByText('Camera is off')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('ws.meet.devices')!)).toMatchObject({ mic: false, cam: false });
  });

  it('joins once with what was chosen, and shows it is joining', async () => {
    localStorage.setItem('ws.meet.devices', JSON.stringify({ mic: false, cam: true, micId: 'mic-2' }));
    let done!: () => void;
    const join = vi.spyOn(meet, 'join').mockImplementation(() => new Promise<void>((r) => (done = r)));
    lobby();
    const btn = screen.getByRole('button', { name: /Join now/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(join).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith(expect.objectContaining({ mic: false, cam: true, micId: 'mic-2' }));
    expect(screen.getByRole('button', { name: /Joining…/ }).getAttribute('aria-busy')).toBe('true');
    await act(async () => done());
    join.mockRestore();
  });

  it('a connection problem says so, with Try again', () => {
    const join = vi.spyOn(meet, 'join').mockResolvedValue();
    lobby({}, 'lobby', 'Could not connect to the meeting: timeout');
    expect(screen.getByRole('alert').textContent).toMatch(/Could not connect to the meeting/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(join).toHaveBeenCalledTimes(1);
    join.mockRestore();
  });

  it('while waiting to be let in, says so, with Cancel', () => {
    lobby({ is_host: false }, 'waiting');
    expect(screen.getByRole('heading', { name: 'Asking to join…' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Waiting for the host/);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('an audio meeting starts with the camera off', () => {
    lobby({ mode: 'audio' });
    expect(screen.getByRole('button', { name: 'Turn on camera' })).toBeTruthy();
  });
});

describe('a menu opened from a button (worksuite-desktop#90)', () => {
  it('opens above the button when there is no room below, and never wider than the window', async () => {
    const { PopMenu, below } = await import('../../../src/modules/files/Menu');
    const button = document.createElement('button');
    button.getBoundingClientRect = () => ({ top: 700, bottom: 744, left: 40, right: 200, width: 160, height: 44, x: 40, y: 700, toJSON: () => ({}) }) as DOMRect;
    const at = below(button, 'left', 320);
    expect(at).toEqual({ x: 40, y: 748, above: 696 });
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return this.getAttribute('role') === 'menu' ? ({ top: 0, left: 0, width: 320, height: 200, right: 320, bottom: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect) : rect.call(this);
    };
    try {
      window.innerHeight = 800;
      render(<PopMenu at={at} stacked width={320} label="Choices" items={[{ label: 'One', hint: 'The first', icon: 'video', run: () => undefined }]} onClose={() => undefined} />);
      const menu = screen.getByRole('menu', { name: 'Choices' });
      expect(menu.style.top).toBe('496px');
      expect(menu.style.width.replace(/[\s*]+/g, '')).toBe('min(320px,calc(100vw-16px))');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
    }
  });
});
