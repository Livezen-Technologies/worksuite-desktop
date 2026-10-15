/**
 * WorkSuite Billing on this computer (SRS-BIL-001 G-10, G-13): what the main process does for the Billing app.
 *
 *  - The eight `billing.*` events the server raises through Notifications (issued, viewed, paid, overdue,
 *    payment_received, refund, recurring_failed, credit_issued) are shown as native banners in Billing's words, and
 *    clicking one — or its Open button — opens the record it is about in the Billing tab: the invoice, the payment,
 *    the credit note or the recurring profile. The record is read from the event's own facts (`data.invoice_id`…),
 *    else from its link, so a link the web words its own way still lands on the right record here.
 *  - Exports (lists and reports as CSV, XLSX or PDF, a customer's statement) download through the download manager
 *    from addresses this file builds, never from a path the page wrote.
 *
 * Plain data, shared by the main process (electron/main), the IPC contract and the Billing screens.
 */

export const BILLING_EVENTS = ['issued', 'viewed', 'paid', 'overdue', 'payment_received', 'refund', 'recurring_failed', 'credit_issued'] as const;
export type BillingEvent = (typeof BILLING_EVENTS)[number];

type Record_ = 'invoice' | 'payment' | 'note' | 'profile';

/** What each event is about, and its banner's button. */
const ABOUT: Record<BillingEvent, { record: Record_; action: string; title: string }> = {
  issued: { record: 'invoice', action: 'Open invoice', title: 'Invoice issued' },
  viewed: { record: 'invoice', action: 'Open invoice', title: 'Invoice viewed' },
  paid: { record: 'invoice', action: 'Open invoice', title: 'Invoice paid' },
  overdue: { record: 'invoice', action: 'Open invoice', title: 'Invoice overdue' },
  payment_received: { record: 'payment', action: 'Open payment', title: 'Payment received' },
  refund: { record: 'payment', action: 'Open refund', title: 'Refund recorded' },
  recurring_failed: { record: 'profile', action: 'Open profile', title: 'A recurring invoice could not be raised' },
  credit_issued: { record: 'note', action: 'Open credit note', title: 'Credit note issued' },
};

/** `billing.issued`, `billing.invoice.issued`, `billing.invoice_paid`… → the event, or null for anything else. */
export function billingEventOf(event: string | null | undefined): BillingEvent | null {
  const e = (event ?? '').toLowerCase().trim();
  if (!e.startsWith('billing.')) return null;
  const rest = e
    .slice('billing.'.length)
    .replace(/^invoice[._]/, '')
    .replace(/\./g, '_');
  const alias: Record<string, BillingEvent> = { payment: 'payment_received', payment_recorded: 'payment_received', refunded: 'refund', payment_refunded: 'refund', credit_note_issued: 'credit_issued', recurring_error: 'recurring_failed' };
  const hit = (BILLING_EVENTS as readonly string[]).includes(rest) ? (rest as BillingEvent) : alias[rest];
  return hit ?? null;
}

const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The records a Billing link names, however the server or the web wrote it. */
export function billingLinkIds(link: string | null | undefined): Partial<Record<Record_, number>> {
  const out: Partial<Record<Record_, number>> = {};
  const m = /^\/billing(\/[^?#]*)?(?:\?([^#]*))?/.exec(link ?? '');
  if (!m) return out;
  const path = (m[1] ?? '').split('/').filter(Boolean);
  const q = new URLSearchParams(m[2] ?? '');
  const byPath: Record<string, Record_> = { invoices: 'invoice', invoice: 'invoice', payments: 'payment', payment: 'payment', 'credit-notes': 'note', notes: 'note', recurring: 'profile' };
  if (path.length >= 2 && byPath[path[0]!]) {
    const id = posInt(path[1]);
    if (id) out[byPath[path[0]!]!] = id;
  }
  const keys: Array<[string, Record_]> = [
    ['invoice', 'invoice'],
    ['payment', 'payment'],
    ['note', 'note'],
    ['credit_note', 'note'],
    ['recurring', 'profile'],
    ['profile', 'profile'],
  ];
  for (const [k, r] of keys) {
    const id = posInt(q.get(k));
    if (id && !out[r]) out[r] = id;
  }
  return out;
}

/** The Billing tab's own address for a record. */
export function billingRoute(record: Record_, id: number): string {
  if (record === 'invoice') return `/billing?tab=inv&invoice=${id}`;
  if (record === 'payment') return `/billing?tab=pay&payment=${id}`;
  if (record === 'note') return `/billing?tab=cn&note=${id}`;
  return `/billing?tab=rec&profile=${id}`;
}

export interface BillingNotice {
  event: BillingEvent;
  /** Where the banner opens: the record, or Billing's list for it when the event names none. */
  route: string;
  action: string;
  /** The banner's title when the server sent none. */
  title: string;
}

/**
 * A `billing.*` notification, read: which event, which record (from `data` first — `invoice_id`, `payment_id`,
 * `credit_note_id`/`note_id`, `profile_id`/`recurring_id` — then from the link), and where it opens. Null for any
 * other notification.
 */
export function billingNoticeOf(n: { event: string | null | undefined; link?: string | null; data?: unknown }): BillingNotice | null {
  const event = billingEventOf(n.event);
  if (!event) return null;
  const about = ABOUT[event];
  const d = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : {};
  const fromLink = billingLinkIds(n.link);
  const ids: Record<Record_, number | null> = {
    invoice: posInt(d.invoice_id) ?? fromLink.invoice ?? null,
    payment: posInt(d.payment_id) ?? posInt(d.refund_id) ?? fromLink.payment ?? null,
    note: posInt(d.credit_note_id) ?? posInt(d.note_id) ?? fromLink.note ?? null,
    profile: posInt(d.profile_id) ?? posInt(d.recurring_id) ?? fromLink.profile ?? null,
  };
  const own = ids[about.record];
  // A payment event without its payment still has its invoice; anything else falls back to the list it belongs in.
  const route = own
    ? billingRoute(about.record, own)
    : ids.invoice
      ? billingRoute('invoice', ids.invoice)
      : about.record === 'payment'
        ? '/billing?tab=pay'
        : about.record === 'note'
          ? '/billing?tab=cn'
          : about.record === 'profile'
            ? '/billing?tab=rec'
            : '/billing?tab=inv';
  return { event, route, action: own || !ids.invoice ? about.action : 'Open invoice', title: about.title };
}

/** A notification as the notification service hands it to a module (its `ClaimedNotice`). */
export interface BillingClaim {
  id: string;
  event: string | null;
  title: string;
  body: string;
  link: string | null;
  category: string | null;
  data?: unknown;
}

/** The banner shown for it: the notification service's `Incoming`, with its Open button. */
export interface BillingBanner {
  id: string;
  readId: string | null;
  module: 'billing';
  category: string;
  title: string;
  body: string;
  sender: null;
  link: string;
  critical: false;
  custom: { actions: string[]; onAction: (index: number) => Promise<void> };
}

export interface BillingBannerDeps {
  notify: (n: BillingBanner) => void;
  markRead: (ids: string[]) => Promise<void>;
  /** Signed in, unlocked, with the Billing app. */
  enabled: () => boolean;
  open: (route: string) => void;
}

/**
 * Billing's banners (G-10). `claim` takes a `billing.*` notification and shows it with one button that opens its
 * record in the Billing tab — the banner's click does the same, through its link — and marks the bell's entry read.
 * Without the Billing app, or locked, it is not claimed, and the plain banner (or none) follows the usual rules.
 */
export class BillingBanners {
  constructor(private readonly d: BillingBannerDeps) {}

  claim(n: BillingClaim): boolean {
    const b = billingNoticeOf(n);
    if (!b || !this.d.enabled()) return false;
    const readId = /^\d+$/.test(n.id) ? n.id : null;
    this.d.notify({
      id: n.id,
      readId,
      module: 'billing',
      category: n.category ?? 'billing',
      title: n.title?.trim() || b.title,
      body: n.body ?? '',
      sender: null,
      link: b.route,
      critical: false,
      custom: {
        actions: [b.action],
        onAction: async () => {
          this.d.open(b.route);
          if (readId) await this.d.markRead([readId]).catch(() => undefined);
        },
      },
    });
    return true;
  }
}

// ── exports (G-13) ──────────────────────────────────────────────────────

export interface BillingExport {
  what: 'invoices' | 'payments' | 'credit-notes' | 'customers' | 'report' | 'statement';
  report?: string;
  customer?: number;
  format: 'csv' | 'xlsx' | 'pdf';
  org?: string;
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}

/** The server's address for an export: `/api/billing/{list}/export`, `/reports/{name}/export`, or a statement. */
export function billingExportPath(x: BillingExport): string {
  const params = new URLSearchParams();
  for (const k of ['org', 'q', 'status', 'from', 'to'] as const) if (x[k]) params.set(k, String(x[k]));
  if (x.what === 'statement') {
    params.set('format', 'pdf');
    return `/api/billing/customers/${x.customer}/statement?${params}`;
  }
  params.set('format', x.format);
  const base = x.what === 'report' ? `/api/billing/reports/${x.report}` : `/api/billing/${x.what}`;
  return `${base}/export?${params}`;
}
