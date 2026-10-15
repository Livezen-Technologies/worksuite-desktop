import { apiGet, apiPost, request } from '../../core/api';

/**
 * Shipping and own-fleet delivery (WS-OMS-SRS-001 §11; the "oms-ship" server API): what the Shipping desk (D-13) and
 * the Dispatch board (D-14) read and write. A shipment hangs off an Inventory delivery note; booking it with a courier
 * dispatches that note. Booking carries an Idempotency-Key, so a retry returns the same tracking number (AC-17).
 */
export type ShipmentState = 'draft' | 'booked' | 'label_printed' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'returned' | 'cancelled';

export interface Shipment {
  id: number;
  number: string;
  org_id: number | null;
  order: { id: number; number: string } | null;
  delivery: { id: number; number: string } | null;
  courier: { account_id: number; driver: string; name: string } | null;
  service_code: string | null;
  state: ShipmentState;
  tracking_no: string | null;
  tracking_url: string | null;
  cod_amount: number | null;
  currency: string | null;
  parcels_count: number;
  weight_kg: number | null;
  ship_to: { name?: string | null; phone?: string | null; line1?: string | null; city?: string | null; district?: string | null } | null;
  booked_at: string | null;
  exception: { code: string; description: string; at: string } | null;
  can?: Partial<Record<'book' | 'cancel' | 'label' | 'action' | 'pickup', boolean>>;
}

export interface Rate {
  account_id: number;
  driver: string;
  courier: string;
  service_code: string;
  service: string;
  price: number;
  currency: string;
  transit_days: number | null;
  error?: string | null;
}

export interface DeliveryHit {
  id: number;
  dn_number: string;
  status: string;
  so_id: number | null;
  so_number?: string | null;
  client?: string | null;
  client_name?: string | null;
  ship_to?: string | null;
  phone?: string | null;
}

export interface DeliveryLine {
  id: number;
  product_id: number | null;
  code: string | null;
  product_name: string | null;
  description: string | null;
  quantity: number | string;
  unit: string | null;
  tracking?: string | null;
}

export const KS = {
  today: (date: string) => ['sales', 'shipments', 'today', date] as const,
  live: (date: string) => ['sales', 'routes', 'live', date] as const,
};

/** A delivery note by the number on its barcode: Inventory's list, searched. */
export async function findDelivery(code: string, signal?: AbortSignal): Promise<DeliveryHit | null> {
  const r = await apiGet<{ deliveries?: DeliveryHit[]; rows?: DeliveryHit[] }>('/api/inventory/deliveries', { q: code, per_page: 5 }, signal);
  const list = r.deliveries ?? r.rows ?? [];
  return list.find((d) => d.dn_number.toLowerCase() === code.trim().toLowerCase()) ?? null;
}

export const fetchDelivery = (id: number, signal?: AbortSignal) => apiGet<{ delivery: DeliveryHit & Record<string, unknown>; lines: DeliveryLine[] }>(`/api/inventory/deliveries/${id}`, undefined, signal);

/** The shipment already made for a delivery note, if any (not a cancelled one). */
export async function shipmentFor(deliveryNumber: string, signal?: AbortSignal): Promise<Shipment | null> {
  const r = await apiGet<{ shipments?: Shipment[]; rows?: Shipment[] }>('/api/oms/shipments', { q: deliveryNumber, per_page: 5 }, signal);
  return (r.shipments ?? r.rows ?? []).find((s) => s.delivery?.number === deliveryNumber && s.state !== 'cancelled') ?? null;
}

export interface Parcel {
  weight_kg: number;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
}

export const createShipment = (body: { delivery_id: number; parcels: Parcel[]; cod_amount?: number | null }) => apiPost<{ shipment: Shipment }>('/api/oms/shipments', body).then((r) => r.shipment);
export const updateShipment = (id: number, body: { parcels: Parcel[] }) => request<{ shipment: Shipment }>('PUT', `/api/oms/shipments/${id}`, { body }).then((r) => r.data.shipment);
export const fetchRates = (id: number) => apiPost<{ rates: Rate[] }>(`/api/oms/shipments/${id}/rates`, {}).then((r) => r.rates ?? []);
/** Book: the key makes a retry the same booking (AC-17). */
export const bookShipment = (id: number, rate: Pick<Rate, 'account_id' | 'service_code'>, key: string) =>
  request<{ shipment: Shipment }>('POST', `/api/oms/shipments/${id}/book`, { body: { account_id: rate.account_id, service_code: rate.service_code }, headers: { 'Idempotency-Key': key } }).then((r) => r.data.shipment);

/** Today's shipments from this desk's company: the "Packed today" list. */
export const fetchShipmentsOn = (date: string, org: string, signal?: AbortSignal) =>
  apiGet<{ shipments?: Shipment[]; rows?: Shipment[] }>('/api/oms/shipments', { from: date, to: date, per_page: 100, ...(org ? { org } : {}) }, signal).then((r) => r.shipments ?? r.rows ?? []);

/** Close the day: one PDF of the day's labels and its manifest, in pick order. */
export const manifest = (ids: number[]) => apiPost<{ url: string | null; file_id: string | number | null }>('/api/oms/labels/batch', { shipment_ids: ids, format: 'pdf_a4', manifest: true });

// ── own fleet: the dispatch board ────────────────────────────────────────

export type StopState = 'pending' | 'arrived' | 'delivered' | 'failed' | 'skipped';

export interface Stop {
  id: number;
  seq: number;
  delivery: { id: number; number: string } | null;
  order: { id: number; number: string } | null;
  customer: string | null;
  address: string | null;
  phone: string | null;
  window_from: string | null;
  window_to: string | null;
  eta: string | null;
  state: StopState;
  cod_amount: number | null;
  cash_collected: number | null;
  /** Why it failed, from the driver (`POST stops/{id}/failed {reason}`). */
  reason?: string | null;
}

export interface Route {
  id: number;
  date: string;
  name?: string | null;
  vehicle: { id: number; name: string; plate?: string | null } | string | null;
  driver: { id: number; name: string } | null;
  state: 'planned' | 'sent' | 'loading' | 'on_road' | 'done' | 'back' | string;
  stops: Stop[];
  totals: { stops: number; done: number; failed: number; cod_expected: number; cod_collected: number };
  /** Scanned onto the vehicle while loading, of how many parcels. */
  loaded?: { scanned: number; parcels: number } | null;
  back_eta?: string | null;
  cash_handed_in?: number | null;
}

export const fetchLiveRoutes = (date: string, org: string, signal?: AbortSignal) =>
  apiGet<{ routes: Route[]; unplanned?: Stop[] }>('/api/oms/routes/live', { date, ...(org ? { org } : {}) }, signal);

export const vehicleName = (v: Route['vehicle']) => (!v ? '—' : typeof v === 'string' ? v : v.plate || v.name);

/** The board's figures for the day: stops done of all, and the cash collected (per route, summed; one currency). */
export function dayTotals(routes: Route[]): { stops: number; done: number; failed: number; cash: number } {
  return routes.reduce((t, r) => ({ stops: t.stops + r.totals.stops, done: t.done + r.totals.done, failed: t.failed + r.totals.failed, cash: t.cash + (r.totals.cod_collected || 0) }), { stops: 0, done: 0, failed: 0, cash: 0 });
}

/** How a route reads on the board: on the road, back, loading, or with a failure to see to. */
export function routeTone(r: Route): { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' } {
  if (r.totals.failed > 0 && r.state !== 'back' && r.state !== 'done') return { label: `${r.totals.failed} failed`, tone: 'bad' };
  if (r.state === 'back' || r.state === 'done') return { label: 'Back', tone: 'ok' };
  if (r.state === 'loading') return { label: 'Loading', tone: 'warn' };
  if (r.state === 'on_road' || r.state === 'sent') return { label: 'On the road', tone: 'idle' };
  return { label: 'Planned', tone: 'idle' };
}
