import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { NotificationService } from '../../../electron/services/notifications';
import type { Preferences } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';

/**
 * A website visitor's voice call with the call window off in Settings (V-04, VOICE-10): the system's call banner says
 * so, and goes when the call stops ringing. With the window on, the window is the alert and no banner is shown.
 */
function setup(windowOn: boolean, locked = false) {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false, language: 'en', lockedShowCallerDetails: false } as unknown as Preferences;
  const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
  const http = { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) };
  const service = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
  service.onClick = vi.fn();
  service.callWindowOn = () => windowOn;
  service.isLocked = () => locked;
  const frame = (what: string) =>
    service.handleRealtime({ type: 'chat.widget.call', what, call_id: 41, conversation_id: 4, visitor: 'Visitor 4F2A', site: 'techubiz.com', owner: 'Nuwan Perera', last_message: 'With the education discount, please?' } as never);
  return { service, frame };
}

beforeEach(() => {
  notes.length = 0;
});

describe('a visitor calling with the call window off (V-04)', () => {
  it('shows a call banner that opens the chat, and closes it when the call stops ringing', () => {
    const { service, frame } = setup(false);
    frame('ringing');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({
      title: 'Incoming voice call · Visitor 4F2A',
      body: 'techubiz.com · in chat with Nuwan · “With the education discount, please?”',
      urgency: 'critical',
      timeoutType: 'never',
    });
    notes[0]!.events.click!();
    expect(service.onClick).toHaveBeenCalledWith('/chat?view=website&website=4', 'chat');
    frame('answered');
    expect(notes[0]!.closed).toBe(true);
  });

  it('nothing while the call window shows it', () => {
    const { frame } = setup(true);
    frame('ringing');
    expect(notes).toHaveLength(0);
  });

  it('locked, says a call and nothing about who', () => {
    const { frame } = setup(false, true);
    frame('ringing');
    expect(notes[0]!.options).toMatchObject({ title: 'WorkSuite', body: 'Incoming WorkSuite call' });
  });
});
