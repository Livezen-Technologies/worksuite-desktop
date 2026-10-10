import { describe, expect, it, vi } from 'vitest';
import { MeetNext, meetingLabel, nextMeeting, type UpcomingMeeting } from '../../../electron/services/meet-next';
import { trayMeetItems } from '../../../electron/tray/tray';
import type { TrayActions, TrayModel } from '../../../electron/tray/tray';

/**
 * Meet in the tray (WS-MEET-ENH-01 D04).
 *
 * The two things worth pinning: "next" means the same thing here as on the
 * Meet home, or the tray and the page disagree about which meeting you are
 * about to join; and a line is absent rather than disabled when there is
 * nothing behind it — a Mute line with no call is worse than no line.
 */

const AT = Date.parse('2026-10-10T10:00:00Z');
const row = (over: Partial<UpcomingMeeting> = {}): UpcomingMeeting => ({ uuid: 'aaaaaaaa-1111-2222-3333-444444444444', title: 'Weekly design review', scheduled_at: '2026-10-10T10:00:00Z', ends_at: '2026-10-10T10:45:00Z', ...over });

describe('which meeting is next', () => {
  it('is the one that has already started', () => {
    expect(nextMeeting([row()], AT + 5 * 60_000)?.title).toBe('Weekly design review');
  });

  it('counts a meeting from a quarter of an hour before it starts, as the Meet home does', () => {
    expect(nextMeeting([row()], AT - 14 * 60_000)).not.toBeNull();
    expect(nextMeeting([row()], AT - 16 * 60_000)).toBeNull();
  });

  it('stops offering one that has ended', () => {
    expect(nextMeeting([row()], AT + 46 * 60_000)).toBeNull();
  });

  it('gives an hour to a meeting with no end', () => {
    expect(nextMeeting([row({ ends_at: null })], AT + 59 * 60_000)).not.toBeNull();
    expect(nextMeeting([row({ ends_at: null })], AT + 61 * 60_000)).toBeNull();
  });

  it('takes the soonest when several are joinable', () => {
    const later = row({ uuid: 'bbbbbbbb-1111-2222-3333-444444444444', title: 'Later', scheduled_at: '2026-10-10T10:10:00Z', ends_at: '2026-10-10T11:00:00Z' });

    expect(nextMeeting([later, row()], AT)?.title).toBe('Weekly design review');
  });

  it('reads the date format the server actually sends', () => {
    // `2026-10-10 10:00:00` as well as ISO. A date that does not parse is no
    // date at all — not 1970, which would make it the most urgent meeting there is.
    expect(nextMeeting([row({ scheduled_at: '2026-10-10 10:00:00', ends_at: '2026-10-10 10:45:00' })], AT + 60_000)).not.toBeNull();
    expect(nextMeeting([row({ scheduled_at: 'soon' })], AT)).toBeNull();
    expect(nextMeeting([row({ scheduled_at: null })], AT)).toBeNull();
  });

  it('ignores a row with no meeting behind it', () => {
    expect(nextMeeting([row({ uuid: '' })], AT)).toBeNull();
    expect(nextMeeting(null, AT)).toBeNull();
    expect(nextMeeting(undefined, AT)).toBeNull();
  });

  it('names a meeting that has no title', () => {
    expect(meetingLabel(row({ title: null }))).toBe('A meeting');
    expect(meetingLabel(row({ title: '   ' }))).toBe('A meeting');
    expect(meetingLabel(null)).toBe('A meeting');
  });
});

describe('what the tray is told', () => {
  function harness(opts: { allowed?: boolean; inCall?: boolean; answer?: unknown; fail?: unknown } = {}) {
    const told: Array<unknown> = [];
    let allowed = opts.allowed ?? true;
    let inCall = opts.inCall ?? false;
    const next = new MeetNext({
      get: async () => {
        if (opts.fail) throw opts.fail;

        return (opts.answer ?? { meetings: [row()] }) as never;
      },
      allowed: () => allowed,
      inCall: () => inCall,
      onChange: (t) => void told.push(t),
      now: () => AT,
      every: 10_000,
    });

    return { next, told, set: (o: { allowed?: boolean; inCall?: boolean }) => { allowed = o.allowed ?? allowed; inCall = o.inCall ?? inCall; } };
  }

  it('offers the next meeting once it knows of one', async () => {
    const h = harness();

    await h.next.refresh();
    expect(h.told.at(-1)).toEqual({ next: { uuid: row().uuid, title: 'Weekly design review' }, inCall: false });
  });

  it('says nothing at all when there is nothing to join and no call', async () => {
    const h = harness({ answer: { meetings: [] } });

    await h.next.refresh();
    // Not "told null": the tray starts with no Meet lines, so there is nothing
    // to tell it. A listener call here would rebuild the menu for no change.
    expect(h.told).toEqual([]);
  });

  it('still shows a section while a call is on, with nothing to join', async () => {
    const h = harness({ answer: { meetings: [] }, inCall: true });

    await h.next.refresh();
    expect(h.told.at(-1)).toEqual({ next: null, inCall: true });
  });

  it('tells the tray only when something changed', async () => {
    const h = harness();

    await h.next.refresh();
    await h.next.refresh();
    expect(h.told).toHaveLength(1);
  });

  it('shows nothing for somebody who may not open Meet, and does not ask', async () => {
    const h = harness({ allowed: false });

    await h.next.refresh();
    expect(h.told.at(-1) ?? null).toBeNull();
  });

  it('goes quiet when the server has no such endpoint', async () => {
    const h = harness({ fail: { status: 404 } });

    await h.next.refresh();
    expect(h.told.at(-1) ?? null).toBeNull();
  });

  it('keeps the last answer when the request simply failed', async () => {
    const told: unknown[] = [];
    let fail: unknown = null;
    const next = new MeetNext({
      get: async () => {
        if (fail) throw fail;

        return { meetings: [row()] } as never;
      },
      allowed: () => true,
      inCall: () => false,
      onChange: (t) => void told.push(t),
      now: () => AT,
    });

    await next.refresh();
    fail = new Error('offline');
    await next.refresh();
    // A meeting that was in ten minutes still is.
    expect(told.at(-1)).toEqual({ next: { uuid: row().uuid, title: 'Weekly design review' }, inCall: false });
  });

  it('forgets everything when it stops', async () => {
    const h = harness();

    await h.next.refresh();
    h.next.stop();
    expect(h.told.at(-1)).toBeNull();
  });

  it('asks again on a timer', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();

      h.next.start();
      // Async: the first ask is a promise, so the timers have to be advanced
      // in a way that lets it settle.
      await vi.advanceTimersByTimeAsync(25_000);
      expect(h.told.length).toBeGreaterThan(0);
      h.next.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the tray lines', () => {
  const model = (over: Partial<TrayModel> = {}): Pick<TrayModel, 'signedIn' | 'apps' | 'meet'> =>
    ({ signedIn: true, apps: ['meet'], meet: { next: { uuid: 'u', title: 'Weekly design review' }, inCall: false }, ...over }) as never;
  const actions = (): Pick<TrayActions, 'openRoute' | 'meetJoinNext' | 'meetStart' | 'meetShare' | 'meetMute' | 'meetCamera'> => ({
    openRoute: () => undefined,
    meetJoinNext: () => undefined,
    meetStart: () => undefined,
    meetShare: () => undefined,
    meetMute: () => undefined,
    meetCamera: () => undefined,
  });
  const labels = (items: ReturnType<typeof trayMeetItems>): string[] => items.map((i) => (typeof i.label === 'string' ? i.label : '—'));

  it('names the meeting it would join', () => {
    expect(labels(trayMeetItems(model(), actions()))).toContain('Join next: Weekly design review');
  });

  it('offers mute and the camera only while this computer is in a meeting', () => {
    expect(labels(trayMeetItems(model(), actions()))).not.toContain('Mute microphone');
    expect(labels(trayMeetItems(model({ meet: { next: null, inCall: true } } as never), actions()))).toContain('Mute microphone');
  });

  it('shows each key beside its line without registering it', () => {
    const items = trayMeetItems(model(), actions(), { 'meet-join-next': 'CommandOrControl+Shift+J' });
    const join = items.find((i) => i.label === 'Join next: Weekly design review');

    expect(join?.accelerator).toBe('CommandOrControl+Shift+J');
    // The main process holds the key; a menu that registered it too would take
    // it even while the menu is closed.
    expect(join?.registerAccelerator).toBe(false);
  });

  it('has nothing to say to somebody signed out, or without Meet, or before the first answer', () => {
    expect(trayMeetItems(model({ signedIn: false } as never), actions())).toEqual([]);
    expect(trayMeetItems(model({ apps: [] } as never), actions())).toEqual([]);
    expect(trayMeetItems(model({ meet: null } as never), actions())).toEqual([]);
  });

  it('does not repeat Do not disturb, which the menu already has', () => {
    // Two switches for one setting is how they come to disagree.
    expect(labels(trayMeetItems(model({ meet: { next: null, inCall: true } } as never), actions())).join(' ')).not.toMatch(/disturb/i);
  });

  it('ends with Meet settings and a separator, so it reads as one section', () => {
    const items = trayMeetItems(model(), actions());

    expect(items.at(-2)?.label).toBe('Meet settings…');
    expect(items.at(-1)?.type).toBe('separator');
  });
});
