import { beforeEach, describe, expect, it, vi } from 'vitest';
const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void> }>);
const clip = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: { createFromPath: () => ({}) },
  clipboard: clip,
  Notification: class {
    static isSupported = () => true;
    entry: (typeof notes)[number];
    constructor(options: Record<string, unknown>) {
      this.entry = { options, events: {} };
      notes.push(this.entry);
    }
    on(name: string, fn: (...args: unknown[]) => void) {
      this.entry.events[name] = fn;
      return this;
    }
    show() {}
    close() {}
  },
}));
import { mapServerNotification, NotificationService } from '../../../electron/services/notifications';
import { socialNoticeActions } from '../../../shared/social-notices';
import { touchesSocialMedia } from '../../../src/core/query';
import type { Preferences } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';

/**
 * Social Media Manager's native notifications (WS-SMM-SRS-001 SMM-DSK-002, WF-17, AC-16): published, failed, approval
 * and inbox banners carry View post / Approve / Reply, a manual reminder carries Copy caption — and no button acts on
 * the post by itself.
 */
function service() {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false, language: 'en' } as unknown as Preferences;
  const http = { get: vi.fn(async () => ({ items: [], unread: 0 })), post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) };
  const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
  const s = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
  s.onClick = vi.fn();
  return { s, http };
}

beforeEach(() => {
  notes.length = 0;
  clip.writeText.mockReset();
});

describe('Social Media notification buttons', () => {
  it('offers View post and Approve for an approval, and they only open screens', () => {
    expect(socialNoticeActions('social.post.approval_requested', '/social-media/posts/103')).toEqual({
      buttons: [
        { label: 'View post', link: '/social-media/posts/103' },
        { label: 'Approve', link: '/social-media/approvals/103' },
      ],
    });
    expect(socialNoticeActions('social.post.published', '/social-media/posts/101?target=3')).toEqual({ buttons: [{ label: 'View post', link: '/social-media/posts/101' }] });
    expect(socialNoticeActions('social.inbox.assigned', '/social-media/inbox/201')).toEqual({ buttons: [{ label: 'Reply', link: '/social-media/inbox/201' }] });
  });

  it('gives a manual reminder Copy caption when the server sends the caption (WF-17)', () => {
    expect(socialNoticeActions('social.post.reminder_due', '/social-media/posts/121', [{ copy: 'Story: studio countdown' }])?.buttons).toEqual([
      { label: 'Copy caption', copy: 'Story: studio countdown' },
      { label: 'Mark as posted', link: '/social-media/posts/121' },
    ]);
  });

  it('ignores other modules’ events and links it does not know', () => {
    expect(socialNoticeActions('task.reminder', '/social-media/posts/1')).toBeNull();
    expect(socialNoticeActions('social.post.published', '/social/feed/1')).toBeNull();
    expect(socialNoticeActions('social.post.published', 'https://evil.example/social-media/posts/1')).toBeNull();
  });

  it('files the server’s social_media notifications under Social Media, not the internal Social stream', () => {
    expect(mapServerNotification({ id: 1, category: 'social_media', link: '/social-media/posts/9' }).module).toBe('social-media');
    expect(mapServerNotification({ id: 2, category: 'social', link: '/social-media/inbox/4' }).module).toBe('social-media');
    expect(mapServerNotification({ id: 3, category: 'social', link: '/social/posts/4' }).module).toBe('social');
  });

  it('puts the buttons on the banner; Approve opens the approval and Copy caption copies', () => {
    const { s } = service();
    s.handleRealtime({ type: 'notification', id: 77, event: 'social.post.approval_requested', category: 'social_media', title: 'Post needs your approval', body: 'Behind the scenes at the CreativeFX studio shoot', link: '/social-media/posts/103' });
    expect(notes[0]!.options.actions).toEqual([
      { type: 'button', text: 'View post' },
      { type: 'button', text: 'Approve' },
    ]);
    notes[0]!.events.action!({}, 1);
    expect(s.onClick).toHaveBeenCalledWith('/social-media/approvals/103', 'social-media');

    s.handleRealtime({ type: 'notification', id: 78, event: 'social.post.reminder_due', category: 'social_media', title: 'Time to post on Instagram', body: 'Story: studio countdown', link: '/social-media/posts/121', actions: [{ copy: 'Story: studio countdown #CreativeFX' }] });
    notes[1]!.events.action!({}, 0);
    expect(clip.writeText).toHaveBeenCalledWith('Story: studio countdown #CreativeFX');
  });

  it('refreshes its screens on its own realtime events and notifications', () => {
    expect(touchesSocialMedia({ type: 'social.post.published' })).toBe(true);
    expect(touchesSocialMedia({ type: 'notification', event: 'social.inbox.assigned' })).toBe(true);
    expect(touchesSocialMedia({ type: 'notification', event: 'mail.new' })).toBe(false);
  });
});
