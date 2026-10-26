/**
 * Assets on the desktop's tray and notifications (WS-ASSET-SRS-001 T-07, T-17; the D03 board): which screen each
 * `asset.*` notice opens, the buttons its banner carries, and the alerts this computer raises itself from the
 * server's answers — a handover waiting for me to confirm, approvals waiting on me, a loan overdue — so they arrive
 * even when the Assets tab is closed. Pure: electron/services/assets-alerts.ts fetches and shows them.
 *
 * A banner's buttons only open the screen with the record in front of the person; nothing is approved or confirmed
 * from the banner itself.
 */

const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export const assetRoute = (asset: number, view?: string) => `/assets?asset=${asset}${view ? `&view=${view}` : ''}`;

/** The desktop link for an asset notification, or null when the key is not one of ours. */
export function assetNoticeLink(event: string | null | undefined, data?: unknown): string | null {
  if (!event || !event.startsWith('asset.')) return null;
  const d = obj(data);
  const asset = id(d.asset_id);
  if (event.startsWith('asset.request')) return id(d.request_id) ? `/assets?tab=requests&request=${id(d.request_id)}` : '/assets?tab=requests';
  if (event.startsWith('asset.transfer')) return '/assets?tab=transfers';
  if (event.startsWith('asset.disposal')) return '/assets?tab=disposals';
  if (event.startsWith('asset.licen')) return '/assets?tab=licences';
  if (event.startsWith('asset.booking')) return '/assets?tab=bookings';
  if (event.startsWith('asset.maintenance')) return asset ? assetRoute(asset, 'upkeep') : '/assets?tab=maintenance';
  if (event === 'asset.handover' || event === 'asset.assigned' || event === 'asset.acknowledge') return '/assets?tab=mine';
  if (event.startsWith('asset.return') || event.startsWith('asset.warranty')) return asset ? assetRoute(asset) : '/assets';
  return asset ? assetRoute(asset) : '/assets';
}

export interface AssetButtonNotice {
  buttons: Array<{ label: string; link: string }>;
}

/** The banner's buttons (D03): confirm a handover, open a transfer or request to decide, open a booking. */
export function assetNoticeActions(event: string | null | undefined, data?: unknown): AssetButtonNotice | null {
  if (!event || !event.startsWith('asset.')) return null;
  const d = obj(data);
  if (event === 'asset.handover' || event === 'asset.assigned' || event === 'asset.acknowledge') {
    const a = id(d.assignment_id);
    return { buttons: [{ label: 'I received it', link: a ? `/assets?tab=mine&confirm=${a}` : '/assets?tab=mine' }, { label: 'Something is wrong', link: '/assets?tab=mine&problem=1' }] };
  }
  if (event.startsWith('asset.transfer')) return { buttons: [{ label: 'Approve', link: '/assets?tab=transfers' }, { label: 'Open', link: '/assets?tab=transfers' }] };
  if (event.startsWith('asset.request')) return { buttons: [{ label: 'Open', link: assetNoticeLink(event, data)! }] };
  if (event.startsWith('asset.return') || event.startsWith('asset.booking')) return { buttons: [{ label: 'Open booking', link: '/assets?tab=bookings' }] };
  return null;
}

/** What the alerts read: my assets (`GET /api/assets/mine`) and, for approvers, the dashboard's counts. */
export interface AlertInput {
  mine?: { assets?: Array<{ id: number; asset_code?: string; name?: string; assignment_id?: number; acknowledged_at?: string | null; needs_acknowledgement?: boolean; acknowledge_required?: boolean; expected_return_at?: string | null }> } | null;
  dashboard?: { kpi?: { pending_requests?: number; pending_transfers?: number; due_maintenance?: number } } | null;
  /** 1.2's `GET approvals` counts: what waits on me alone. Preferred to the dashboard's company-wide counts. */
  approvals?: { counts?: { requests?: number; transfers?: number; disposals?: number } } | null;
}

export interface AssetAlert {
  /** Stable per subject (and day where it repeats), so each is shown once. */
  id: string;
  title: string;
  body: string;
  link: string;
}

/** The tray's Assets lines: how many things wait for me (D03 "Assets waiting for you"). */
export interface TrayAssets {
  waiting: number;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The alerts due today (`today` as YYYY-MM-DD, the person's own day), and the tray's count. */
export function assetAlerts(input: AlertInput, today: string): { alerts: AssetAlert[]; tray: TrayAssets } {
  const alerts: AssetAlert[] = [];
  let waiting = 0;
  for (const a of input.mine?.assets ?? []) {
    // Only where the server says a confirmation is wanted (Assets 1.1); an older server never asks.
    if ((a.needs_acknowledgement ?? a.acknowledge_required) && !a.acknowledged_at && a.assignment_id) {
      waiting++;
      alerts.push({ id: `assets:confirm:${a.assignment_id}`, title: `Please confirm your ${a.name ?? 'equipment'}`, body: `${a.asset_code ?? ''} was issued to you. Confirm you received it, or say what is wrong.`.trim(), link: `/assets?tab=mine&confirm=${a.assignment_id}` });
    }
    const due = a.expected_return_at?.slice(0, 10);
    if (due && /^\d{4}-\d{2}-\d{2}$/.test(due) && daysBetween(due, today) > 0) {
      waiting++;
      alerts.push({ id: `assets:overdue:${a.id}:${today}`, title: `Return overdue: ${a.name ?? a.asset_code ?? 'equipment'}`, body: `It was due back on ${due}.`, link: assetRoute(a.id) });
    }
  }
  const c = input.approvals?.counts;
  const k = c ? { pending_requests: c.requests ?? 0, pending_transfers: (c.transfers ?? 0) + (c.disposals ?? 0) } : input.dashboard?.kpi;
  const decide = (k?.pending_requests ?? 0) + (k?.pending_transfers ?? 0);
  if (decide > 0) {
    waiting += decide;
    alerts.push({ id: `assets:decide:${today}`, title: 'Assets waiting for you', body: [k?.pending_requests ? `${k.pending_requests} ${k.pending_requests === 1 ? 'request' : 'requests'}` : null, k?.pending_transfers ? `${k.pending_transfers} ${k.pending_transfers === 1 ? 'transfer' : 'transfers'}` : null].filter(Boolean).join(' and ') + ' to decide.', link: k?.pending_requests ? '/assets?tab=requests' : '/assets?tab=transfers' });
  }
  return { alerts, tray: { waiting } };
}

/**
 * Which Assets GET answers are kept in the encrypted offline cache (READ_CACHE): the register, each asset opened, my
 * assets and the lists, so the module opens read-only from this computer's copy. Never a licence key (revealing one is
 * logged by the server, and a copy here would outlive that), a document or a label file.
 */
const CACHED = /^\/api\/assets(?:\/(?:\d{1,12}|access|organizations|dashboard|mine|activity|reports|settings|requests|transfers|maintenance|licenses|licenses\/\d{1,12}\/seats|consumables|consumables\/\d{1,12}\/movements|audits|audits\/\d{1,12}|disposals|bookings|plans|vendors|employees|people|lookups\/[a-z]{1,20}))?$/;
export function assetsCached(path: string): boolean {
  return CACHED.test(path.split('?')[0]!);
}
