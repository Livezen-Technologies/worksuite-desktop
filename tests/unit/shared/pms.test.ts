import { describe, expect, it, vi } from 'vitest';
import { canOpenLink, categoryVisible, visibleAppIds } from '@shared/access';
import { APP_CATALOGUE, visibleApps } from '@shared/apps';
import { parseDeepLink } from '@shared/deeplink';
import { resolveWebLink } from '@shared/links';
import { validateManifest } from '@shared/manifest';
import { pmsCached } from '@shared/pms-cache';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, isMac: false }));

const { money, isZero, isNegative, plusDays } = await import('../../../src/modules/pms/api');
const { routeOf, screenOf } = await import('../../../src/modules/pms/routes');
const { esc, folioDocumentHtml, registrationCardHtml } = await import('../../../src/modules/pms/print');
const { device, NO_DEVICE, registerDevice, DEVICE_KINDS } = await import('../../../src/modules/pms/devices');
const { call } = await import('../../../src/core/bridge');

const at = (route: string) => {
  const [p, q] = route.split('?');
  return screenOf((p ?? '').split('/').filter(Boolean), new URLSearchParams(q ?? ''));
};

describe('Hotel PMS in the catalogue', () => {
  const pms = APP_CATALOGUE.find((a) => a.id === 'pms')!;

  it('is a native app, for people the server gives Hotel PMS and pms.access', () => {
    expect(pms.surface).toBe('native');
    expect(pms.app).toBe('pms');
    expect(pms.perm).toBe('pms.access');
    expect(visibleApps({ apps: ['pms'], permissions: ['pms.access'] }).some((a) => a.id === 'pms')).toBe(true);
    expect(visibleApps({ apps: ['pms'], permissions: [] }).some((a) => a.id === 'pms')).toBe(false);
    expect(visibleApps({ apps: ['crm'], permissions: ['pms.access'] }).some((a) => a.id === 'pms')).toBe(false);
    // A /desktop/v1 server that resolved the apps itself decides.
    expect(visibleApps({ apps: '*', permissions: ['*'], serverApps: ['crm'] }).some((a) => a.id === 'pms')).toBe(false);
  });

  it('opens the server’s notification links in its tab, and only for people who have it', () => {
    expect(resolveWebLink('/pms/reservations/12')).toEqual({ kind: 'tab', route: '/pms/reservations/12', app: 'pms' });
    expect(resolveWebLink('/pms/front-desk?arrivals=2026-09-18')).toEqual({ kind: 'tab', route: '/pms/front-desk?arrivals=2026-09-18', app: 'pms' });
    const has = visibleAppIds({ apps: ['pms'], permissions: ['pms.access'] });
    const hasNot = visibleAppIds({ apps: ['crm'], permissions: ['crm.view'] });
    expect(canOpenLink('/pms/folios/9', has)).toBe(true);
    expect(canOpenLink('/pms/folios/9', hasNot)).toBe(false);
    expect(categoryVisible('pms', has)).toBe(true);
    expect(categoryVisible('pms', hasNot)).toBe(false);
  });

  it('takes worksuite://pms links to a reservation or a room, and nothing else', () => {
    const r = parseDeepLink('worksuite://pms/reservations/41');
    expect(r.ok && r.link).toMatchObject({ module: 'pms', route: '/pms/reservations/41' });
    const room = parseDeepLink('worksuite://pms/rooms/7?window=1');
    expect(room.ok && room.link).toMatchObject({ route: '/pms/rooms/7', newWindow: true });
    expect(parseDeepLink('worksuite://pms/folios/7').ok).toBe(false);
    expect(parseDeepLink('worksuite://pms/reservations/../users').ok).toBe(false);
  });

  it('declares a valid manifest in the registry', async () => {
    const { moduleFor } = await import('../../../src/modules/registry');
    const m = moduleFor('pms');
    expect(m).toBeTruthy();
    expect(validateManifest(m!.manifest).ok).toBe(true);
    expect(m!.manifest.offline.mode).toBe('READ_CACHE');
    expect(m!.manifest.deepLinks).toEqual(['pms', 'pms/reservations/:id', 'pms/rooms/:id']);
    expect(m!.manifest.native).toContain('printing');
  });
});

describe('what the desk reads offline (PMS-DSK-003)', () => {
  it('keeps the rack, the arrivals, departures and in-house lists, and the options', () => {
    for (const p of ['/api/pms/v1/options?org=3&property_id=1', '/api/pms/v1/properties', '/api/pms/v1/properties/1/rack', '/api/pms/v1/properties/12/arrivals?date=2026-09-18', '/api/pms/v1/properties/1/in-house', '/api/pms/v1/properties/1/departures', '/api/pms/v1/properties/1/front-desk/lists?list=arrivals'])
      expect(pmsCached(p)).toBe(true);
  });

  it('keeps no money, no audit and no report', () => {
    for (const p of ['/api/pms/v1/folios/9', '/api/pms/v1/properties/1/folios', '/api/pms/v1/properties/1/payments', '/api/pms/v1/properties/1/night-audit', '/api/pms/v1/properties/1/reports/daily_revenue', '/api/pms/v1/properties/1/cashier-sessions', '/api/pms/v1/reservations/4', '/api/pms/v1/properties/1/rack/extra'])
      expect(pmsCached(p)).toBe(false);
  });
});

describe('the module’s addresses', () => {
  it('reads records, views and the server’s notification links', () => {
    expect(at('/pms/reservations/12')).toEqual({ kind: 'reservation', id: 12 });
    expect(at('/pms/reservations/12/check-in')).toEqual({ kind: 'checkin', id: 12 });
    expect(at('/pms/reservations/12/check-out')).toEqual({ kind: 'checkout', id: 12 });
    expect(at('/pms/stays/5?folio=9&act=charge')).toEqual({ kind: 'stay', id: 5, folio: 9, act: 'charge' });
    expect(at('/pms/folios/9')).toEqual({ kind: 'folio', id: 9 });
    expect(at('/pms/rooms/3')).toEqual({ kind: 'room', id: 3 });
    expect(at('/pms/cashier/4')).toEqual({ kind: 'shift', id: 4 });
    expect(at('/pms/requests/8')).toEqual({ kind: 'request', id: 8 });
    expect(at('/pms/front-desk?arrivals=2026-09-18')).toMatchObject({ kind: 'view', view: 'arrivals', date: '2026-09-18' });
    expect(at('/pms/front-desk?room=7')).toMatchObject({ kind: 'view', view: 'rack', room: 7 });
    expect(at('/pms/housekeeping/my')).toMatchObject({ kind: 'view', view: 'housekeeping' });
    expect(at('/pms/night-audit')).toMatchObject({ kind: 'view', view: 'audit' });
    expect(at('/pms?new=1')).toMatchObject({ kind: 'view', view: 'new' });
    expect(at('/pms?view=nonsense')).toMatchObject({ kind: 'view', view: null });
    expect(at('/pms/stays/5?act=delete')).toEqual({ kind: 'stay', id: 5, folio: null, act: null });
  });

  it('writes them back', () => {
    for (const r of ['/pms/reservations/12', '/pms/reservations/12/check-in', '/pms/stays/5?folio=9', '/pms/folios/9', '/pms/rooms/3', '/pms/cashier/4']) expect(routeOf(at(r) as never)).toBe(r);
    expect(routeOf({ kind: 'view', view: 'arrivals', date: '2026-09-18' })).toBe('/pms?view=arrivals&date=2026-09-18');
  });
});

describe('the server’s figures, written as they came', () => {
  it('groups a decimal string without turning it into a float', () => {
    expect(money('25000.00', 'LKR')).toBe('LKR 25,000.00');
    expect(money('-1200.5', 'USD')).toBe('USD -1,200.50');
    expect(money('1234567890123.45')).toBe('1,234,567,890,123.45');
    expect(money(null, 'LKR')).toBe('—');
    expect(isZero('0.00')).toBe(true);
    expect(isZero('-0.00')).toBe(true);
    expect(isNegative('-5.00')).toBe(true);
    expect(isNegative('5.00')).toBe(false);
    expect(plusDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('printed pages', () => {
  const card = {
    property: { name: 'Lagoon <Hotel>', address: '1 Beach Rd', phone: null, check_in_time: '14:00', check_out_time: '12:00' },
    guest: { name: '<script>alert(1)</script>', email: 'a@b.lk', phone: null, address: null, nationality: 'LK' },
    confirmation_no: 'LAG26-00001', room_number: '305', arrival_date: '2026-09-18', departure_date: '2026-09-21', adults: 2, children: 0, rate_plan: 'Bed & Breakfast', total: '75000.00', currency: 'LKR', signed: false,
  };

  it('escapes everything the server sent, and takes only a PNG signature', () => {
    const html = registrationCardHtml(card, 'data:image/png;base64,AAAA');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Lagoon &lt;Hotel&gt;');
    expect(html).toContain('LKR 75,000.00');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(registrationCardHtml(card, 'javascript:alert(1)')).not.toContain('javascript:');
    expect(esc(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('prints a folio’s receipt with its lines, taxes and balance as the server gave them', () => {
    const html = folioDocumentHtml({
      kind: 'receipt',
      number: 'RLAG-000001',
      property: { name: 'Lagoon', legal_name: 'Lagoon (Pvt) Ltd', address: null, tax_registration: '123' },
      billing_present: false,
      folio: {
        id: 9, folio_no: 'FLAG-000009', property_id: 1, reservation_id: 4, stay_id: 5, label: 'Guest', payee_type: 'guest', payee_client_id: 3, payee_name: 'Nimal', status: 'settled', status_label: 'Settled', balance: '0.00', currency: 'LKR',
        opened_business_date: '2026-09-18', settled_at: null, closed_at: null, invoice_id: null, receipt_no: 'RLAG-000001', ar_reference: null, version: 2,
        items: [
          { id: 1, folio_id: 9, item_type: 'room', item_type_label: 'Room', service_id: null, description: 'Room 305', quantity: '1', unit_price: '25000.00', amount: '25000.00', tax_amount: '0.00', total: '25000.00', currency: 'LKR', taxes: [], business_date: '2026-09-18', source: 'night_audit', source_ref: null, parent_item_id: null, routed_from_folio_id: null, is_void: false, void_reason: null, terminal: null, posted_by: null, posted_at: null, locked: true },
          { id: 2, folio_id: 9, item_type: 'charge', item_type_label: 'Charge', service_id: 4, description: 'Laundry', quantity: '1', unit_price: '900.00', amount: '900.00', tax_amount: '162.00', total: '1062.00', currency: 'LKR', taxes: [], business_date: '2026-09-18', source: 'front_desk', source_ref: null, parent_item_id: null, routed_from_folio_id: null, is_void: true, void_reason: 'Posted twice', terminal: null, posted_by: null, posted_at: null, locked: false },
        ],
        payments: [],
        totals: { charges: '25000.00', taxes: '4500.00', payments: '29500.00', refunds: '0.00', balance: '0.00' },
        tax_summary: [{ name: 'VAT 18%', amount: '4500.00' }],
        options: [],
      },
    });
    expect(html).toContain('Receipt RLAG-000001');
    expect(html).toContain('VAT 18%');
    expect(html).toContain('LKR 29,500.00');
    expect(html).toContain('class="void"');
    expect(html).toContain('void: Posted twice');
  });
});

describe('the device agent seam (PMS-DSK-002)', () => {
  it('has a provider for every kind; without a driver only the printer is there, and it is the desktop’s own printing', async () => {
    expect(DEVICE_KINDS).toEqual(['id_scanner', 'key_encoder', 'printer', 'signature_pad', 'cash_drawer', 'payment_terminal']);
    for (const k of DEVICE_KINDS) expect(device(k).available()).toBe(k === 'printer');
    expect(await NO_DEVICE.id_scanner.scan()).toBeNull();
    expect((await NO_DEVICE.payment_terminal.charge({ amount: '1.00', currency: 'LKR', reference: 'x' })).approved).toBe(false);
    expect((await NO_DEVICE.cash_drawer.open('payment')).ok).toBe(false);
    await device('printer').print({ title: 'Card', html: '<p>x</p>', kind: 'registration_card' });
    expect(call).toHaveBeenCalledWith('print:print', { html: '<p>x</p>', title: 'Card' });
  });

  it('takes a vendor’s driver when one registers, and gives the seat back when it leaves', async () => {
    const terminal = { id: 'acme', label: 'Acme T1', available: () => true, charge: vi.fn(async () => ({ approved: true, message: 'Approved', provider: 'acme', provider_ref: 'A1', card_token: 'tok', card_last4: '4242' })) };
    const off = registerDevice('payment_terminal', terminal);
    expect(device('payment_terminal').available()).toBe(true);
    expect((await device('payment_terminal').charge({ amount: '10.00', currency: 'LKR', reference: 'F1' })).card_last4).toBe('4242');
    off();
    expect(device('payment_terminal')).toBe(NO_DEVICE.payment_terminal);
  });
});
