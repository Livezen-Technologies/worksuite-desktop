import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { Preferences, WebchatRingChat, WebchatRingPrefs, WebchatRingState } from '@shared/types';

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

import { returningWords, returnVisitOf } from '../../../shared/website-returning';
import { announceEvent, WebchatRinger, type PendingAnswer, type RingingEntry } from '../../../electron/services/webchat-ring';
import { NotificationService, returningNote } from '../../../electron/services/notifications';
import type { Database } from '../../../electron/services/db';
import type { HttpClient } from '../../../electron/services/http';
import type { Vault } from '../../../electron/services/vault';

/**
 * A returning visitor writes in a closed chat (worksuite-desktop#291), in the main process: the ring says whose the last
 * chat was, a chat that rang before rings — and shows its card — again, and the system notification says it as it says
 * a new chat. An older server's `returning: true` changes nothing.
 */
const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const back = (over: Record<string, unknown> = {}) => ({ reopened: true, previous_at: '2026-08-16 10:00:00', previous_agent_id: 5, previous_agent_name: 'Nuwan Silva', previous_conversation_id: null, ...over });
const incoming = (over: Record<string, unknown> = {}) => ({ type: 'chat.incoming', event_id: 'ev-1', conversation_id: 7, visitor: 'Visitor 4F2A', site: 'techubiz.com', preview: 'Hi again — is my order shipped?', waiting_since: stamp(2_000), returning: back(), ...over });
const prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };

function ringer(get: () => Promise<PendingAnswer> = async () => ({ ringing: [] }), over: Partial<{ me: number; locked: boolean }> = {}) {
  const announced: WebchatRingChat[] = [];
  const states: WebchatRingState[] = [];
  const r = new WebchatRinger({
    http: { get: vi.fn(get), post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) } as unknown as HttpClient,
    signedIn: () => true,
    locked: () => over.locked ?? false,
    me: () => over.me ?? 5,
    prefs: () => prefs,
    quiet: () => false,
    open: () => undefined,
    onChanged: (s) => states.push(s),
    deviceId: () => 'desktop-12',
    focused: () => false,
    idleSeconds: () => 0,
    announce: (c) => announced.push(c),
  });
  return { r, announced, states };
}

afterEach(() => vi.useRealTimers());

describe('the ring says whose the last chat was (#291)', () => {
  it('reads `returning` from the ring, and says the last chat was mine', () => {
    const { r } = ringer();
    r.start();
    r.handle(incoming() as never);
    const [c] = r.state().chats;
    expect(c).toMatchObject({ id: 7, returning: true, preview: 'Hi again — is my order shipped?', returnVisit: { reopened: true, previousAt: '2026-08-16 10:00:00', previousAgentId: 5, previousAgentName: 'Nuwan Silva', previousConversationId: null, withYou: true } });
    r.stop();
  });

  it('a colleague’s last chat is not mine; behind the lock nothing of it is said', () => {
    let locked = false;
    const { r } = ringer(undefined, { me: 9 });
    (r as unknown as { deps: { locked: () => boolean } }).deps.locked = () => locked;
    r.start();
    r.handle(incoming() as never);
    expect(r.state().chats[0]!.returnVisit).toMatchObject({ previousAgentName: 'Nuwan Silva', withYou: false });
    locked = true;
    expect(r.state().chats[0]!.returnVisit).toBeNull();
    r.stop();
  });

  it('keeps what the ring said when the list read after it does not say it', async () => {
    const entry: RingingEntry = { id: 7, conversation_id: 7, visitor: 'Visitor 4F2A', kind: 'waiting', mine: false, since: stamp(2_000), silenced: false, returning: true };
    const { r } = ringer(async () => ({ ringing: [entry] }));
    r.start();
    r.handle(incoming() as never);
    await r.reconcile();
    expect(r.state().chats[0]!.returnVisit?.previousAgentId).toBe(5);
    r.stop();
  });

  it('an older server: `returning: true` is a returning browser, and nothing more', () => {
    const { r } = ringer();
    r.start();
    r.handle({ ...incoming(), returning: true } as never);
    const [c] = r.state().chats;
    expect(c!.returning).toBe(true);
    expect('returnVisit' in c!).toBe(false);
    r.handle({ type: 'chat.incoming', conversation_id: 8, visitor: 'Visitor 11' } as never);
    expect(r.state().chats.find((x) => x.id === 8)).not.toHaveProperty('returnVisit');
    expect(returnVisitOf(true)).toBeNull();
    expect(returnVisitOf(null)).toBeNull();
    expect(returnVisitOf(undefined)).toBeNull();
    r.stop();
  });
});

describe('a chat that rang before rings again (#291)', () => {
  it('the card minimised the last time it rang comes back for it', () => {
    const { r } = ringer();
    r.start();
    r.handle({ type: 'chat.incoming', conversation_id: 7, visitor: 'Visitor 4F2A', waiting_since: stamp(60_000) } as never);
    r.minimise();
    expect(r.state().minimised).toBe(true);
    // A colleague joined it; the chat closed; the visitor came back days later and wrote in the same conversation.
    r.handle({ type: 'chat.ring.stopped', conversation_id: 7, reason: 'joined', by: 9, by_name: 'Dilini' } as never);
    expect(r.state().chats).toHaveLength(0);
    r.handle(incoming({ event_id: 'ev-2' }) as never);
    expect(r.state().chats.map((c) => c.id)).toEqual([7]);
    expect(r.state().minimised).toBe(false);
    expect(r.state().tone).toBe('normal');
    r.stop();
  });

  it('read from the list too: announced again, named by the last chat, with `returning` for the notification', async () => {
    const first: RingingEntry = { id: 7, conversation_id: 7, visitor: 'Visitor 4F2A', kind: 'waiting', mine: false, since: '2026-08-16 09:58:00', silenced: false };
    let answer: PendingAnswer = { ringing: [first] };
    const { r, announced } = ringer(async () => answer);
    r.start();
    await vi.waitFor(() => expect(announced).toHaveLength(1));
    r.minimise();
    answer = { ringing: [] };
    await r.reconcile();
    // The server kept the old waiting stamp: the ring is still a new one, by the visitor's last chat.
    answer = { ringing: [{ ...first, returning: back() }] };
    await r.reconcile();
    expect(announced).toHaveLength(2);
    expect(r.state().minimised).toBe(false);
    const ev = announceEvent(announced[1]!);
    expect(ev).toMatchObject({ type: 'chat.incoming', conversation_id: 7, returning: { reopened: true, previous_at: '2026-08-16 10:00:00', previous_agent_id: 5 } });
    expect(ev.event_id).not.toBe(announceEvent(announced[0]!).event_id);
    // An older server's ring is named as before.
    expect(announceEvent(announced[0]!).event_id).toBe('list-7-2026-08-16 09:58:00');
    expect(announceEvent(announced[0]!)).not.toHaveProperty('returning');
    r.stop();
  });

  it('the ringing card takes the place of the "visitor replied" card for that chat', () => {
    const { r } = ringer();
    r.start();
    r.handle({ type: 'chat.widget.message', conversation_id: 7, visitor: 'Visitor 4F2A', preview: 'Hi again', at: stamp(3_000), assigned_to: 5, participants: [5], followup: true } as never);
    expect(r.state().followUps?.map((f) => f.id)).toEqual([7]);
    r.handle(incoming() as never);
    expect(r.state().followUps).toEqual([]);
    expect(r.state().chats.map((c) => c.id)).toEqual([7]);
    r.stop();
  });
});

describe('the system notification says it as it says a new chat (#291)', () => {
  const service = (userId: string) => {
    notes.length = 0;
    const p = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: true, dndEnabled: false, language: 'en' } as unknown as Preferences;
    const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
    const s = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) } as unknown as HttpClient, () => p);
    (s as unknown as { userId: string }).userId = userId;
    return s;
  };
  const day = new Date(Date.parse('2026-08-16T10:00:00Z')).toLocaleDateString([], { day: 'numeric', month: 'short' });

  it('critical, with sound, the visitor’s new words and whose the last chat was', () => {
    const s = service('5');
    s.handleRealtime(incoming() as never);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({ title: 'Website chat · techubiz.com', urgency: 'critical', silent: false });
    expect(notes[0]!.options.body).toBe(`Visitor 4F2A: Hi again — is my order shipped?\nReturning visitor · last chat with you on ${day}`);
  });

  it('rings again for the same conversation: a new ring is a new notification', () => {
    const s = service('5');
    s.handleRealtime(incoming({ returning: null, event_id: 'first-ring' }) as never);
    s.handleRealtime(incoming({ event_id: 'reopen-ring' }) as never);
    expect(notes).toHaveLength(2);
  });

  it('a colleague’s last chat, by first name; nobody’s, by its day alone; an older server, as before', () => {
    expect(returningNote({ returning: back() }, 9)).toBe(`Returning visitor · last chat with Nuwan on ${day}`);
    expect(returningNote({ returning: back({ previous_agent_id: null, previous_agent_name: null }) }, 9)).toBe(`Returning visitor · last chat on ${day}`);
    expect(returningNote({ returning: back({ previous_at: null }) }, 5)).toBe('Returning visitor');
    expect(returningNote({ returning: true }, 5)).toBeNull();
    const s = service('9');
    s.handleRealtime(incoming({ returning: undefined }) as never);
    expect(notes[0]!.options.body).toBe('Visitor 4F2A: Hi again — is my order shipped?');
  });

  it('a returning visitor’s chat given to me says so as well', () => {
    const s = service('5');
    s.handleRealtime({ type: 'chat.assigned', conversation_id: 7, visitor: 'Visitor 4F2A', site: 'techubiz.com', at: stamp(1_000), returning: back() } as never);
    expect(notes[0]!.options.body).toBe(`Visitor 4F2A · techubiz.com\nReturning visitor · last chat with you on ${day}`);
  });

  it('words it the same way on every side of the app', () => {
    const say = (source: string, vars?: Record<string, string | number>) => source.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k]));
    const r = returnVisitOf(back())!;
    expect(returningWords(r, 5, () => '16 Aug', say)).toBe('Returning visitor · last chat with you on 16 Aug');
    expect(returningWords({ ...r, withYou: true }, null, () => '16 Aug', say)).toBe('Returning visitor · last chat with you on 16 Aug');
    expect(returningWords(r, 9, () => '16 Aug', say)).toBe('Returning visitor · last chat with Nuwan on 16 Aug');
  });
});
