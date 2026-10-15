// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The desktop's counting desk offline (counts kept here, queued, then sent) and Products in tabs (several products
 * open beside the list; closing one shows its neighbour).
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: (...a: unknown[]) => bridge.call(...a), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
const toast = vi.fn();
vi.mock('../../../src/core/toasts', () => ({ toast: (...a: unknown[]) => toast(...a) }));
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({
  ...(await orig<typeof CoreApi>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
}));

const { app } = await import('../../../src/core/app-state');
const { default: CountDesk } = await import('../../../src/modules/inventory/CountDesk');
const { default: ProductPane } = await import('../../../src/modules/inventory/ProductPane');
const { default: Product360 } = await import('../../../src/modules/inventory/Product360');
const { ApiError } = await import('../../../src/core/api');

const detail = {
  count: { id: 5, reference: 'CNT-00005', warehouse_id: 2, warehouse: 'Kandy Branch', kind: 'cycle', scope: 'category', status: 'counting', scheduled_for: null, started_at: '2026-10-15 08:30:00', posted_at: null, adjustment_id: null, variance_value: null, note: null, counted_by_name: null, line_count: 2, counted_lines: 0, variance_lines: 0, created_at: '2026-10-15 08:00:00' },
  lines: [
    { id: 1, product_id: 10, code: 'HP-85A', name: 'HP 85A Toner', variant_label: null, unit: null, tracking: 'none', bin: 'K-02-01', expected_qty: '9.0000', counted_qty: null, variance_qty: null, unit_cost: null, variance_value: null, on_hand_now: null, drifted: false },
    { id: 2, product_id: 11, code: 'HP-26A', name: 'HP 26A Toner', variant_label: null, unit: null, tracking: 'none', bin: 'K-02-02', expected_qty: '4.0000', counted_qty: null, variance_qty: null, unit_cost: null, variance_value: null, on_hand_now: null, drifted: false },
  ],
  drifted: 0,
};

let pending: Array<Record<string, unknown>> = [];

beforeEach(() => {
  for (const f of [apiGet, apiPost, apiPut, toast, bridge.call]) f.mockReset();
  pending = [];
  bridge.call.mockImplementation(async (channel: string, input?: Record<string, unknown>) => {
    switch (channel) {
      case 'offline:getDraft':
        return null;
      case 'offline:pending':
        return pending;
      case 'offline:submit':
        pending = [{ id: 'm1', module: 'inventory', entity: 'count', entityId: '5', label: input?.label, state: 'PENDING' }];
        return { delivered: false, queued: true, id: 'm1', status: null, data: null, error: null, code: null };
      case 'print:print':
        return true;
      default:
        return undefined;
    }
  });
  app.set({ status: { network: 'OFFLINE' } as never });
});
afterEach(() => {
  cleanup();
  app.set({ status: null as never });
});

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

describe('the counting desk', () => {
  it('counts offline: each scan adds one, the count is queued, and the line says so until it is sent', async () => {
    render(wrap(<CountDesk id={5} detail={detail as never} currency="LKR" onBack={vi.fn()} onOpenAdjustment={vi.fn()} />));
    expect(screen.getByText(/You're offline\./)).toBeTruthy();
    const post = screen.getByRole('button', { name: 'Post to stock (needs connection)' }) as HTMLButtonElement;
    expect(post.disabled).toBe(true);

    const box = screen.getByLabelText('Scan') as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    for (const code of ['HP-85A', 'hp-85a', 'LG-MK270']) {
      fireEvent.change(box, { target: { value: code } });
      fireEvent.keyDown(box, { key: 'Enter' });
    }
    expect(screen.getByText('LG-MK270 is not on CNT-00005. Nothing was counted.')).toBeTruthy();
    const row = document.querySelector('[data-count-line="HP-85A"]') as HTMLElement;
    expect((within(row).getByLabelText('Counted HP-85A') as HTMLInputElement).value).toBe('2');
    expect(within(row).getByText('on this computer')).toBeTruthy();
    expect(within(row).getByText('just scanned')).toBeTruthy();

    // Sent through the app's offline queue, as one write for the sheet.
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ module: 'inventory', entity: 'count', entityId: '5', method: 'PUT', path: '/api/inventory/counts/5/lines', body: { lines: [{ id: 1, counted_qty: 2 }] }, queueIfOffline: true })), { timeout: 3000 });
    await waitFor(() => expect(within(row).getByText('waiting to send')).toBeTruthy());
    expect(screen.getAllByText('CNT-00005 · 1 line count').length).toBeGreaterThan(0);
    // The draft store keeps it on this computer.
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('offline:saveDraft', expect.objectContaining({ module: 'inventory', context: 'count:5' })), { timeout: 3000 });
  });

  it('types a count straight into a line', async () => {
    render(wrap(<CountDesk id={5} detail={detail as never} currency={null} onBack={vi.fn()} onOpenAdjustment={vi.fn()} />));
    const input = screen.getByLabelText('Counted HP-26A') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const row = document.querySelector('[data-count-line="HP-26A"]') as HTMLElement;
    await waitFor(() => expect(within(row).getByText('−1')).toBeTruthy());
  });
});

describe('products in tabs', () => {
  it('shows a tab per open product, the one in front in full, and closes a tab', async () => {
    apiGet.mockImplementation(async (path: string) => {
      const id = Number(/products\/(\d+)/.exec(path)?.[1]);
      const name = id === 1 ? 'Dell Latitude 5440' : 'HP 85A Toner';
      if (/\/(trade|timeline)$/.test(path)) return { sales: [], purchases: [], moves: [] };
      return { product: { id, name, code: id === 1 ? 'DL-5440' : 'HP-85A', barcode: null, kind: 'product', tracking: id === 1 ? 'serial' : 'none', costing_method: 'fifo', is_stocked: true, active: true, unit_code: null, category: 'Laptops', variant_label: null }, levels: [], variants: [], attributes: [], bundle: [], prices: [], totals: { on_hand: 22, reserved: 4, incoming: 10, available: 18 }, consumption: null };
    });
    const onClose = vi.fn();
    const on360 = vi.fn();
    render(wrap(<ProductPane org="" ids={[1, 2]} active={1} ptab="overview" onActivate={vi.fn()} onClose={onClose} onTab={vi.fn()} onOpenProduct={vi.fn()} onEdit={null} on360={on360} />));
    await waitFor(() => expect(screen.getAllByRole('tab', { name: /Dell Latitude 5440|HP 85A Toner/ })).toHaveLength(2));
    expect(screen.getAllByRole('tab', { name: /Dell Latitude 5440|HP 85A Toner/ }).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    await screen.findByText(/^DL-5440 · /);
    fireEvent.click(screen.getByRole('button', { name: 'Close HP 85A Toner' }));
    expect(onClose).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Open 360' }));
    expect(on360).toHaveBeenCalledWith(1);
    // ⌘/Ctrl+P prints the label of the product in front.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open 360' }), { key: 'p', ctrlKey: true });
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('print:print', expect.objectContaining({ title: 'Label DL-5440' })));
  });
});

describe('Product 360', () => {
  const p360 = {
    product: { id: 7, name: 'Branded polo shirt', code: 'POLO', kind: 'variable', tracking: 'none', costing_method: 'average', unit_price: 2400, currency: 'LKR', image_url: null, is_stocked: true, active: true },
    completeness: { total: 74, sections: { general: 100, images: 60, seo: 40 } },
    counts: { on_hand: 140, incoming: 20, variants: 6, suppliers: 2, channels: 1 },
    pricing: { standard: 2400, currency: 'LKR', lists: [{ name: 'Portal', price: 2300 }], average_cost: null, last_change: null },
    channels: [{ key: 'portal', name: 'Portal (shop)', state: 'published', detail: 'Visible from 30 Sep' }],
    seo_health: { meta_title_len: 0, meta_description_state: 'missing', og_image: false, translations: [] },
    documents: [],
    activity: [],
  };
  const routes = (path: string) => {
    if (path.endsWith('/360')) return p360;
    if (path.endsWith('/media')) return { media: [{ id: 3, file_id: 9, url: '/inventory/products/7/media/3/file', thumb_url: null, mime: 'image/jpeg', bytes: 1, position: 0, role: 'primary', primary: true, alt: '', caption: null, variant_scope: null, variant_label: null, public: false, source: 'upload', external_url: null }], require_alt: true, limit: 12 };
    if (path.endsWith('/specs')) return { set: { id: 1, name: 'Apparel', source: 'category' }, groups: [{ name: 'Fabric', fields: [{ attribute_id: 4, name: 'Weight', kind: 'number', unit: 'gsm', required: true, value: 180 }, { attribute_id: 5, name: 'Colour', kind: 'colour', unit: null, required: false, value: 2, value_label: 'Black' }] }] };
    if (path.endsWith('/channels')) return { channels: [{ key: 'portal', name: 'Portal (shop)', state: 'draft', visible_from: null, visible_to: null, detail: null, validation: { ok: false, missing: [{ field: 'alt', message: 'Every public picture needs alt text', fix_tab: 'images' }] } }] };
    throw new Error(`unexpected ${path}`);
  };

  it('shows the overview, the gallery, specifications and channels, and saves a changed specification', async () => {
    apiGet.mockImplementation(async (path: string) => routes(path));
    apiPut.mockResolvedValue({ set: null, groups: [] });
    const onTab = vi.fn();
    const { rerender } = render(wrap(<Product360 id={7} tab="overview" currency="LKR" canCatalogue onTab={onTab} onBack={vi.fn()} onEdit={null} />));
    await screen.findByText('Branded polo shirt');
    expect(screen.getByText(/POLO · .* · 6 variants · completeness 74%/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pictures/ }));
    expect(onTab).toHaveBeenCalledWith('media');

    rerender(wrap(<Product360 id={7} tab="media" currency="LKR" canCatalogue onTab={onTab} onBack={vi.fn()} onEdit={null} />));
    await screen.findByText('Primary picture');
    // Alt text first: the picture cannot go public without it.
    expect((screen.getByRole('checkbox', { name: /Public/ }) as HTMLInputElement).disabled).toBe(true);

    rerender(wrap(<Product360 id={7} tab="channels" currency="LKR" canCatalogue onTab={onTab} onBack={vi.fn()} onEdit={null} />));
    await screen.findByText('Every public picture needs alt text');
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));
    expect(onTab).toHaveBeenLastCalledWith('media');

    rerender(wrap(<Product360 id={7} tab="specs" currency="LKR" canCatalogue onTab={onTab} onBack={vi.fn()} onEdit={null} />));
    const weight = (await screen.findByLabelText('Weight')) as HTMLInputElement;
    expect(screen.getByText('Black')).toBeTruthy();
    fireEvent.change(weight, { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/inventory/products/7/specs', { values: { '4': '200' } }));
  });

  it('says so when the server has no V2 product master yet', async () => {
    apiGet.mockRejectedValue(new ApiError(404, 'Not found', null));
    render(wrap(<Product360 id={7} tab="overview" currency={null} canCatalogue={false} onTab={vi.fn()} onBack={vi.fn()} onEdit={null} />));
    await screen.findByText(/Product 360 needs the V2 product master/);
  });
});
