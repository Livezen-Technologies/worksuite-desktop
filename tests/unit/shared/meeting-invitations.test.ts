import { describe, expect, it } from 'vitest';
import { awaitingAnswer, meetingNoticeActions, touchesInvitations } from '../../../shared/meeting-invitations';
import { bannerBlock, inDnd } from '../../../shared/notification-block';
import type { Preferences } from '../../../shared/types';

/**
 * Meeting invitations (worksuite-desktop#97): what a meeting notice offers, which realtime events change an
 * invitation somebody is shown, what is still waiting for an answer, and why a banner did not appear.
 */
const INVITE = [
  { label: 'Going', rsvp: 'accepted', meeting_id: 7 },
  { label: 'Maybe', rsvp: 'tentative', meeting_id: 7 },
  { label: 'Not going', rsvp: 'declined', meeting_id: 7 },
  { label: 'View meeting', link: '/calendar?date=2026-10-05', meeting_id: 7 },
];

describe('a meeting notice’s own actions', () => {
  it('offers the answers and View meeting of an invitation, from an array or the stored JSON', () => {
    const want = {
      meetingId: 7,
      answers: [
        { label: 'Going', rsvp: 'accepted' },
        { label: 'Maybe', rsvp: 'tentative' },
        { label: 'Not going', rsvp: 'declined' },
      ],
      view: '/calendar?date=2026-10-05',
      join: null,
    };
    expect(meetingNoticeActions('meeting.invitation', INVITE)).toEqual(want);
    expect(meetingNoticeActions('meeting.update', JSON.stringify(INVITE))).toEqual(want);
  });

  it('offers Join meeting on a reminder, and never an answer there', () => {
    const r = meetingNoticeActions('meeting.reminder', [{ label: 'Join meeting', url: 'https://meet.example.com/j/1', meeting_id: 7 }, ...INVITE]);
    expect(r).toMatchObject({ meetingId: 7, answers: [], join: 'https://meet.example.com/j/1', view: '/calendar?date=2026-10-05' });
  });

  it('offers nothing it was not given, nothing for another event, and nothing that names a second meeting', () => {
    expect(meetingNoticeActions('meeting.invitation', null)).toBeNull();
    expect(meetingNoticeActions('meeting.invitation', 'not json')).toBeNull();
    expect(meetingNoticeActions('task.reminder', INVITE)).toBeNull();
    expect(meetingNoticeActions(null, INVITE)).toBeNull();
    expect(meetingNoticeActions('meeting.invitation', [{ label: 'Going', rsvp: 'accepted', meeting_id: 7 }, { label: 'Not going', rsvp: 'declined', meeting_id: 8 }])?.answers).toHaveLength(1);
    expect(meetingNoticeActions('meeting.invitation', [{ label: 'Delete', rsvp: 'delete', meeting_id: 7 }, { label: 'Open', url: 'javascript:alert(1)', meeting_id: 7 }])).toBeNull();
  });
});

describe('what changes an invitation somebody is shown', () => {
  it('is a meeting notice or their own answer elsewhere', () => {
    expect(touchesInvitations({ type: 'meeting.rsvp' })).toBe(true);
    expect(touchesInvitations({ type: 'notification', event: 'meeting.invitation' })).toBe(true);
    expect(touchesInvitations({ type: 'notification', event: 'meeting.cancellation' })).toBe(true);
    expect(touchesInvitations({ type: 'notification', event: 'task.assigned' })).toBe(false);
    expect(touchesInvitations({ type: 'chat.message' })).toBe(false);
  });

  it('is still waiting only when unanswered — maybe is an answer', () => {
    expect(awaitingAnswer('no_response')).toBe(true);
    expect(awaitingAnswer('needs_action')).toBe(true);
    expect(awaitingAnswer('tentative')).toBe(false);
    expect(awaitingAnswer('accepted')).toBe(false);
    expect(awaitingAnswer(null)).toBe(false);
  });
});

describe('why banners are blocked', () => {
  const prefs = (over: Partial<Preferences> = {}) =>
    ({ notificationsEnabled: true, backgroundServices: { notifications: true, realtime: true }, dndEnabled: false, dndFrom: '22:00', dndTo: '07:00', moduleNotifications: {}, ...over }) as Preferences;
  const noon = new Date(2026, 9, 2, 12, 0);
  const at = { supported: true, pausedUntil: null, now: noon };

  it('says nothing when they are not', () => {
    expect(bannerBlock(prefs(), at)).toBeNull();
    expect(bannerBlock(prefs(), at, 'calendar')).toBeNull();
  });

  it('names the system first, then this computer’s switches, then a pause or do not disturb', () => {
    expect(bannerBlock(prefs({ notificationsEnabled: false }), { ...at, supported: false })).toMatch(/system settings/);
    expect(bannerBlock(prefs({ notificationsEnabled: false }), at)).toMatch(/Show banners/);
    expect(bannerBlock(prefs({ backgroundServices: { notifications: false, realtime: true } }), at)).toMatch(/Background notifications/);
    expect(bannerBlock(prefs(), { ...at, pausedUntil: new Date(noon.getTime() + 3_600_000).toISOString() })).toMatch(/paused until/);
    expect(bannerBlock(prefs(), { ...at, pausedUntil: new Date(noon.getTime() - 60_000).toISOString() })).toBeNull();
    expect(bannerBlock(prefs({ dndEnabled: true, dndFrom: '09:00', dndTo: '17:00' }), at)).toMatch(/Do not disturb is on until 17:00/);
  });

  it('names a muted kind only when that kind is asked about', () => {
    const muted = prefs({ moduleNotifications: { 'cat:calendar': false } });
    expect(bannerBlock(muted, at)).toBeNull();
    expect(bannerBlock(muted, at, 'calendar')).toMatch(/Calendar and meetings are switched off/);
  });

  it('reads a do-not-disturb window across midnight', () => {
    expect(inDnd('22:00', '07:00', new Date(2026, 9, 2, 23))).toBe(true);
    expect(inDnd('22:00', '07:00', new Date(2026, 9, 2, 12))).toBe(false);
  });
});
