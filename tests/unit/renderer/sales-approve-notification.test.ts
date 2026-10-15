import { describe, expect, it, vi } from 'vitest';
import { ApprovalBanners, approvalNoticeOf, approvalRoute, orderOfLink, type ApprovalBanner, type ApprovalBannerDeps, type ApprovalClaim } from '@shared/sales';
import { attentionCount } from '@shared/network';

/**
 * WS-OMS-SRS-001 FR-APR-10 / FR-DSK-05 (D-05): an order waiting on my approval arrives as a banner with Approve and
 * Open; Approve decides my step from the banner through `POST /api/oms/orders/{id}/approve`, and the badge counts the
 * approval queue once. (The main process's SalesDesk hands its notifications to these banners.)
 */
function desk(over: Partial<ApprovalBannerDeps> = {}) {
  const shown: ApprovalBanner[] = [];
  const posts: Array<{ path: string; body: unknown }> = [];
  const read: string[][] = [];
  const opened: string[] = [];
  const toasts: Array<[string, string]> = [];
  let refreshed = 0;
  const d = new ApprovalBanners({
    post: (async (path: string, body?: unknown) => {
      posts.push({ path, body });
      return { status: 'approved' };
    }) as ApprovalBannerDeps['post'],
    notify: (n) => void shown.push(n),
    markRead: async (ids) => void read.push(ids),
    enabled: () => true,
    open: (r) => void opened.push(r),
    refreshCounts: () => void refreshed++,
    toast: (kind, text) => void toasts.push([kind, text]),
    ...over,
  });
  return { d, shown, posts, read, opened, toasts, refreshed: () => refreshed };
}

const notice = (over: Partial<ApprovalClaim> = {}): ApprovalClaim => ({
  id: '501',
  event: 'oms.approval',
  title: 'Order SO-00483 needs your approval',
  body: 'It is waiting on a decision from you.',
  link: '/oms?order=483',
  category: 'oms',
  actions: [{ id: 'approve', label: 'Approve' }, { id: 'open', label: 'Open' }],
  data: { order_id: 483, step: 2 },
  ...over,
});

describe('approve from a notification', () => {
  it('reads the order and step from the payload, or the order from the link alone', () => {
    expect(approvalNoticeOf(notice())).toEqual({ orderId: 483, step: 2, labels: ['Approve', 'Open'] });
    expect(approvalNoticeOf(notice({ data: undefined, actions: undefined }))).toEqual({ orderId: 483, step: null, labels: ['Approve', 'Open'] });
    expect(approvalNoticeOf(notice({ event: 'oms.assigned' }))).toBeNull();
    expect(approvalNoticeOf(notice({ data: undefined, link: '/oms' }))).toBeNull();
    expect(orderOfLink('/sales?tab=orders&order=12')).toBe(12);
    expect(orderOfLink('/sales?tab=orders&order=12x')).toBeNull();
  });

  it('claims an approval and shows it with Approve and Open, linked to the approvals queue', () => {
    const t = desk();
    expect(t.d.claim(notice())).toBe(true);
    expect(t.shown).toHaveLength(1);
    expect(t.shown[0]!.custom?.actions).toEqual(['Approve', 'Open']);
    expect(t.shown[0]!.link).toBe(approvalRoute(483));
    expect(t.shown[0]!.readId).toBe('501');
  });

  it('leaves other notifications, and approvals for somebody without Sales, to be shown plainly', () => {
    expect(desk().d.claim(notice({ event: 'oms.status_changed' }))).toBe(false);
    const off = desk({ enabled: () => false });
    expect(off.d.claim(notice())).toBe(false);
    expect(off.shown).toHaveLength(0);
  });

  it('Approve decides the step through POST /api/oms/orders/{id}/approve, marks it read and asks for the count', async () => {
    const t = desk();
    t.d.claim(notice());
    await t.shown[0]!.custom!.onAction(0);
    expect(t.posts).toEqual([{ path: '/api/oms/orders/483/approve', body: { step: 2 } }]);
    expect(t.read).toEqual([['501']]);
    expect(t.refreshed()).toBe(1);
    expect(t.toasts[0]![0]).toBe('success');
    expect(t.opened).toEqual([]);
  });

  it('a refused approval opens the order instead and says why', async () => {
    const t = desk({
      post: (async () => {
        throw new Error('That step was already decided.');
      }) as ApprovalBannerDeps['post'],
    });
    t.d.claim(notice());
    await t.shown[0]!.custom!.onAction(0);
    expect(t.opened).toEqual(['/sales?tab=appr&order=483']);
    expect(t.toasts[0]).toEqual(['error', 'Not approved: That step was already decided.']);
    expect(t.read).toEqual([]);
  });

  it('Open opens the order in the approvals queue and marks the banner read', async () => {
    const t = desk();
    t.d.claim(notice());
    await t.shown[0]!.custom!.onAction(1);
    expect(t.posts).toEqual([]);
    expect(t.opened).toEqual(['/sales?tab=appr&order=483']);
    expect(t.read).toEqual([['501']]);
  });

  it('asks for the count again after an approval event, once for a burst', async () => {
    vi.useFakeTimers();
    try {
      const t = desk({ settleMs: 1500 });
      t.d.handle({ type: 'oms.approval.changed' });
      t.d.handle({ type: 'oms.badge' });
      t.d.handle({ type: 'oms.order.updated' });
      vi.advanceTimersByTime(2000);
      expect(t.refreshed()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts the approval queue once on the badge, not its bell entries as well', () => {
    // 2 chats, 5 bell entries of which 3 are approvals, 4 approvals waiting: 2 + (5 − 3) + 4.
    expect(attentionCount(2, 5, 0, 0, 0, 0, 4, 3)).toBe(8);
    expect(attentionCount(2, 5)).toBe(7);
  });
});
