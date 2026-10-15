import { describe, expect, it, vi } from 'vitest';
import type { SalesPrintOutcome } from '@shared/sales';
import { allChecked, askRates, bestRate, bookAndPrint, deskReducer, EMPTY, isNoteCode, parseWeight, type DeskEvent, type DeskState } from '../../../src/modules/sales/desk';
import type { DeliveryHit, DeliveryLine, Rate, Shipment } from '../../../src/modules/sales/ship';

/**
 * WS-OMS-SRS-001 D-13, FR-DSK-08, FR-LBL-06: scan the delivery note, check every item by scanning it, weigh, choose a
 * courier from the rates, book, and the label prints by itself.
 */
const note: DeliveryHit = { id: 321, dn_number: 'DN-00321', status: 'picked', so_id: 484, so_number: 'SO-00484', client_name: 'Nimali Perera' };
const lines: DeliveryLine[] = [
  { id: 1, product_id: 10, code: 'TWL-BS-W', product_name: 'Bath towel set — white', description: null, quantity: '2.0000', unit: 'set' },
  { id: 2, product_id: null, code: null, product_name: null, description: 'Gift wrap', quantity: 1, unit: null, tracking: 'service' },
];
const shipment = (over: Partial<Shipment> = {}): Shipment => ({
  id: 900, number: 'SHP-00900', org_id: 1, order: { id: 484, number: 'SO-00484' }, delivery: { id: 321, number: 'DN-00321' }, courier: null, service_code: null, state: 'draft',
  tracking_no: null, tracking_url: null, cod_amount: 7950, currency: 'LKR', parcels_count: 1, weight_kg: 0.8, ship_to: null, booked_at: null, exception: null, ...over,
});
const rates: Rate[] = [
  { account_id: 2, driver: 'domex', courier: 'Domex', service_code: 'STD', service: 'Standard', price: 450, currency: 'LKR', transit_days: 2 },
  { account_id: 3, driver: 'koombiyo', courier: 'Koombiyo', service_code: 'NXT', service: 'Next day', price: 390, currency: 'LKR', transit_days: 1 },
  { account_id: 4, driver: 'pronto', courier: 'Pronto', service_code: 'X', service: 'Express', price: 100, currency: 'LKR', transit_days: 1, error: 'timed out' },
];

function run(events: DeskEvent[], from: DeskState = EMPTY): DeskState {
  return events.reduce(deskReducer, from);
}

describe('the Shipping desk', () => {
  it('knows a delivery note’s barcode, and a scale’s reading', () => {
    expect(isNoteCode('DN-00321')).toBe(true);
    expect(isNoteCode('dn00321')).toBe(true);
    expect(isNoteCode('TWL-BS-W')).toBe(false);
    expect(parseWeight('0.80')).toBe(0.8);
    expect(parseWeight('ST,GS,+  0.800kg')).toBe(0.8);
    expect(parseWeight('800 g')).toBe(0.8);
    expect(parseWeight('1,25')).toBe(1.25);
    expect(parseWeight('0')).toBeNull();
    expect(parseWeight('heavy')).toBeNull();
  });

  it('checks items by scanning them, and refuses what is not on the note or one too many', () => {
    let s = run([{ type: 'note', note, lines }]);
    expect(s.stage).toBe('check');
    // A service has nothing to scan.
    expect(s.lines[1]).toMatchObject({ service: true, got: 1, need: 1 });
    s = deskReducer(s, { type: 'item', code: 'PC-5075' });
    expect(s.message).toEqual({ ok: false, text: 'PC-5075 is not on DN-00321.' });
    s = run([{ type: 'item', code: 'twl-bs-w' }], s);
    expect(s.lines[0]!.got).toBe(1);
    expect(s.stage).toBe('check');
    s = run([{ type: 'item', code: 'TWL-BS-W' }], s);
    expect(allChecked(s)).toBe(true);
    expect(s.stage).toBe('weigh');
    s = deskReducer(s, { type: 'item', code: 'TWL-BS-W' });
    expect(s.message?.ok).toBe(false);
    expect(s.lines[0]!.got).toBe(2);
  });

  it('opens a note that is booked already at its label, without booking it again', () => {
    const s = run([{ type: 'note', note, lines, shipment: shipment({ state: 'booked', tracking_no: 'KMB-1' }) }]);
    expect(s.stage).toBe('booked');
    expect(s.message?.text).toContain('KMB-1');
  });

  it('chooses the cheapest courier that answered', () => {
    expect(bestRate(rates)?.courier).toBe('Koombiyo');
    expect(bestRate([rates[2]!])).toBeNull();
  });

  it('weighs, rates, books with one idempotency key, and prints the label by itself', async () => {
    let s = run([{ type: 'note', note, lines }, { type: 'item', code: 'TWL-BS-W' }, { type: 'item', code: 'TWL-BS-W' }, { type: 'weight', text: '0.80 kg' }]);
    const dispatch = (e: DeskEvent) => void (s = deskReducer(s, e));
    const createShipment = vi.fn(async () => shipment());
    const updateShipment = vi.fn(async () => shipment());
    const fetch = vi.fn(async () => rates);
    await askRates(s, { createShipment, updateShipment, rates: fetch }, dispatch);
    expect(createShipment).toHaveBeenCalledWith({ delivery_id: 321, parcels: [{ weight_kg: 0.8, length_cm: 30, width_cm: 20, height_cm: 10 }] });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(s.stage).toBe('rates');
    expect(s.chosen?.courier).toBe('Koombiyo');

    // A courier that did not answer cannot be chosen.
    dispatch({ type: 'choose', rate: rates[2]! });
    expect(s.chosen?.courier).toBe('Koombiyo');

    const book = vi.fn(async () => shipment({ state: 'booked', tracking_no: 'KMB-00941781', courier: { account_id: 3, driver: 'koombiyo', name: 'Koombiyo' } }));
    const printed: SalesPrintOutcome = { ok: true, printer: 'Zebra ZD421', via: 'raw', message: 'Label sent to Zebra ZD421.' };
    const printLabel = vi.fn(async () => printed);
    const key = s.key;
    expect(key).toMatch(/^ship-321-/);
    await bookAndPrint(s, { book, printLabel, autoPrint: true }, dispatch);
    expect(book).toHaveBeenCalledWith(900, rates[1], key);
    expect(printLabel).toHaveBeenCalledWith(900, { quiet: true });
    expect(s.stage).toBe('booked');
    expect(s.printed).toEqual(printed);
    expect(s.message).toEqual({ ok: true, text: printed.message });

    // Asking again re-weighs the same shipment rather than making another.
    const again = { ...s, stage: 'weigh' as const };
    await askRates(again, { createShipment, updateShipment, rates: fetch }, () => undefined);
    expect(updateShipment).toHaveBeenCalledWith(900, { parcels: [expect.objectContaining({ weight_kg: 0.8 })] });
  });

  it('does not book before every item is checked, nor print when auto-print is off', async () => {
    let s = run([{ type: 'note', note, lines }, { type: 'shipment', shipment: shipment() }, { type: 'rates', rates }]);
    const dispatch = (e: DeskEvent) => void (s = deskReducer(s, e));
    const book = vi.fn();
    expect(await bookAndPrint(s, { book, printLabel: vi.fn(), autoPrint: true }, dispatch)).toBeNull();
    expect(book).not.toHaveBeenCalled();
    expect(s.message).toEqual({ ok: false, text: 'Check every item first.' });

    s = run([{ type: 'note', note, lines }, { type: 'item', code: 'TWL-BS-W' }, { type: 'item', code: 'TWL-BS-W' }, { type: 'shipment', shipment: shipment() }, { type: 'rates', rates }]);
    const printLabel = vi.fn();
    await bookAndPrint(s, { book: async () => shipment({ state: 'booked' }), printLabel, autoPrint: false }, dispatch);
    expect(printLabel).not.toHaveBeenCalled();
    expect(s.stage).toBe('booked');
  });
});
