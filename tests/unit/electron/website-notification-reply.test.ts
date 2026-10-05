import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void>; closed: boolean }>);
vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: { createFromPath: () => ({}) },
  Notification: class {
    static isSupported = () => true;
    entry: (typeof notes)[number];
    constructor(options: Record<string, unknown>) {
      this.entry = { options, events: {}, closed: false };
      notes.push(this.entry);
    }
    on(name: string, fn: (...args: unknown[]) => void) {
      this.entry.events[name] = fn;
      return this;
    }
    show() {}
    close() {
      this.entry.closed = true;
    }
  },
}));
import { NotificationService, inlineReply, replyText } from '../../../electron/services/notifications';
import { WEBSITE_REPLY_LABEL, websiteDraftKey, websiteReplyMutation } from '../../../shared/website-reply';
import type { SubmitResult } from '../../../shared/ipc/contract';
import type { Preferences } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';

/**
 * A website visitor's message as a desktop banner that takes a reply (WS-WCHAT RDC-15): typed in the banner, sent
 * through the outbox exactly as the conversation's composer sends it; a refusal keeps the words to send again.
 */
const realPlatform = process.platform;
const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p, configurable: true });
const ok: SubmitResult = { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };

function setup(privacy = 'FULL') {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: privacy, notificationSounds: false, dndEnabled: false, language: 'en' } as unknown as Preferences;
  const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
  const http = { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) };
  const service = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
  (service as unknown as { userId: string }).userId = '5';
  service.onClick = vi.fn();
  service.sendWebsiteReply = vi.fn(async () => ok);
  service.websiteReplyRefused = vi.fn();
  const message = (id = 'm1') => service.handleRealtime({ type: 'chat.widget.message', conversation_id: 41, visitor: 'Visitor 4F2A', preview: 'Is it yearly?', message_id: id } as never);
  return { service, message };
}

beforeEach(() => {
  notes.length = 0;
  onPlatform('darwin');
});
afterEach(() => onPlatform(realPlatform));

describe('replying to a website visitor from the banner (RDC-15)', () => {
  it('offers a reply box on macOS and Windows, and sends what is typed the way the composer does', async () => {
    const { service, message } = setup();
    message();
    expect(notes[0]!.options).toMatchObject({ title: 'Visitor 4F2A · website chat', body: 'Is it yearly?', hasReply: true, replyPlaceholder: 'Reply to Visitor 4F2A' });
    notes[0]!.events.reply!({ reply: '  Yes, it is yearly.  ' }, 'ignored');
    await vi.waitFor(() => expect(notes[0]!.closed).toBe(true));
    expect(service.sendWebsiteReply).toHaveBeenCalledWith(41, 'Yes, it is yearly.');
    expect(service.onClick).not.toHaveBeenCalled();
    expect(service.websiteReplyRefused).not.toHaveBeenCalled();
  });

  it('a reply that waits for the network counts as sent: the outbox sends it once on reconnecting', async () => {
    const { service, message } = setup();
    vi.mocked(service.sendWebsiteReply!).mockResolvedValue({ ...ok, delivered: false, queued: true, id: 'q1', status: null });
    message();
    notes[0]!.events.reply!({ reply: 'On it' });
    await vi.waitFor(() => expect(notes[0]!.closed).toBe(true));
    expect(service.websiteReplyRefused).not.toHaveBeenCalled();
  });

  it('a refused reply is kept, with the reason, and the conversation opens', async () => {
    const { service, message } = setup();
    vi.mocked(service.sendWebsiteReply!).mockResolvedValue({ ...ok, delivered: false, status: 403, error: 'You cannot reply to website chats.', code: 'PERMISSION_DENIED' });
    message();
    notes[0]!.events.reply!({ reply: 'Hello' });
    await vi.waitFor(() => expect(service.websiteReplyRefused).toHaveBeenCalledWith({ conversationId: 41, visitor: 'Visitor 4F2A' }, 'Hello', 'You cannot reply to website chats.'));
  });

  it('nothing typed, or locked meanwhile, opens the conversation instead of sending', async () => {
    const { service, message } = setup();
    message('a');
    notes[0]!.events.reply!({ reply: '   ' });
    await vi.waitFor(() => expect(service.onClick).toHaveBeenCalledWith('/chat?website=41', 'chat'));
    service.isLocked = () => true;
    message('b');
    // Locked banners never take a reply; one shown before the lock opens the conversation (after the unlock).
    expect(notes[1]!.options.hasReply).toBe(false);
    notes[0]!.events.reply!({ reply: 'Typed before the lock' });
    await vi.waitFor(() => expect(service.onClick).toHaveBeenCalledTimes(2));
    expect(service.sendWebsiteReply).not.toHaveBeenCalled();
  });

  it('no reply box on Linux, with content hidden, or for other chat banners', () => {
    onPlatform('linux');
    setup().message();
    expect(notes[0]!.options.hasReply).toBe(false);
    onPlatform('win32');
    setup('SENDER_ONLY').message();
    expect(notes[1]!.options.hasReply).toBe(false);
    setup().service.handleRealtime({ type: 'chat.message', room_id: 3, sender: 'Nuwan', preview: 'Hi', message_id: 9 } as never);
    expect(notes[2]?.options.hasReply ?? false).toBe(false);
    expect(inlineReply('win32', 'FULL', false)).toBe(true);
    expect(inlineReply('darwin', 'FULL', true)).toBe(false);
    expect(replyText({ reply: '' }, 'legacy words')).toBe('legacy words');
    expect(replyText(null)).toBeNull();
  });

  it('builds the same outbox reply as the composer, and the draft it falls back to', () => {
    expect(websiteReplyMutation(41, 'Hello')).toEqual({
      module: 'website-chat',
      entity: 'reply',
      entityId: '41',
      label: `${WEBSITE_REPLY_LABEL}Hello`,
      method: 'POST',
      path: '/api/chat/widget-admin/conversations/41/reply',
      body: { message: 'Hello', client_id: expect.any(String) },
      queueIfOffline: true,
    });
    expect((websiteReplyMutation(41, 'x'.repeat(5000)).body as { message: string }).message).toHaveLength(4000);
    // Answering one message quotes it (RDC-10).
    expect(websiteReplyMutation(41, 'Yes', 7).body).toEqual({ message: 'Yes', reply_to: 7, client_id: expect.any(String) });
    // The client id given is the one sent (DLV-01): a retry carries the same one, and the server stores it once.
    expect(websiteReplyMutation(41, 'Yes', null, 3, 'c-0e8f2a7b').body).toEqual({ message: 'Yes', canned_id: 3, client_id: 'c-0e8f2a7b' });
    expect((websiteReplyMutation(41, 'a').body as { client_id: string }).client_id).not.toBe((websiteReplyMutation(41, 'a').body as { client_id: string }).client_id);
    expect(websiteDraftKey(41)).toEqual({ module: 'website-chat', context: 'conversation:41' });
  });
});

describe('a visitor writing again in my chat (#230)', () => {
  const again = (service: NotificationService, over: Record<string, unknown> = {}) =>
    service.handleRealtime({ type: 'chat.widget.message', conversation_id: 41, visitor: 'Visitor CC1B', preview: 'Are u there', site: 'techubiz.com', message_id: `m${notes.length + Math.random()}`, assigned_to: 5, participants: [5], followup: true, ...over } as never);

  it('says "Visitor CC1B: Are u there" with Reply while WorkSuite is not in front, and one banner stands for several messages', () => {
    const { service } = setup();
    again(service);
    expect(notes[0]!.options).toMatchObject({ title: 'Visitor CC1B: Are u there', body: 'techubiz.com · Your website chat', hasReply: true });
    again(service, { preview: 'Hello??' });
    expect(notes[0]!.closed).toBe(true);
    expect(notes[1]!.options).toMatchObject({ title: 'Visitor CC1B: Hello??', body: '2 new messages · techubiz.com · Your website chat' });
    // Answered: its banner goes.
    service.handleRealtime({ type: 'chat.widget.followup', conversation_id: 41, stage: 'answered' } as never);
    expect(notes[1]!.closed).toBe(true);
  });

  it('nothing while I am looking at the chat, while WorkSuite is in front (the card has it), or when I turned it off', () => {
    const { service } = setup();
    service.websiteAttending = (id) => id === 41;
    again(service);
    service.handleRealtime({ type: 'chat.widget.message', conversation_id: 41, visitor: 'Visitor CC1B', preview: 'not a follow-up', message_id: 'x1' } as never);
    expect(notes).toHaveLength(0);
    service.websiteAttending = () => false;
    service.isFocused = () => true;
    again(service);
    expect(notes).toHaveLength(0);
    service.isFocused = () => false;
    service.followUpDesktop = () => false;
    again(service);
    expect(notes).toHaveLength(0);
    // Somebody else's chat is the usual banner.
    again(service, { assigned_to: 9, participants: [9] });
    expect(notes[0]!.options.title).toBe('Visitor CC1B · website chat');
  });
});
