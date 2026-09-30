/**
 * Where things are in the Restaurant tab. The tab's own addresses are
 * `/restaurant?view=floor|order|bill|cashier|kitchen|expo|printers|outbox|approvals`
 * (`&order=<id>`, `&table=<id>`, `&type=takeaway`, `&station=<id>`); the
 * server's notification links (`/restaurant/orders/<id>`,
 * `/restaurant/kitchen?station=`, `/restaurant/cashier/<id>`,
 * `/restaurant/approvals?open=`) open the same screens. Read in one place, so a
 * deep link, a notification and a window's route agree.
 */
export type View = 'floor' | 'order' | 'bill' | 'cashier' | 'kitchen' | 'expo' | 'printers' | 'outbox' | 'approvals';

export const VIEWS: readonly View[] = ['floor', 'order', 'bill', 'cashier', 'kitchen', 'expo', 'printers', 'outbox', 'approvals'];

export interface Screen {
  view: View;
  order: number | null;
  table: number | null;
  station: number | null;
  takeaway: boolean;
  /** An order kept offline, by its uuid, before the server has it. */
  local: string | null;
}

const num = (v: string | null | undefined): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function screenOf(path: string[], query: URLSearchParams, mode = 'pos'): Screen {
  const base: Screen = { view: mode === 'kds' ? 'kitchen' : mode === 'expo' ? 'expo' : 'floor', order: null, table: null, station: num(query.get('station')), takeaway: query.get('type') === 'takeaway', local: null };
  const [, seg, id] = path;
  if (seg === 'orders' && num(id)) return { ...base, view: 'order', order: num(id) };
  if (seg === 'kitchen') return { ...base, view: 'kitchen' };
  if (seg === 'expo') return { ...base, view: 'expo' };
  if (seg === 'cashier') return { ...base, view: 'cashier' };
  if (seg === 'approvals') return { ...base, view: 'approvals' };
  const v = query.get('view') as View | null;
  const local = query.get('local');
  return {
    ...base,
    view: v && VIEWS.includes(v) ? v : base.view,
    order: num(query.get('order')),
    table: num(query.get('table')),
    local: local && /^[0-9a-f-]{36}$/i.test(local) ? local : null,
  };
}

/**
 * A screen's address, as a tab keeps it. Tab routes are plain paths — letters,
 * digits and `/_-.:?=&%` — so every value is percent-encoded.
 */
export function routeOf(view: View, params: Record<string, string | number | null | undefined> = {}): string {
  const parts = [`view=${view}`];
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `/restaurant?${parts.join('&')}`;
}
