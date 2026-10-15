import { PURCHASE_API, PurchaseApprovalBanners } from '@shared/purchase';
import { logger } from '../main/log';
import type { ClaimedNotice, Incoming } from './notifications';

const log = logger('purchase-desk');

/**
 * WorkSuite Purchasing on this computer (SRS-PUR-001 G-21): approve from the banner, and the count of documents
 * waiting on me on the tray and the Dock badge.
 *
 *  - A purchase document waiting on my decision (`purchase.approval`: an order, a request, a return or a bill) arrives
 *    through the notification service, which hands it here (`claim`) instead of showing it plainly. Its banner has
 *    Approve and Open (shared/purchase.ts PurchaseApprovalBanners). Locked, or without the Purchasing app, a button
 *    opens the app instead (the notification service's rule for every banner with buttons); with content hidden there
 *    are no buttons.
 *  - The count is the cross-document queue as the server builds it (`GET /api/purchase/approvals?mine=1`), asked with
 *    the other counts, when an approval event arrives, and when access changes. A server from before that queue
 *    answers 404: the count is then nothing, and is not asked again until the next sign-in.
 */
export interface PurchaseDeskDeps {
  get: <T = unknown>(path: string, query?: Record<string, string | number>) => Promise<T>;
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  notify: (n: Incoming) => void;
  markRead: (ids: string[]) => Promise<void>;
  /** Signed in, unlocked, with the Purchasing app. */
  enabled: () => boolean;
  /** Opens a desktop route in the main window, as a banner's click does. */
  open: (route: string) => void;
  toast: (kind: 'success' | 'error' | 'info', text: string) => void;
  /** The count changed: the status (tray, Dock, title bar) is pushed again. */
  changed: () => void;
}

export class PurchaseDesk {
  private readonly banners: PurchaseApprovalBanners;
  private waiting = 0;
  private unsupported = false;
  private asking: Promise<void> | null = null;

  constructor(private readonly d: PurchaseDeskDeps) {
    this.banners = new PurchaseApprovalBanners({
      post: (path, body) => d.post(path, body),
      notify: (n) => d.notify(n),
      markRead: (ids) => d.markRead(ids),
      enabled: () => d.enabled(),
      open: (route) => d.open(route),
      refreshCounts: () => void this.refresh(),
      toast: (kind, text) => {
        if (kind === 'error') log.debug('approve from a banner failed', { text: text.slice(0, 200) });
        d.toast(kind, text);
      },
    });
  }

  /** True when the notification is a purchase approval waiting on me, now shown here with Approve and Open. */
  claim(n: ClaimedNotice): boolean {
    return this.banners.claim(n);
  }

  /** The realtime events that change the count. */
  handle(e: { type?: string }): void {
    this.banners.handle(e);
  }

  /** Documents waiting on my decision (0 without the app). */
  count(): number {
    return this.d.enabled() ? this.waiting : 0;
  }

  /** Ask the server for the count again; one question at a time. */
  refresh(): Promise<void> {
    if (!this.d.enabled() || this.unsupported) {
      if (this.waiting) {
        this.waiting = 0;
        this.d.changed();
      }
      return Promise.resolve();
    }
    this.asking ??= this.d
      .get<{ approvals?: unknown[]; total?: number | string; count?: number | string } | unknown[]>(`${PURCHASE_API}/approvals`, { mine: 1 })
      .then((r) => {
        const n = Array.isArray(r) ? r.length : Number(r?.total ?? r?.count ?? (Array.isArray(r?.approvals) ? r.approvals.length : 0));
        const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        if (next !== this.waiting) {
          this.waiting = next;
          this.d.changed();
        }
      })
      .catch((e: unknown) => {
        const status = (e as { status?: number }).status;
        if (status === 404) this.unsupported = true;
        log.debug('purchase approvals count failed', { status });
      })
      .finally(() => {
        this.asking = null;
      });
    return this.asking;
  }

  /** Signed out, or another account: nothing is waiting, and a new server is asked afresh. */
  reset(): void {
    this.unsupported = false;
    if (this.waiting) {
      this.waiting = 0;
      this.d.changed();
    }
  }
}
