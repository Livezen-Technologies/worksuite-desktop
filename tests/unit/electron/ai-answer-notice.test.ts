import { beforeEach, describe, expect, it, vi } from 'vitest';

const shown = vi.hoisted(() => [] as Array<{ title: string; body: string }>);
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  nativeImage: { createFromPath: () => ({}) },
  Notification: class {
    static isSupported = () => true;
    constructor(private readonly o: { title: string; body: string }) {}
    on() {
      return this;
    }
    show() {
      shown.push({ title: this.o.title, body: this.o.body });
    }
    close() {}
  },
}));

import { AI_ANSWER_LINK, answerNotice } from '../../../electron/services/ai-pending';
import { NotificationService } from '../../../electron/services/notifications';
import type { Database } from '../../../electron/services/db';
import type { HttpClient } from '../../../electron/services/http';
import type { Vault } from '../../../electron/services/vault';
import type { Preferences } from '../../../shared/types';

function service(over: Partial<Preferences> = {}, locked = false) {
  const db = { tx: (f: () => void) => f(), run: () => undefined, all: () => [] } as unknown as Database;
  const vault = { encrypt: (x: unknown) => JSON.stringify(x), decrypt: () => null } as unknown as Vault;
  const http = { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) } as unknown as HttpClient;
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: true, dndEnabled: false, dndFrom: '00:00', dndTo: '00:00', language: 'en', ...over } as Preferences;
  const s = new NotificationService(db, () => vault, http, () => prefs);
  s.isLocked = () => locked;
  return s;
}

beforeEach(() => {
  shown.length = 0;
});

describe('the banner for an answer that arrived in the background (#126)', () => {
  it('opens the assistant, says what happened, and carries the first words of the answer', () => {
    const n = answerNotice('ready', '  Two tasks\n are due.  ', 5);
    expect(n).toMatchObject({ id: 'ai-answer:5', module: 'ai', category: 'ai', link: AI_ANSWER_LINK, title: 'Your AI Assistant answer is ready', body: 'Two tasks are due.', critical: false });
    expect(answerNotice('input', '').title).toBe('The AI Assistant needs your input');
    expect(answerNotice('failed', '').body).toBe('Open the assistant to try again.');
    expect(answerNotice('ready', 'x'.repeat(400)).body).toHaveLength(160);
  });

  it('shows the answer only as "What banners show" allows', () => {
    service().notify(answerNotice('ready', 'Two tasks are due.', 1));
    expect(shown.at(-1)).toEqual({ title: 'Your AI Assistant answer is ready', body: 'Two tasks are due.' });
    service({ notificationPrivacy: 'SENDER_ONLY' }).notify(answerNotice('ready', 'Two tasks are due.', 2));
    expect(shown.at(-1)!.body).not.toContain('Two tasks');
    service({ notificationPrivacy: 'GENERIC' }).notify(answerNotice('ready', 'Two tasks are due.', 3));
    expect(shown.at(-1)).toEqual({ title: 'WorkSuite', body: 'New WorkSuite notification' });
  });

  it('never says what the answer is while WorkSuite is locked', () => {
    service({}, true).notify(answerNotice('ready', 'Asha earns 200,000.', 4));
    expect(shown.at(-1)).toEqual({ title: 'WorkSuite', body: 'New WorkSuite notification' });
  });

  it('is not shown with notifications off, the AI Assistant muted, or in Do not disturb', () => {
    service({ notificationsEnabled: false }).notify(answerNotice('ready', 'a', 6));
    service({ moduleNotifications: { ai: false } }).notify(answerNotice('ready', 'a', 7));
    service({ dndEnabled: true, dndFrom: '00:00', dndTo: '23:59' }).notify(answerNotice('ready', 'a', 8));
    expect(shown).toHaveLength(0);
  });
});
