// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  hasDesktop: () => true,
  DesktopError: class extends Error {},
  on: () => () => undefined,
  isMac: false,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { apiGetMeta, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { finishKey } = await import('../../../src/modules/pms/locks');
const { KeyPanel } = await import('../../../src/modules/pms/Keys');
const { PmsContext } = await import('../../../src/modules/pms/parts');

/**
 * Keys at the desk: an on-premise vendor's job WorkSuite answered is run on this computer's lock server and reported
 * back; a desk without one leaves it waiting (nothing reported); TTLock's passcode is shown once; the panel sends
 * the cards and common areas chosen.
 */

const PAYLOAD = {
  v: 1, log_id: 41, vendor: 'salto', connection: 'ship', operation: 'issue', property_id: 1, stay_id: 12, rooms: ['101'], room_numbers: ['101'], common_areas: [],
  valid_from: '2026-09-18 14:05', valid_until: '2026-09-21 12:00', timezone: 'Asia/Colombo', guest_name: 'Dilani', cards: 2, kind: 'new', operator: 'Kasun',
  vendor_fields: { protocol: 'ship', command: 'CN', fields: ['{encoder}', '2', '101'] }, issued_at: '2026-09-18T08:35:00Z', expires_at: '2099-01-01T00:00:00Z',
} as const;

const LOCKS = (over: Record<string, unknown> = {}) => ({
  door_locks: { property_id: 1, vendor: 'ttlock', vendor_label: 'TTLock', connection: 'cloud', mode: 'server', enabled: true, default_cards: 2, on_checkin: 'auto', on_move: 'auto', on_checkout: 'auto',
    common_areas: [{ code: 'POOL', name: 'Pool gate', lock: '1', default: true }, { code: 'GYM', name: 'Gym', lock: '2', default: false }], ...over },
  max_cards: 6,
});

beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(toast).mockReset();
  try {
    localStorage.setItem('ws.pms.terminal', 'Front desk 2');
  } catch {
    /* jsdom */
  }
});
afterEach(cleanup);

describe('finishing a key at the desk', () => {
  it('runs an encoder job on this desk’s lock server and reports it to WorkSuite', async () => {
    vi.mocked(call).mockResolvedValue({ ok: true, message: 'Card encoded', encoder: 'ENC1 on 10.0.0.5', card: { rooms: ['101'], valid_until: '2026-09-21 12:00', cards: 2 } } as never);
    vi.mocked(request).mockResolvedValue({ data: { row: {}, stay: null }, message: 'Recorded.' } as never);

    const out = await finishKey(1, { ok: true, status: 'pending', message: 'Encode the card', mode: 'encoder', log_id: 41, payload: PAYLOAD as never });

    expect(out).toMatchObject({ ok: true, ran: true, message: 'Card encoded' });
    expect(call).toHaveBeenCalledWith('pmsLocks:run', { propertyId: 1, payload: PAYLOAD });
    const [method, path, o] = vi.mocked(request).mock.calls[0] as [string, string, { body: Record<string, unknown> }];
    expect([method, path]).toEqual(['POST', '/api/pms/v1/keys/41/result']);
    expect(o.body).toMatchObject({ ok: true, message: 'Card encoded', card: { rooms: ['101'] } });
    expect(String(o.body.encoder)).toContain('ENC1 on 10.0.0.5');
  });

  it('leaves the job waiting when this computer has no lock server for the property', async () => {
    vi.mocked(call).mockResolvedValue({ ok: false, skipped: true, message: 'This computer has no door-lock server for this property.' } as never);
    const out = await finishKey(1, { ok: true, status: 'pending', message: '', mode: 'encoder', log_id: 41, payload: PAYLOAD as never });
    expect(out).toMatchObject({ ok: false, ran: false });
    expect(request).not.toHaveBeenCalled();
  });

  it('only says a cloud key, with its passcode', async () => {
    const out = await finishKey(1, { ok: true, status: 'issued', message: 'Passcodes made.', mode: 'server', secret: 'room 101: 481522' });
    expect(out).toEqual({ ok: true, message: 'Passcodes made.', ran: false, secret: 'room 101: 481522' });
    expect(call).not.toHaveBeenCalled();
  });
});

describe('the key panel', () => {
  it('sends the cards and common areas and shows the passcode once', async () => {
    vi.mocked(apiGetMeta).mockImplementation(async (path: string) => ({
      data: path.endsWith('/door-locks') ? LOCKS() : { items: [{ id: 5, rooms: '101', action: 'issue', action_label: 'New key', vendor: 'ttlock', mode: 'server', status: 'issued', status_label: 'Issued', cards: 1, mobile: false, valid_until: '2026-09-21 12:00', common_areas: ['POOL'], message: '', encoder: null, created_by_name: 'Kasun Silva', created_at: '2026-09-18 08:35:00' }] },
      offline: false,
      cachedAt: null,
    }) as never);
    vi.mocked(request).mockResolvedValue({ data: { key: { ok: true, status: 'issued', message: 'Passcodes made.', mode: 'server', secret: 'room 101: 481522\nPool gate: 481523' } }, message: 'Passcodes made.' } as never);
    const held = new Set(['pms.keys.issue']);
    const pms = { property: { id: 1, name: 'Lagoon' }, may: (p: string) => held.has(p), mayAny: (...p: string[]) => p.some((x) => held.has(x)), online: true } as never;
    const stay = { id: 12, property_id: 1, status: 'in_house', room_number: '101', key_status: 'issued', key_status_label: 'Key issued' } as never;

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PmsContext.Provider value={pms}>
          <KeyPanel stay={stay} onChanged={() => undefined} />
        </PmsContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Kasun Silva/)).toBeTruthy();
    fireEvent.click(await screen.findByLabelText(/Gym/));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    await waitFor(() => expect(request).toHaveBeenCalled());
    const [, path, o] = vi.mocked(request).mock.calls[0] as [string, string, { body: Record<string, unknown> }];
    expect(path).toBe('/api/pms/v1/stays/12/keys');
    expect(o.body).toMatchObject({ action: 'duplicate', cards: 2, common_areas: ['POOL', 'GYM'], mobile: false });
    expect(await screen.findByText(/481522/)).toBeTruthy();
    expect(call).not.toHaveBeenCalled();
  });
});
