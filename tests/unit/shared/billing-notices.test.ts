import { describe, expect, it, vi } from 'vitest';
import { BILLING_EVENTS, billingEventOf, billingLinkIds, billingNoticeOf, BillingBanners, type BillingBanner } from '../../../shared/billing';
import { resolveWebLink } from '../../../shared/links';

/*
 * Billing's native notifications (SRS-BIL-001 G-10): the eight `billing.*`
 * events open the record they are about in the Billing tab — from the event's
 * own facts first, then its link — and the banner's one button does the same.
 */
describe('billing notices: which event', () => {
  it('knows the eight events, however the server words them', () => {
    expect(BILLING_EVENTS).toEqual(['issued', 'viewed', 'paid', 'overdue', 'payment_received', 'refund', 'recurring_failed', 'credit_issued']);
    for (const e of BILLING_EVENTS) expect(billingEventOf(`billing.${e}`)).toBe(e);
    expect(billingEventOf('billing.invoice.paid')).toBe('paid');
    expect(billingEventOf('billing.invoice_overdue')).toBe('overdue');
    expect(billingEventOf('Billing.Payment_Received')).toBe('payment_received');
    expect(billingEventOf('billing.credit_note_issued')).toBe('credit_issued');
    expect(billingEventOf('billing.something_else')).toBeNull();
    expect(billingEventOf('oms.approval')).toBeNull();
    expect(billingEventOf(null)).toBeNull();
  });

  it('reads the records a link names, as the server and the web write them', () => {
    expect(billingLinkIds('/billing?invoice=361')).toEqual({ invoice: 361 });
    expect(billingLinkIds('/billing/invoices/361')).toEqual({ invoice: 361 });
    expect(billingLinkIds('/billing/payments/228?x=1')).toEqual({ payment: 228 });
    expect(billingLinkIds('/billing?recurring=12')).toEqual({ profile: 12 });
    expect(billingLinkIds('/billing?tab=cn&note=5')).toEqual({ note: 5 });
    expect(billingLinkIds('/sales?order=4')).toEqual({});
    expect(billingLinkIds('/billing?invoice=abc')).toEqual({});
  });
});

describe('billing notices: where each opens', () => {
  it('opens the invoice, the payment, the note or the profile from the event’s data', () => {
    expect(billingNoticeOf({ event: 'billing.issued', data: { invoice_id: 361 } })).toMatchObject({ route: '/billing?tab=inv&invoice=361', action: 'Open invoice' });
    expect(billingNoticeOf({ event: 'billing.viewed', link: '/billing?invoice=361' })!.route).toBe('/billing?tab=inv&invoice=361');
    expect(billingNoticeOf({ event: 'billing.paid', data: { invoice_id: '361' } })!.route).toBe('/billing?tab=inv&invoice=361');
    expect(billingNoticeOf({ event: 'billing.overdue', link: '/billing/invoices/361' })!.route).toBe('/billing?tab=inv&invoice=361');
    expect(billingNoticeOf({ event: 'billing.payment_received', data: { payment_id: 228, invoice_id: 361 } })).toMatchObject({ route: '/billing?tab=pay&payment=228', action: 'Open payment' });
    expect(billingNoticeOf({ event: 'billing.refund', data: { refund_id: 230 } })).toMatchObject({ route: '/billing?tab=pay&payment=230', action: 'Open refund' });
    expect(billingNoticeOf({ event: 'billing.recurring_failed', link: '/billing?recurring=12' })).toMatchObject({ route: '/billing?tab=rec&profile=12', action: 'Open profile' });
    expect(billingNoticeOf({ event: 'billing.credit_issued', data: { credit_note_id: 5 } })).toMatchObject({ route: '/billing?tab=cn&note=5', action: 'Open credit note' });
  });

  it('falls back to the invoice, then to the list, when the record is not named', () => {
    expect(billingNoticeOf({ event: 'billing.payment_received', data: { invoice_id: 361 } })).toMatchObject({ route: '/billing?tab=inv&invoice=361', action: 'Open invoice' });
    expect(billingNoticeOf({ event: 'billing.payment_received' })!.route).toBe('/billing?tab=pay');
    expect(billingNoticeOf({ event: 'billing.overdue' })!.route).toBe('/billing?tab=inv');
    expect(billingNoticeOf({ event: 'billing.recurring_failed' })!.route).toBe('/billing?tab=rec');
    expect(billingNoticeOf({ event: 'mail.received', data: { invoice_id: 1 } })).toBeNull();
  });

  it('routes stay inside the Billing tab', () => {
    for (const e of BILLING_EVENTS) {
      const r = billingNoticeOf({ event: `billing.${e}`, data: { invoice_id: 1, payment_id: 2, credit_note_id: 3, profile_id: 4 } })!.route;
      expect(resolveWebLink(r)).toMatchObject({ kind: 'tab', app: 'billing' });
    }
  });
});

describe('billing notices: the banner', () => {
  const make = (enabled = true) => {
    const shown: BillingBanner[] = [];
    const d = { notify: (n: BillingBanner) => void shown.push(n), markRead: vi.fn(async () => undefined), enabled: () => enabled, open: vi.fn() };
    return { b: new BillingBanners(d), d, shown };
  };

  it('claims a billing event and shows it with Open, which opens the record and marks it read', async () => {
    const { b, d, shown } = make();
    expect(b.claim({ id: '88', event: 'billing.paid', title: 'INV-00361 was paid', body: 'Green Leaf Hotels paid LKR 171,000.00', link: '/billing?invoice=361', category: 'billing', data: { invoice_id: 361 } })).toBe(true);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: '88', readId: '88', module: 'billing', title: 'INV-00361 was paid', link: '/billing?tab=inv&invoice=361', custom: { actions: ['Open invoice'] } });
    await shown[0]!.custom.onAction(0);
    expect(d.open).toHaveBeenCalledWith('/billing?tab=inv&invoice=361');
    expect(d.markRead).toHaveBeenCalledWith(['88']);
  });

  it('gives an untitled event its own title, and leaves others — or any while Billing is off — to the plain banner', () => {
    const { b, shown } = make();
    b.claim({ id: 'rt:1', event: 'billing.recurring_failed', title: ' ', body: '', link: null, category: null, data: { profile_id: 12 } });
    expect(shown[0]).toMatchObject({ title: 'A recurring invoice could not be raised', readId: null, category: 'billing', link: '/billing?tab=rec&profile=12' });
    expect(b.claim({ id: '2', event: 'oms.approval', title: 't', body: '', link: null, category: 'oms' })).toBe(false);
    const off = make(false);
    expect(off.b.claim({ id: '3', event: 'billing.paid', title: 't', body: '', link: null, category: 'billing' })).toBe(false);
    expect(off.shown).toHaveLength(0);
  });
});
