import { describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { decisionBody, decisionPath, PurchaseApprovalBanners, purchaseApprovalOf, purchaseLinkDoc, type PurchaseApprovalBanner, type PurchaseApprovalClaim, type PurchaseApprovalDeps } from '@shared/purchase';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { apiPost, ApiError } = await import('../../../src/core/api');
const { approvalActions, approvalOf, chainWords, currentStep, decide, refusalCode, refusalText, submitForApproval } = await import('../../../src/modules/purchase/chain');
const { purchaseCan } = await import('../../../src/modules/purchase/api');

/**
 * SRS-PUR-001 G-01, G-14, G-21: a purchase document's approval chain on the desktop — what it says, which of Submit,
 * Approve and Reject it offers, what the server's refusals (409 approval_required, 403 self_approval, 409
 * already_decided) mean in words — and Approve from the banner.
 */
const chain = (over: Record<string, unknown> = {}) => ({
  approval: {
    required: true,
    status: 'pending',
    can_approve: true,
    mine: false,
    steps: [
      { step: 1, label: 'Department', permission: 'inventory.approve', approver: null, decided_by: 'Nadeesha P.', decision: 'approved', decided_at: '2026-09-22 10:00:00', note: null },
      { step: 2, label: 'Finance', permission: 'finance.approve', approver: 'Ruwan S.', decided_by: null, decision: 'pending', decided_at: null, note: null },
      { step: 3, label: 'Director', permission: 'inventory.approve', approver: null, decided_by: null, decision: 'pending', decided_at: null, note: null },
    ],
    ...over,
  },
});
const online = { raise: true, approve: true, offline: false };

describe('the approval chain', () => {
  it('reads the chain the purchasing build sends', () => {
    const a = approvalOf(chain(), true);
    expect(a).toMatchObject({ required: true, status: 'pending', canApprove: true, mine: false });
    expect(currentStep(a)).toMatchObject({ step: 2, label: 'Finance', approver: 'Ruwan S.' });
    expect(chainWords(a)).toBe('Approval 2/3');
  });

  it('reads an older server’s bare list, where the approve permission and may_approve decide', () => {
    const old = { approvals: [{ id: 1, step: 1, level: 'department', status: 'approved', decided_by_name: 'N', decided_at: '2026-09-22', note: null }, { id: 2, step: 2, level: 'finance', status: 'pending' }], may_approve: true };
    expect(approvalOf(old, true)).toMatchObject({ status: 'pending', canApprove: true });
    expect(approvalOf(old, true).steps.map((s) => s.label)).toEqual(['Department', 'Finance']);
    expect(approvalOf(old, false).canApprove).toBe(false);
    expect(approvalOf({ ...old, may_approve: false }, true)).toMatchObject({ canApprove: false, mine: true });
    expect(approvalOf({ approvals: [] }, true)).toMatchObject({ status: 'none', required: false });
  });

  it('offers Approve and Reject only when the step is mine to decide, online', () => {
    const a = approvalOf(chain(), true);
    expect(approvalActions(a, 'pending', online)).toEqual({ submit: false, approve: true, reject: true, note: null });
    expect(approvalActions(a, 'pending', { ...online, approve: false })).toMatchObject({ approve: false, reject: false });
    expect(approvalActions(a, 'pending', { ...online, offline: true })).toEqual({ submit: false, approve: false, reject: false, note: 'Your decision waits for the connection.' });
  });

  it('says who it waits on — and that the raiser cannot approve their own', () => {
    expect(approvalActions(approvalOf(chain({ can_approve: false }), true), 'pending', online)).toEqual({ submit: false, approve: false, reject: false, note: 'Waiting on Finance · Ruwan S.' });
    expect(approvalActions(approvalOf(chain({ can_approve: false, mine: true }), true), 'pending', online).note).toBe('You raised this, so someone else approves it.');
  });

  it('offers Submit for a draft, or one sent back, to whoever may raise it', () => {
    const none = approvalOf({ approval: { required: true, status: 'none', steps: [], can_approve: false, mine: true } }, true);
    expect(approvalActions(none, 'draft', online).submit).toBe(true);
    expect(approvalActions(none, 'draft', { ...online, raise: false }).submit).toBe(false);
    expect(approvalActions(none, 'draft', { ...online, offline: true }).submit).toBe(false);
    expect(approvalActions(approvalOf(chain({ status: 'rejected' }), true), 'rejected', online).submit).toBe(true);
    expect(approvalActions(approvalOf(chain(), true), 'draft', online).submit).toBe(false);
    expect(approvalActions(none, 'approved', online).submit).toBe(false);
  });
});

describe('the server’s refusals', () => {
  it('names 409 approval_required, 403 self_approval and 409 already_decided in words', () => {
    const required = new ApiError(409, 'Approval required.', 'approval_required');
    const self = new ApiError(403, 'Forbidden.', null, { code: 'self_approval' });
    const taken = new ApiError(409, 'Conflict: already_decided', null);
    expect(refusalCode(required)).toBe('approval_required');
    expect(refusalCode(self)).toBe('self_approval');
    expect(refusalCode(taken)).toBe('already_decided');
    expect(refusalText(required)).toMatch(/needs approval first/);
    expect(refusalText(self)).toBe('You raised this, so someone else has to approve it.');
    expect(refusalText(taken)).toMatch(/already decided this step/);
    expect(refusalCode(new ApiError(409, 'possible duplicate', 'possible_duplicate'))).toBe('possible_duplicate');
  });

  it('leaves any other refusal in the server’s own words', () => {
    const e = new ApiError(422, 'The order has no lines.', null);
    expect(refusalCode(e)).toBeNull();
    expect(refusalText(e)).toBe('The order has no lines.');
  });
});

describe('the calls', () => {
  it('submits and decides at the document’s own addresses; a bill decides through its decide', async () => {
    await submitForApproval('order', 12);
    await decide('order', 12, 'approve', { step: 2 });
    await decide('request', 7, 'reject', { note: ' Over budget ' });
    await decide('return', 3, 'approve');
    await decide('bill', 9, 'reject', { note: 'Billed more than kept' });
    await submitForApproval('bill', 9);
    expect(vi.mocked(apiPost).mock.calls).toEqual([
      ['/api/purchase/orders/12/submit', {}],
      ['/api/purchase/orders/12/approve', { step: 2 }],
      ['/api/purchase/requests/7/reject', { note: 'Over budget' }],
      ['/api/purchase/returns/3/approve', {}],
      ['/api/inventory/bills/9/decide', { approve: false, note: 'Billed more than kept' }],
      ['/api/inventory/bills/9/submit', {}],
    ]);
    expect(decisionPath('bill', 9, 'approve')).toBe('/api/inventory/bills/9/decide');
    expect(decisionBody('bill', 'approve')).toEqual({ approve: true });
  });

  it('respects the narrow permissions, with inventory.purchase still the umbrella', () => {
    expect(purchaseCan(['purchase.receive'])).toMatchObject({ receive: true, order: false, request: false, bill: false, pay: false, approve: false });
    expect(purchaseCan(['payables.pay'])).toMatchObject({ pay: true, allocate: true, bill: false, order: false });
    expect(purchaseCan(['purchase.order'])).toMatchObject({ order: true, request: true, receive: false });
    expect(purchaseCan(['inventory.purchase'])).toMatchObject({ request: true, order: true, receive: true, bill: true, pay: true, allocate: true, approve: false });
    expect(purchaseCan(['inventory.approve'])).toMatchObject({ approve: true, order: false });
    expect(purchaseCan(['*'])).toMatchObject({ order: true, approve: true, settings: true });
    expect(purchaseCan(undefined)).toMatchObject({ order: false, receive: false, approve: false });
  });
});

function banners(over: Partial<PurchaseApprovalDeps> = {}) {
  const shown: PurchaseApprovalBanner[] = [];
  const posts: Array<{ path: string; body: unknown }> = [];
  const read: string[][] = [];
  const opened: string[] = [];
  const toasts: Array<[string, string]> = [];
  let refreshed = 0;
  const d = new PurchaseApprovalBanners({
    post: (async (path: string, body?: unknown) => {
      posts.push({ path, body });
      return { approval: { status: 'pending' } };
    }) as PurchaseApprovalDeps['post'],
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

const notice = (over: Partial<PurchaseApprovalClaim> = {}): PurchaseApprovalClaim => ({
  id: '701',
  event: 'purchase.approval',
  title: 'PO-2026-0418 needs your approval',
  body: 'Lanka Office Supplies · 486,200.00 · step 2 of 3',
  link: '/purchase/orders/418',
  category: 'purchasing',
  actions: [{ id: 'approve', label: 'Approve' }, { id: 'open', label: 'Open' }],
  data: { doc: 'order', id: 418, step: 2 },
  ...over,
});

describe('Approve from the banner', () => {
  it('reads the document and step from the payload, or the document from the link', () => {
    expect(purchaseApprovalOf(notice())).toEqual({ doc: 'order', id: 418, step: 2, labels: ['Approve', 'Open'] });
    expect(purchaseApprovalOf(notice({ data: undefined, actions: undefined }))).toEqual({ doc: 'order', id: 418, step: null, labels: ['Approve', 'Open'] });
    expect(purchaseApprovalOf(notice({ data: { bill_id: 9 }, link: null }))).toMatchObject({ doc: 'bill', id: 9 });
    expect(purchaseApprovalOf(notice({ event: 'purchase.order.sent' }))).toBeNull();
    expect(purchaseApprovalOf(notice({ data: undefined, link: '/purchase' }))).toBeNull();
    expect(purchaseLinkDoc('/purchase?tab=req&request=5')).toEqual({ doc: 'request', id: 5 });
  });

  it('shows Approve and Open, opening the document in Purchasing; not for somebody without the app', () => {
    const t = banners();
    expect(t.d.claim(notice())).toBe(true);
    expect(t.shown[0]).toMatchObject({ module: 'purchase', link: '/purchase?tab=po&po=418', readId: '701' });
    expect(t.shown[0]!.custom.actions).toEqual(['Approve', 'Open']);
    const off = banners({ enabled: () => false });
    expect(off.d.claim(notice())).toBe(false);
    expect(off.shown).toHaveLength(0);
  });

  it('Approve decides my step, marks it read and asks for the count again', async () => {
    const t = banners();
    t.d.claim(notice());
    await t.shown[0]!.custom.onAction(0);
    expect(t.posts).toEqual([{ path: '/api/purchase/orders/418/approve', body: { step: 2 } }]);
    expect(t.read).toEqual([['701']]);
    expect(t.refreshed()).toBe(1);
    expect(t.toasts).toEqual([['success', 'Your step is approved.']]);
  });

  it('a refusal opens the document with the reason: nothing is decided by accident', async () => {
    const t = banners({
      post: (async () => {
        throw new Error('You raised this document, so somebody else has to approve it.');
      }) as PurchaseApprovalDeps['post'],
    });
    t.d.claim(notice());
    await t.shown[0]!.custom.onAction(0);
    expect(t.opened).toEqual(['/purchase?tab=po&po=418']);
    expect(t.toasts[0]![0]).toBe('error');
    expect(t.toasts[0]![1]).toMatch(/^Not approved: You raised this document/);
    expect(t.read).toEqual([]);
  });

  it('Open opens the document and marks it read', async () => {
    const t = banners();
    t.d.claim(notice({ data: { doc: 'return', id: 3 }, link: null }));
    await t.shown[0]!.custom.onAction(1);
    expect(t.opened).toEqual(['/purchase?tab=ret&return=3']);
    expect(t.read).toEqual([['701']]);
    expect(t.posts).toEqual([]);
  });
});
