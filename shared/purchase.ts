import { z } from 'zod';

/**
 * WorkSuite Purchasing on this computer (SRS-PUR-001 G-21): what the main process does for the Purchasing app.
 *
 *  - A purchase document waiting on my decision (an order, a request, a return or a bill; `purchase.approval`) arrives
 *    through the notification service, which hands it here instead of showing it plainly. Its banner has Approve and
 *    Open. Approve decides my step through the document's own approve call — the Approve button's, behind the same
 *    permission and the same rules (one person, one step; never my own document) — and a refusal opens the document
 *    with the reason, so nothing is decided by accident. Open opens the document in the Purchasing tab.
 *  - The count of documents waiting on me (`GET /api/purchase/approvals?mine=1`) is on the tray and the Dock badge.
 *  - Exports (a report as CSV, XLSX or PDF; a payment run's bank file as CSV or ISO 20022 pain.001) download through
 *    the download manager from addresses this file builds, never from a path the page wrote.
 *
 * Plain data, shared by the main process (electron/services/purchase-desk.ts), the IPC contract and the Purchasing
 * screens (src/modules/purchase).
 */

export const PURCHASE_API = '/api/purchase';

/** The documents that go through Purchasing's approval chain (`purchase_approvals`, `buildChain()`/`decide()`). */
export const APPROVAL_DOCS = ['order', 'request', 'return', 'bill'] as const;
export type ApprovalDoc = (typeof APPROVAL_DOCS)[number];

/** The server's events for a purchase document waiting on a decision of mine. */
const APPROVAL_EVENTS = new Set(['purchase.approval', 'purchase.approval_required', 'purchase.approval.waiting', 'inventory.approval', 'inventory.purchase.approval']);

export const isPurchaseApprovalEvent = (event: string | null | undefined): boolean => APPROVAL_EVENTS.has((event ?? '').toLowerCase().trim());

/** The banner's buttons, in order: what the server names them, else these. */
export const PURCHASE_APPROVAL_ACTIONS = ['Approve', 'Open'] as const;

const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** `po`, `purchase_order`, `orders`, `vendor_bill`… → the document kind; null for anything else. */
export function docOf(v: unknown): ApprovalDoc | null {
  const t = typeof v === 'string' ? v.toLowerCase().trim() : '';
  if (['order', 'orders', 'po', 'purchase_order', 'purchase-order', 'purchase-orders'].includes(t)) return 'order';
  if (['request', 'requests', 'pr', 'purchase_request', 'requisition'].includes(t)) return 'request';
  if (['return', 'returns', 'purchase_return'].includes(t)) return 'return';
  if (['bill', 'bills', 'vendor_bill'].includes(t)) return 'bill';
  return null;
}

/** Where a document opens in the Purchasing app. */
export function purchaseRoute(doc: ApprovalDoc, id: number): string {
  if (doc === 'order') return `/purchase?tab=po&po=${id}`;
  if (doc === 'request') return `/purchase?tab=req&request=${id}`;
  if (doc === 'return') return `/purchase?tab=ret&return=${id}`;
  return `/purchase?tab=bill&bill=${id}`;
}

/**
 * The document a Purchasing link names, however the server or the web wrote it: `/purchase/orders/12`,
 * `/purchase?po=12`, `/purchase?tab=bill&bill=4`, `/purchase/requests/3`…
 */
export function purchaseLinkDoc(link: string | null | undefined): { doc: ApprovalDoc; id: number } | null {
  const m = /^\/purchase(\/[^?#]*)?(?:\?([^#]*))?/.exec(link ?? '');
  if (!m) return null;
  const path = (m[1] ?? '').split('/').filter(Boolean);
  if (path.length >= 2) {
    const doc = docOf(path[0]);
    const id = posInt(path[1]);
    if (doc && id) return { doc, id };
  }
  const q = new URLSearchParams(m[2] ?? '');
  for (const [key, doc] of [['po', 'order'], ['order', 'order'], ['request', 'request'], ['return', 'return'], ['bill', 'bill']] as const) {
    const id = posInt(q.get(key));
    if (id) return { doc, id };
  }
  return null;
}

/** The address a decision goes to: the document's own approve or reject (a bill's is its `decide`). */
export function decisionPath(doc: ApprovalDoc, id: number, decision: 'approve' | 'reject'): string {
  if (doc === 'bill') return `/api/inventory/bills/${id}/decide`;
  const seg = doc === 'order' ? 'orders' : doc === 'request' ? 'requests' : 'returns';
  return `${PURCHASE_API}/${seg}/${id}/${decision}`;
}

/** The body a decision sends: a bill's `decide` takes `approve`; the others a note, and my step when it is known. */
export function decisionBody(doc: ApprovalDoc, decision: 'approve' | 'reject', o: { note?: string | null; step?: number | null } = {}): Record<string, unknown> {
  const note = o.note?.trim() ? o.note.trim().slice(0, 500) : undefined;
  if (doc === 'bill') return { approve: decision === 'approve', ...(note ? { note } : {}) };
  return { ...(note ? { note } : {}), ...(o.step ? { step: o.step } : {}) };
}

export interface PurchaseApprovalNotice {
  doc: ApprovalDoc;
  id: number;
  step: number | null;
  labels: [string, string];
}

/**
 * Whether a notification is a purchase document waiting on my decision, and which. The server sends the document in
 * `data` (`doc` and `id`, or `order_id` / `request_id` / `return_id` / `bill_id`) with the step, and the buttons as
 * `actions: [{id: "approve", label}, {id: "open"}]`; an older one only the link.
 */
export function purchaseApprovalOf(n: { event: string | null | undefined; link?: string | null; actions?: unknown; data?: unknown }): PurchaseApprovalNotice | null {
  if (!isPurchaseApprovalEvent(n.event)) return null;
  const data = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : {};
  const actions = Array.isArray(n.actions) ? (n.actions.filter((a) => a && typeof a === 'object') as Array<Record<string, unknown>>) : [];
  const approve = actions.find((a) => a.id === 'approve');
  const open = actions.find((a) => a.id === 'open');
  let found: { doc: ApprovalDoc; id: number } | null = null;
  const doc = docOf(data.doc ?? data.document ?? data.entity_type);
  const id = posInt(data.id ?? data.entity_id);
  if (doc && id) found = { doc, id };
  for (const [key, d] of [['order_id', 'order'], ['po_id', 'order'], ['request_id', 'request'], ['return_id', 'return'], ['bill_id', 'bill']] as const) {
    if (found) break;
    const v = posInt(data[key]);
    if (v) found = { doc: d, id: v };
  }
  found ??= purchaseLinkDoc(n.link ?? null);
  if (!found) return null;
  const step = posInt(data.step) ?? posInt(approve?.step);
  const label = (a: Record<string, unknown> | undefined, d: string) => (typeof a?.label === 'string' && a.label.trim() ? a.label.trim().slice(0, 40) : d);
  return { ...found, step, labels: [label(approve, PURCHASE_APPROVAL_ACTIONS[0]), label(open, PURCHASE_APPROVAL_ACTIONS[1])] };
}

/** A notification as the notification service hands it to a module to show its own way (its `ClaimedNotice`). */
export interface PurchaseApprovalClaim {
  id: string;
  event: string | null;
  title: string;
  body: string;
  link: string | null;
  category: string | null;
  actions?: unknown;
  data?: unknown;
}

/** The banner shown for it: the notification service's `Incoming`, with its own buttons. */
export interface PurchaseApprovalBanner {
  id: string;
  readId: string | null;
  module: 'purchase';
  category: string;
  title: string;
  body: string;
  sender: null;
  link: string;
  critical: false;
  custom: { actions: string[]; onAction: (index: number) => Promise<void> };
}

export interface PurchaseApprovalDeps {
  /** The API, as this process calls it (the session's credentials). */
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  notify: (n: PurchaseApprovalBanner) => void;
  markRead: (ids: string[]) => Promise<void>;
  /** Signed in, unlocked, with the Purchasing app. */
  enabled: () => boolean;
  open: (route: string) => void;
  refreshCounts: () => void;
  toast: (kind: 'success' | 'error', text: string) => void;
  /** How long a burst of approval events waits before the count is asked again. */
  settleMs?: number;
}

const DOC_WORD: Record<ApprovalDoc, string> = { order: 'order', request: 'request', return: 'return', bill: 'bill' };

/**
 * Approve from the banner (SRS-PUR-001 G-21, G-14). `claim` takes a purchase document waiting on me and shows it with
 * Approve and Open; Approve decides my step through the document's own approve call, with the step the banner was
 * about, marks the bell's entry read and asks for the count again. A refusal (`self_approval`, `already_decided`, the
 * document moved on) opens the document with the reason.
 */
export class PurchaseApprovalBanners {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: PurchaseApprovalDeps) {}

  claim(n: PurchaseApprovalClaim): boolean {
    const a = purchaseApprovalOf(n);
    if (!a || !this.d.enabled()) return false;
    const readId = /^\d+$/.test(n.id) ? n.id : null;
    const route = purchaseRoute(a.doc, a.id);
    this.d.notify({
      id: n.id,
      readId,
      module: 'purchase',
      category: n.category ?? 'purchasing',
      title: n.title,
      body: n.body,
      sender: null,
      link: route,
      critical: false,
      custom: {
        actions: [...a.labels],
        onAction: async (index) => {
          if (index === 0) {
            await this.approve(a, readId);
            return;
          }
          this.d.open(route);
          if (readId) await this.d.markRead([readId]).catch(() => undefined);
        },
      },
    });
    return true;
  }

  async approve(a: Pick<PurchaseApprovalNotice, 'doc' | 'id' | 'step'>, readId: string | null): Promise<boolean> {
    try {
      const r = await this.d.post<{ status?: string; approval?: { status?: string } } | null>(decisionPath(a.doc, a.id, 'approve'), decisionBody(a.doc, 'approve', { step: a.step }));
      if (readId) await this.d.markRead([readId]).catch(() => undefined);
      this.d.refreshCounts();
      const done = r?.approval?.status === 'approved' || r?.status === 'approved';
      this.d.toast('success', done ? `Approved — the ${DOC_WORD[a.doc]} goes on.` : 'Your step is approved.');
      return true;
    } catch (e) {
      this.d.open(purchaseRoute(a.doc, a.id));
      this.d.toast('error', `Not approved: ${e instanceof Error && e.message ? e.message : 'the server refused it'}`);
      return false;
    }
  }

  /** The realtime events that change the count (`purchase.approval*`, `purchase.badge`): asked again once for a burst. */
  handle(e: { type?: string }): void {
    const t = e.type ?? '';
    if ((t !== 'purchase.badge' && !t.startsWith('purchase.approval')) || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.d.refreshCounts();
    }, this.d.settleMs ?? 1500);
    (this.timer as { unref?: () => void }).unref?.();
  }
}

// ── exports (G-20, G-27) ────────────────────────────────────────────────

export const PURCHASE_REPORTS = ['spend', 'department-spend', 'project-spend', 'cycle-time', 'rfq-savings', 'maverick', 'vendor-performance', 'price-trend', 'committed'] as const;
export type PurchaseReport = (typeof PURCHASE_REPORTS)[number];

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** What the page may ask the download manager to fetch for Purchasing: a report, or a payment run's bank file. */
export const purchaseExportSchema = z.union([
  z.strictObject({
    what: z.literal('report'),
    report: z.enum(PURCHASE_REPORTS),
    format: z.enum(['csv', 'xlsx', 'pdf']),
    from: ymd.optional(),
    to: ymd.optional(),
    org: z.string().regex(/^(\d+(,\d+)*)?$/).optional(),
    by: z.string().regex(/^[a-z_]{1,30}$/).optional(),
  }),
  z.strictObject({ what: z.literal('payment-run'), run: z.number().int().positive(), format: z.enum(['csv', 'pain001']) }),
]);
export type PurchaseExport = z.infer<typeof purchaseExportSchema>;

/** The server's address for an export: `/api/purchase/reports/{name}/export?…` or `/payment-runs/{id}/export?format=…`. */
export function purchaseExportPath(x: PurchaseExport): string {
  if (x.what === 'payment-run') return `${PURCHASE_API}/payment-runs/${x.run}/export?format=${x.format}`;
  const params = new URLSearchParams({ format: x.format });
  for (const k of ['from', 'to', 'org', 'by'] as const) if (x[k]) params.set(k, String(x[k]));
  return `${PURCHASE_API}/reports/${x.report}/export?${params}`;
}

/** The file an export is saved as: a pain.001 is XML. */
export function purchaseExportName(x: PurchaseExport, label: string, today = new Date().toISOString().slice(0, 10)): string {
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
  if (x.what === 'payment-run') return `payment-run-${safe}.${x.format === 'pain001' ? 'xml' : 'csv'}`;
  return `purchasing-${safe}-${today}.${x.format}`;
}
