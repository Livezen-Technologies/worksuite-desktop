import { z } from 'zod';
import { code128Encodable, code128Svg } from './code128';

/**
 * WorkSuite Sales (OMS) on this computer (WS-OMS-SRS-001 v1.1 FR-DSK-05/06, FR-LBL-06, FR-APR-10): what the main
 * process does for the Sales app that a page cannot do for itself.
 *
 *  - An approval's banner carries Approve and Open (`oms.approval`): Approve decides the step from the banner, through
 *    `POST /api/oms/orders/{id}/approve`, and the count of approvals waiting on me is on the tray and Dock badge.
 *  - Delivery notes and shipping labels print on this computer's own printers, one chosen per kind and remembered:
 *    a label as raw ZPL straight to a thermal printer, or as the server's PDF; a delivery note as a page laid out
 *    here from Inventory's own record of it (WorkSuite has no printable delivery note of its own yet).
 *  - A report is saved as the server's PDF wherever the person chooses.
 *
 * Plain data and zod schemas, shared by the main process (electron/services/sales-desk.ts), the IPC contract and the
 * Sales screens (src/modules/sales).
 */

export const OMS_API = '/api/oms';

/** The server's event for an order waiting on a decision of mine (Oms\Libraries\Notify::approval). */
export const APPROVAL_EVENT = 'oms.approval';

/** The banner's buttons, in order: what the server names them, else these. */
export const APPROVAL_ACTIONS = ['Approve', 'Open'] as const;

export interface ApprovalNotice {
  orderId: number;
  /** The step waiting on me, when the server said which: sent with the decision so a step somebody else took is not decided twice. */
  step: number | null;
  /** The buttons' words (the server's labels where it sent them). */
  labels: [string, string];
}

const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The order a link names: `/oms?order=12`, `/sales?order=12`, `/sales?tab=orders&order=12`. */
export function orderOfLink(link: string | null | undefined): number | null {
  const m = /^\/(?:oms|sales)(?:\/[^?#]*)?\?(?:[^#]*&)?order=(\d{1,12})(?:[&#]|$)/.exec(link ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Whether a notification is an approval waiting on me, and on which order and step. The server sends
 * `actions: [{id: "approve", label}, {id: "open"}]` with `order_id` and `step` (in `data`, or on the actions); an
 * older one only the link. Anything else — another event, no order to name — is not one.
 */
export function approvalNoticeOf(n: { event: string | null | undefined; link?: string | null; actions?: unknown; data?: unknown }): ApprovalNotice | null {
  const event = (n.event ?? '').toLowerCase();
  if (event !== APPROVAL_EVENT && event !== 'oms.approval_required' && event !== 'oms.approval.waiting') return null;
  const data = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : {};
  const actions = Array.isArray(n.actions) ? (n.actions.filter((a) => a && typeof a === 'object') as Array<Record<string, unknown>>) : [];
  const approve = actions.find((a) => a.id === 'approve');
  const open = actions.find((a) => a.id === 'open');
  const orderId = posInt(data.order_id) ?? posInt(approve?.order_id) ?? orderOfLink(n.link ?? null);
  if (!orderId) return null;
  const step = posInt(data.step) ?? posInt(approve?.step);
  const label = (a: Record<string, unknown> | undefined, d: string) => (typeof a?.label === 'string' && a.label.trim() ? a.label.trim().slice(0, 40) : d);
  return { orderId, step, labels: [label(approve, APPROVAL_ACTIONS[0]), label(open, APPROVAL_ACTIONS[1])] };
}

/** Where an approval's Open goes in the Sales app: the approvals queue with the order's drawer open. */
export const approvalRoute = (orderId: number) => `/sales?tab=appr&order=${orderId}`;

/** A notification as the notification service hands it to a module to show its own way (its `ClaimedNotice`). */
export interface ApprovalClaim {
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
export interface ApprovalBanner {
  id: string;
  readId: string | null;
  module: 'sales';
  category: string;
  title: string;
  body: string;
  sender: null;
  link: string;
  critical: false;
  custom: { actions: string[]; onAction: (index: number) => Promise<void> };
}

export interface ApprovalBannerDeps {
  /** The API, as this process calls it (the session's credentials). */
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  notify: (n: ApprovalBanner) => void;
  markRead: (ids: string[]) => Promise<void>;
  /** Signed in, unlocked, with the Sales app. */
  enabled: () => boolean;
  open: (route: string) => void;
  refreshCounts: () => void;
  toast: (kind: 'success' | 'error', text: string) => void;
  /** How long a burst of approval events waits before the count is asked again. */
  settleMs?: number;
}

/**
 * Approve from the banner (FR-APR-10, FR-DSK-05). `claim` takes an approval waiting on me and shows it with Approve and
 * Open; Approve decides my step through `POST /api/oms/orders/{id}/approve` — the Approve button's own call, behind its
 * permission — with the step the banner was about, marks the bell's entry read and asks for the count again. A refusal
 * (the step was taken, the order moved on) opens the order with the reason: nothing is decided by accident.
 */
export class ApprovalBanners {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: ApprovalBannerDeps) {}

  claim(n: ApprovalClaim): boolean {
    const a = approvalNoticeOf(n);
    if (!a || !this.d.enabled()) return false;
    const readId = /^\d+$/.test(n.id) ? n.id : null;
    const route = approvalRoute(a.orderId);
    this.d.notify({
      id: n.id,
      readId,
      module: 'sales',
      category: n.category ?? 'oms',
      title: n.title,
      body: n.body,
      sender: null,
      link: route,
      critical: false,
      custom: {
        actions: [...a.labels],
        onAction: async (index) => {
          if (index === 0) {
            await this.approve(a.orderId, a.step, readId);
            return;
          }
          this.d.open(route);
          if (readId) await this.d.markRead([readId]).catch(() => undefined);
        },
      },
    });
    return true;
  }

  async approve(orderId: number, step: number | null, readId: string | null): Promise<boolean> {
    try {
      const r = await this.d.post<{ status?: string } | null>(`${OMS_API}/orders/${orderId}/approve`, step ? { step } : {});
      if (readId) await this.d.markRead([readId]).catch(() => undefined);
      this.d.refreshCounts();
      this.d.toast('success', r?.status === 'approved' ? 'Approved — the order goes on.' : 'Your step is approved.');
      return true;
    } catch (e) {
      this.d.open(approvalRoute(orderId));
      this.d.toast('error', `Not approved: ${e instanceof Error && e.message ? e.message : 'the server refused it'}`);
      return false;
    }
  }

  /** The realtime events that change the count (`oms.approval.*`, `oms.badge`): asked again once for a burst. */
  handle(e: { type?: string }): void {
    const t = e.type ?? '';
    if ((t !== 'oms.badge' && !t.startsWith('oms.approval')) || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.d.refreshCounts();
    }, this.d.settleMs ?? 1500);
    (this.timer as { unref?: () => void }).unref?.();
  }
}

// ── printing ──────────────────────────────────────────────────────────────

export const LABEL_FORMATS = ['zpl', 'pdf'] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];

/** This computer's printers for Sales, per server: which printers are plugged in is a fact about this computer. */
export interface SalesPrintSettings {
  /** Delivery notes and manifests (A4). Null: the system's default, with its dialog. */
  note_printer: string | null;
  /** Shipping labels (4×6 in / A6). */
  label_printer: string | null;
  /** How labels reach the label printer: raw ZPL (a Zebra, or any printer that speaks it) or the server's PDF. */
  label_format: LabelFormat;
  /** Print without the system's dialog, to the printer chosen. */
  silent: boolean;
  /** Print the label by itself once a shipment is booked at the Shipping desk. */
  auto_label: boolean;
}

export const DEFAULT_SALES_PRINT: SalesPrintSettings = { note_printer: null, label_printer: null, label_format: 'zpl', silent: true, auto_label: true };

const printerName = z.string().trim().min(1).max(200);

export const salesPrintPatch = z.strictObject({
  note_printer: printerName.nullable().optional(),
  label_printer: printerName.nullable().optional(),
  label_format: z.enum(LABEL_FORMATS).optional(),
  silent: z.boolean().optional(),
  auto_label: z.boolean().optional(),
});
export type SalesPrintPatch = z.infer<typeof salesPrintPatch>;

export interface SalesPrintOutcome {
  ok: boolean;
  printer: string | null;
  /** How it went out: raw bytes, the server's PDF through the system, or a page laid out here. */
  via: 'raw' | 'pdf' | 'page' | null;
  message: string;
  /** Printing here was not possible (no raw path for a PDF on this system): the file was saved and opened instead. */
  opened?: string | null;
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();

export const salesPrintNoteInput = z.strictObject({ delivery_id: id, copies: z.number().int().min(1).max(5).optional() });
export const salesPrintLabelInput = z.strictObject({
  shipment_id: id,
  /** A reprint says why (AC-20: the label keeps its tracking number; the server logs the reason). */
  reason: z.string().trim().max(200).optional(),
  format: z.enum(LABEL_FORMATS).optional(),
});

export const OMS_REPORTS = ['summary', 'sales', 'status', 'payment', 'aging', 'returns', 'coupons'] as const;
export const OMS_GROUPS = ['month', 'day', 'client', 'user', 'assignee', 'org', 'source', 'product', 'category', 'status', 'type', 'priority'] as const;

export const salesSaveReportInput = z.strictObject({
  report: z.enum(OMS_REPORTS),
  from: ymd,
  to: ymd,
  org: z.string().regex(/^(\d+(,\d+)*)?$/).optional(),
  group: z.enum(OMS_GROUPS).optional(),
  /** The file's suggested name, without its folder. */
  name: z.string().trim().min(1).max(160),
});
export type SalesSaveReport = z.infer<typeof salesSaveReportInput>;

/** The server's PDF of a report: `/api/oms/reports/{name}/export?format=pdf&…`. */
export function reportExportPath(r: Omit<SalesSaveReport, 'name'>, format: 'pdf' | 'csv' = 'pdf'): string {
  const q = new URLSearchParams({ format, from: r.from, to: r.to, ...(r.org ? { org: r.org } : {}), ...(r.report === 'sales' && r.group ? { group: r.group } : {}) });
  return `${OMS_API}/reports/${r.report}/export?${q.toString()}`;
}

/** The address of a shipment's label in the format the printer takes (`pdf_a6` for a 4×6 label). */
export function labelPath(shipmentId: number, format: LabelFormat, reason?: string): string {
  const q = new URLSearchParams({ format: format === 'zpl' ? 'zpl' : 'pdf_a6', ...(reason ? { reason } : {}) });
  return `${OMS_API}/shipments/${shipmentId}/labels?${q.toString()}`;
}

/** Whether bytes the server sent are ZPL a label printer can take raw: they open a label (`^XA`) and close it (`^XZ`). */
export function looksLikeZpl(text: string): boolean {
  const t = text.trim();
  return /^(\s*~[A-Z]{2}[^\n]*\n)*\s*\^XA/i.test(t) && /\^XZ\s*$/i.test(t);
}

// ── the delivery note, as a page ─────────────────────────────────────────

export interface DeliveryRecord {
  id: number;
  dn_number: string;
  status?: string | null;
  delivery_date?: string | null;
  ship_to?: string | null;
  contact?: string | null;
  phone?: string | null;
  carrier?: string | null;
  tracking_no?: string | null;
  vehicle?: string | null;
  driver?: string | null;
  notes?: string | null;
  client_name?: string | null;
  so_number?: string | null;
}

export interface DeliveryLineRecord {
  code?: string | null;
  product_name?: string | null;
  description?: string | null;
  quantity: number | string;
  unit?: string | null;
  bin?: string | null;
  batch_no?: string | null;
  serials?: string | null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const qty = (v: number | string) => {
  const n = Number(v);
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)) : esc(v);
};

/**
 * A delivery note as a page: the note's number as a Code 128 barcode (what the Shipping desk scans back), who it goes
 * to, the lines with their bins, batches and serials, and space to sign. Every value is escaped; the page has no
 * script and needs nothing from the network (it prints in a window that allows neither).
 */
export function deliveryNoteHtml(d: DeliveryRecord, lines: DeliveryLineRecord[], o: { company?: string | null; printedAt?: string } = {}): string {
  const barcode = code128Encodable(d.dn_number) ? code128Svg(d.dn_number, { height: 44, module: 2 }) : '';
  const facts: Array<[string, unknown]> = [
    ['Order', d.so_number],
    ['Date', d.delivery_date],
    ['Carrier', [d.carrier, d.tracking_no].filter(Boolean).join(' · ')],
    ['Vehicle', [d.vehicle, d.driver].filter(Boolean).join(' · ')],
  ];
  const rows = lines
    .map((l, i) => {
      const extra = [l.bin ? `bin ${l.bin}` : '', l.batch_no ? `batch ${l.batch_no}` : '', l.serials ? `serials ${l.serials}` : ''].filter(Boolean).join(' · ');
      return `<tr><td class="n">${i + 1}</td><td><b>${esc(l.product_name ?? l.description ?? '')}</b>${l.code ? `<div class="m">${esc(l.code)}</div>` : ''}${extra ? `<div class="m">${esc(extra)}</div>` : ''}</td><td class="q">${qty(l.quantity)}${l.unit ? ` ${esc(l.unit)}` : ''}</td><td class="q"></td></tr>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.dn_number)}</title><style>
@page{size:A4;margin:14mm}body{font:12px/1.45 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:0}
h1{font-size:20px;margin:0}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.m{color:#555;font-size:11px}.box{border:1px solid #bbb;border-radius:6px;padding:8px 10px;margin-top:10px}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:#555}.q{text-align:right;width:70px}.n{width:22px;color:#777}
.sign{display:flex;gap:24px;margin-top:28px}.sign div{flex:1;border-top:1px solid #999;padding-top:4px;color:#555;font-size:11px}
</style></head><body>
<div class="top"><div>${o.company ? `<div class="m">${esc(o.company)}</div>` : ''}<h1>Delivery note ${esc(d.dn_number)}</h1>${d.status ? `<div class="m">${esc(d.status)}</div>` : ''}</div><div>${barcode}<div class="m" style="text-align:center">${esc(d.dn_number)}</div></div></div>
<div class="box"><b>${esc(d.client_name ?? '')}</b>${d.ship_to ? `<div>${esc(d.ship_to)}</div>` : ''}${d.contact || d.phone ? `<div class="m">${esc([d.contact, d.phone].filter(Boolean).join(' · '))}</div>` : ''}</div>
<div class="box">${facts.filter(([, v]) => v).map(([k, v]) => `<span class="m">${esc(k)}</span> ${esc(v)}`).join(' &nbsp; ')}</div>
<table><thead><tr><th></th><th>Item</th><th class="q">Qty</th><th class="q">Checked</th></tr></thead><tbody>${rows}</tbody></table>
${d.notes ? `<div class="box"><span class="m">Notes</span><div>${esc(d.notes)}</div></div>` : ''}
<div class="sign"><div>Packed by</div><div>Received by — name, signature, date</div></div>
${o.printedAt ? `<p class="m">Printed ${esc(o.printedAt)}</p>` : ''}
</body></html>`;
}

// ── the IPC contract ─────────────────────────────────────────────────────

const none = z.undefined().or(z.null()).optional();

export const salesContract = {
  'sales:printSettings': { input: none, session: true },
  'sales:printSettingsSet': { input: salesPrintPatch, session: true, rate: 5 },
  'sales:printNote': { input: salesPrintNoteInput, session: true, rate: 3 },
  'sales:printLabel': { input: salesPrintLabelInput, session: true, rate: 3 },
  'sales:saveReport': { input: salesSaveReportInput, session: true, permission: 'desktop.downloads', sensitive: true, rate: 2 },
  'sales:reveal': { input: z.strictObject({ path: z.string().min(1).max(1024) }), session: true, rate: 2 },
};

export interface SalesOutputs {
  'sales:printSettings': SalesPrintSettings;
  'sales:printSettingsSet': SalesPrintSettings;
  'sales:printNote': SalesPrintOutcome;
  'sales:printLabel': SalesPrintOutcome;
  /** Where it was saved; null when the person cancelled. */
  'sales:saveReport': string | null;
  'sales:reveal': boolean;
}
