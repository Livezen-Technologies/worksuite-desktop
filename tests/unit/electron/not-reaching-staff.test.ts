import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; closed: boolean }>);
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
  BrowserWindow: class {},
  screen: {},
  nativeImage: { createFromPath: () => ({}) },
  Notification: class {
    static isSupported = () => true;
    entry: (typeof notes)[number];
    constructor(options: Record<string, unknown>) {
      this.entry = { options, closed: false };
      notes.push(this.entry);
    }
    on() {
      return this;
    }
    show() {}
    close() {
      this.entry.closed = true;
    }
  },
}));

import { NotificationService, notReachingNotice } from '../../../electron/services/notifications';
import { announceEvent, WebchatRinger, type PendingAnswer, type RingingEntry } from '../../../electron/services/webchat-ring';
import type { Preferences, WebchatRingChat, WebchatRingPrefs } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';

/**
 * Website chat on the Desktop when the team is not being reached (WS-WCHAT Phase 3):
 *
 *  - NOT REACHING STAFF (DLV-09, AC-D09). The server re-publishes a visitor message no device of the team acknowledged
 *    for a minute; whoever holds the chat gets a native notification for it, once, which goes when a device has it.
 *  - BUILT-IN MODE (TRN-34). With no realtime connection the ring service reads the list every 10 s, and a chat found
 *    there raises the system notification exactly as its realtime event would — the first one too, which the card the
 *    same read showed used to swallow — and again when the chat rings again later.
 */

function service(me = '5') {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false, language: 'en' } as unknown as Preferences;
  const http = { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) };
  const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
  const s = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
  (s as unknown as { userId: string }).userId = me;
  return s;
}

const republished = (over: Record<string, unknown> = {}) => ({
  type: 'chat.widget.message', event_id: 'e1', conversation_id: 41, visitor: 'Nimali Perera', preview: 'Business, for 12 people', message_id: 900, seq: 7,
  assigned_to: 5, participants: [5], site: 'worksuite.lk', not_reaching_staff: true, republished: true, ...over,
});

beforeEach(() => {
  notes.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a visitor message not reaching staff (DLV-09, AC-D09)', () => {
  it('is a native notification for whoever holds the chat, once per message', () => {
    const s = service();
    s.handleRealtime(republished());
    s.handleRealtime(republished({ event_id: 'e2' }));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({ title: "Nimali Perera's message is not reaching you", urgency: 'critical' });
    expect(String(notes[0]!.options.body)).toContain('Business, for 12 people');
  });

  it('says nothing to somebody who does not hold the chat, or who is looking at it', () => {
    service('9').handleRealtime(republished());
    expect(notes).toHaveLength(0);
    const s = service();
    s.websiteAttending = () => true;
    s.handleRealtime(republished());
    expect(notes).toHaveLength(0);
  });

  it('goes when a device has the message', () => {
    const s = service();
    s.handleRealtime(republished());
    s.handleRealtime({ type: 'chat.widget.reaching', conversation_id: 41 });
    expect(notes[0]!.closed).toBe(true);
  });

  it('reads whose chat it is from the event', () => {
    expect(notReachingNotice(republished({ assigned_to: null, participants: [{ user_id: 5 }] }), 5)?.website).toEqual({ conversationId: 41, visitor: 'Nimali Perera' });
    expect(notReachingNotice(republished({ assigned_to: 7, participants: [7] }), 5)).toBeNull();
    expect(notReachingNotice(republished({ conversation_id: 0 }), 5)).toBeNull();
  });
});

describe('built-in mode: the background read raises the system notification (TRN-34)', () => {
  const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
  const entry = (over: Partial<RingingEntry> = {}): RingingEntry => ({ id: 3, conversation_id: 3, visitor: 'Visitor 4F2A', site: 'worksuite.lk', kind: 'waiting', mine: false, since: stamp(5000), silenced: false, ...over });
  const prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };

  function wired(answer: () => PendingAnswer) {
    const notify = service();
    const r: WebchatRinger = new WebchatRinger({
      http: { get: vi.fn(async () => answer()), post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) } as unknown as HttpClient,
      signedIn: () => true,
      locked: () => false,
      me: () => 5,
      prefs: () => prefs,
      quiet: () => false,
      open: () => undefined,
      onChanged: () => undefined,
      deviceId: () => 'desktop-12',
      focused: () => false,
      realtimeUp: () => false,
      // As the main process wires them: the card is "the alert" while it shows a chat (RING-40).
      announce: (c) => notify.handleRealtime(announceEvent(c)),
    });
    notify.ringerShowing = () => prefs.window && r.state().chats.length > 0;
    return r;
  }

  it('shows the first chat found while no realtime connection is up, though the card shows it too', async () => {
    const r = wired(() => ({ ringing: [entry()] }));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options.title).toBe('Website chat · worksuite.lk');
    r.stop();
  });

  it('shows a chat again when it rings again later', async () => {
    let answer: PendingAnswer = { ringing: [entry()] };
    const r = wired(() => answer);
    r.start();
    await vi.waitFor(() => expect(notes).toHaveLength(1));
    answer = { ringing: [] };
    await r.reconcile();
    answer = { ringing: [entry({ since: stamp(1000) })] };
    await r.reconcile();
    expect(notes).toHaveLength(2);
    r.stop();
  });

  it('names the announcement by the ring it is about', () => {
    const c = { id: 3, mine: false, visitor: 'Visitor 4F2A', site: null, preview: null, since: '2026-10-05 10:00:00' } as WebchatRingChat;
    expect(announceEvent(c)).toMatchObject({ type: 'chat.incoming', event_id: 'list-3-2026-10-05 10:00:00', conversation_id: 3 });
    expect(announceEvent({ ...c, mine: true }).type).toBe('chat.assigned');
  });
});
