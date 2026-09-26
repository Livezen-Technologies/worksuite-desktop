import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ openWebLink: vi.fn() }));
vi.mock('../../../src/modules/meet/api', () => ({ openMeeting: vi.fn() }));

const { appOf, inView, isApproval, isAssigned, isMention, meetUuid, needsYou, quickActions, sectioned, sectionOf, snoozeChoices } = await import('../../../src/modules/notifications/api');
type N = Parameters<typeof sectionOf>[0];

const n = (over: Partial<N>): N => ({ id: 1, event: 'task.commented', category: 'projects', title: 'T', body: null, link: null, icon: null, level: 'info', priority: 'normal', count: 1, image_url: null, read: false, archived: false, pinned: false, snoozed_until: null, created_at: '2026-09-27 08:00:00', ...over });
const now = new Date('2026-09-27T10:00:00Z');

describe('notifications: what goes where', () => {
  it('reads mentions, approvals and assignments from the event name', () => {
    expect(isMention(n({ event: 'chat.mention' }))).toBe(true);
    expect(isMention(n({ event: 'task.mentioned' }))).toBe(true);
    expect(isApproval(n({ event: 'expense.approval_required' }))).toBe(true);
    expect(isApproval(n({ event: 'hr.leave_requested' }))).toBe(true);
    expect(isApproval(n({ event: 'hr.leave_approved' }))).toBe(false);
    expect(isAssigned(n({ event: 'task.assigned' }))).toBe(true);
    expect(isAssigned(n({ event: 'crm.lead_assigned' }))).toBe(true);
    expect(isAssigned(n({ event: 'oms.unassigned' }))).toBe(false);
    expect(inView(n({ event: 'chat.mention' }), 'approvals')).toBe(false);
  });

  it('puts what waits on you first, then today, then earlier', () => {
    expect(needsYou(n({ event: 'expense.approval_required' }))).toBe(true);
    expect(needsYou(n({ priority: 'high' }))).toBe(true);
    expect(needsYou(n({ priority: 'high', read: true }))).toBe(false);
    expect(sectionOf(n({ created_at: '2026-09-27 09:00:00' }), now)).toBe('today');
    expect(sectionOf(n({ created_at: '2026-09-25 09:00:00' }), now)).toBe('earlier');
    const s = sectioned([n({ id: 1, created_at: '2026-09-20 09:00:00' }), n({ id: 2, priority: 'critical' }), n({ id: 3, created_at: '2026-09-27 09:30:00' })], now);
    expect(s.map((g) => [g.section, g.items.map((x) => x.id)])).toEqual([['needs', [2]], ['today', [3]], ['earlier', [1]]]);
  });

  it('offers Join for a meeting, Reply for a conversation, Review for a decision, Open otherwise', () => {
    const uuid = 'd9de3234-a5a2-4d13-8bd6-b2972e1043ef';
    expect(meetUuid(`/meet/${uuid}`)).toBe(uuid);
    expect(quickActions(n({ link: `/meet/${uuid}` }))[0]!.label).toBe('Join');
    expect(quickActions(n({ link: '/chat?room=4' }))[0]!.label).toBe('Reply');
    expect(quickActions(n({ link: '/hr?tab=waiting', event: 'hr.leave_requested' }))[0]!.label).toBe('Review');
    expect(quickActions(n({ link: '/tasks?task=3' }))[0]!.label).toBe('Open');
    expect(quickActions(n({ link: null }))).toEqual([]);
  });

  it('names every app, including ones it has no look for', () => {
    expect(appOf('projects').short).toBe('Projects');
    expect(appOf('brand_new', { brand_new: 'Brand new things' }).short).toBe('Brand new things');
    expect(appOf(null).short).toBe('WorkSuite');
  });

  it('snoozes to real moments: tomorrow at 9, Monday at 9', () => {
    const at = new Date(2026, 8, 27, 15, 30); // a Sunday afternoon, local time
    const c = snoozeChoices(at);
    const when = (label: string) => new Date(at.getTime() + c.find((x) => x.label.startsWith(label))!.minutes * 60_000);
    expect(when('Tomorrow').getHours()).toBe(9);
    expect(when('Tomorrow').getDate()).toBe(28);
    expect(when('Monday').getDay()).toBe(1);
    expect(when('Monday').getDate()).toBe(28);
  });
});
