import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { EMPTY, isOrderCode, postLines, rcvReducer, receiveBody, totals } = await import('../../../src/modules/purchase/scan');
type State = ReturnType<typeof rcvReducer>;

/**
 * SRS-PUR-001 G-21, S-06 (the "Desktop receiving" design): receiving by scan. One box takes every scan — the order,
 * each item, each unit's serial; F2 turns the last unit away as damaged, F3 puts the line on quality hold; another
 * order's number is refused while this one is open.
 */
const order = { id: 402, number: 'PO-2026-0402', vendor: 'Gulf Tech Trading LLC', warehouse: 'Main store' };
const lines = [
  { lineId: 1, code: 'NET-AP6', barcode: '8901234500017', name: 'Wi-Fi 6 access point', unit: 'pcs', tracking: 'serial' as const, bin: 'A-03-2', expected: 4 },
  { lineId: 2, code: 'PSU-48V', barcode: null, name: 'PoE injector 48 V', unit: 'pcs', tracking: 'batch' as const, bin: null, expected: 12 },
  { lineId: 3, code: 'CAB-C6A', barcode: null, name: 'Cat6A cable, 305 m', unit: 'roll', tracking: 'none' as const, bin: 'C-01-1', expected: 2 },
  { lineId: 4, code: 'SW-24', barcode: null, name: '24-port switch', unit: 'pcs', tracking: 'none' as const, bin: null, expected: 0 },
];
const at = '10:31:08';
const open = () => rcvReducer(EMPTY, { type: 'order', order, lines });
const scan = (s: State, code: string) => rcvReducer(s, { type: 'scan', code, at });
const line = (s: State, id: number) => s.lines.find((l) => l.lineId === id)!;

describe('receiving by scan', () => {
  it('opens the order as a checklist of what is still to come', () => {
    const s = open();
    expect(s.order?.number).toBe('PO-2026-0402');
    // A line with nothing left to come is not on the checklist.
    expect(s.lines.map((l) => l.lineId)).toEqual([1, 2, 3]);
    expect(s.message).toEqual({ ok: true, text: 'PO-2026-0402 · scan each item as it comes off the delivery.' });
    expect(rcvReducer(EMPTY, { type: 'order', order, lines: [{ ...lines[3]! }] }).message?.ok).toBe(false);
  });

  it('asks for the order first', () => {
    const s = scan(EMPTY, 'CAB-C6A');
    expect(s.message?.ok).toBe(false);
    expect(s.message?.text).toMatch(/Scan the purchase order first/);
    expect(s.log[0]).toMatchObject({ code: 'CAB-C6A', outcome: 'refused' });
  });

  it('counts an item by its code or its barcode, one per scan, and refuses more than is to come', () => {
    let s = scan(open(), 'cab-c6a');
    expect(line(s, 3).accepted).toBe(1);
    expect(s.active).toBe(3);
    expect(s.message?.text).toBe('Cat6A cable, 305 m · 1 of 2');
    s = scan(s, 'CAB-C6A');
    expect(line(s, 3).accepted).toBe(2);
    const over = scan(s, 'CAB-C6A');
    expect(line(over, 3).accepted).toBe(2);
    expect(over.message?.ok).toBe(false);
    expect(over.message?.text).toMatch(/All 2 of Cat6A cable, 305 m are counted already/);
    expect(over.log[0]!.outcome).toBe('refused');
  });

  it('refuses a scan of another order while this one is open — nothing is counted against the wrong order', () => {
    const s = scan(scan(open(), 'CAB-C6A'), 'PO-2026-0399');
    expect(s.order?.number).toBe('PO-2026-0402');
    expect(s.message).toEqual({ ok: false, text: 'PO-2026-0399 is a different order. Post or save PO-2026-0402 before receiving another.' });
    expect(totals(s)).toMatchObject({ accepted: 1 });
    expect(s.log[0]).toMatchObject({ code: 'PO-2026-0399', outcome: 'refused' });
    // The same order's number again is nothing new.
    const same = scan(open(), 'po-2026-0402');
    expect(same.message).toEqual({ ok: true, text: 'Already receiving PO-2026-0402.' });
    expect(isOrderCode('PO-0399')).toBe(true);
    expect(isOrderCode('CAB-C6A')).toBe(false);
  });

  it('refuses an item that is not on this order, and changes nothing', () => {
    const before = scan(open(), 'CAB-C6A');
    const s = scan(before, 'HDMI-2M');
    expect(s.lines).toEqual(before.lines);
    expect(s.message).toEqual({ ok: false, text: 'HDMI-2M is not on PO-2026-0402. Nothing was counted.' });
  });

  it('takes a serialised line by its code, then one serial per unit, and refuses a serial twice', () => {
    let s = scan(open(), '8901234500017');
    expect(s.active).toBe(1);
    expect(line(s, 1).accepted).toBe(0);
    expect(s.message?.text).toMatch(/scan each unit's serial/);
    s = scan(scan(scan(s, 'AP6-77809'), 'AP6-77810'), 'AP6-77811');
    expect(line(s, 1)).toMatchObject({ accepted: 3, serials: ['AP6-77809', 'AP6-77810', 'AP6-77811'] });
    expect(s.message?.text).toBe('Serial accepted · 3 of 4 on this line');
    const twice = scan(s, 'ap6-77810');
    expect(line(twice, 1).accepted).toBe(3);
    expect(twice.message?.text).toBe('Serial AP6-77810 is scanned already.');
  });

  it('F2 turns the last unit counted away as damaged — its serial is not received', () => {
    let s = scan(scan(scan(open(), 'NET-AP6'), 'AP6-77809'), 'AP6-77810');
    s = rcvReducer(s, { type: 'damaged', at });
    expect(line(s, 1)).toMatchObject({ accepted: 1, rejected: 1, reason: 'damaged', serials: ['AP6-77809'] });
    expect(s.log[0]).toMatchObject({ code: 'AP6-77810', outcome: 'rejected', text: 'rejected · damaged' });
    // Nothing scanned yet: F2 says what to do.
    expect(rcvReducer(open(), { type: 'damaged', at }).message?.ok).toBe(false);
  });

  it('F3 puts the line on quality hold, and posts what was kept on it as held for QC', () => {
    let s = scan(open(), 'PSU-48V');
    s = rcvReducer(s, { type: 'hold', at });
    expect(line(s, 2).hold).toBe(true);
    expect(s.message?.text).toBe('PoE injector 48 V goes into quality hold until tested.');
    s = rcvReducer(s, { type: 'set', lineId: 2, patch: { accepted: 12, batch: 'B-2610-07' } });
    s = scan(s, 'CAB-C6A');
    const b = receiveBody(s);
    expect(b.error).toBeNull();
    expect(b.lines).toEqual([
      { po_line_id: 2, quantity: 12, rejected_qty: 0, quarantine_qty: 12, batch_no: 'B-2610-07' },
      { po_line_id: 3, quantity: 1, rejected_qty: 0, quarantine_qty: 0 },
    ]);
    expect(totals(s).held).toBe(12);
    // F3 again takes it off hold.
    expect(line(rcvReducer(s, { type: 'focus', lineId: 2 }), 2).hold).toBe(true);
    expect(line(rcvReducer(rcvReducer(s, { type: 'focus', lineId: 2 }), { type: 'hold', at }), 2).hold).toBe(false);
  });

  it('will not post until batches are named and every serial is scanned', () => {
    expect(receiveBody(open()).error).toMatch(/Nothing has been counted yet/);
    const batch = rcvReducer(scan(open(), 'PSU-48V'), { type: 'set', lineId: 2, patch: { accepted: 3 } });
    expect(receiveBody(batch).error).toBe('PoE injector 48 V is batch tracked — name the batch.');
    const serial = rcvReducer(scan(open(), 'NET-AP6'), { type: 'set', lineId: 1, patch: { accepted: 2 } });
    expect(receiveBody(serial).error).toMatch(/serialised: scan 2 serial numbers \(0 scanned\)/);
  });

  it('posts a rejection with its reason, and the delivery note', () => {
    let s = rcvReducer(scan(open(), 'CAB-C6A'), { type: 'set', lineId: 3, patch: { rejected: 1 } });
    expect(line(s, 3).reason).toBe('other');
    s = rcvReducer(s, { type: 'set', lineId: 3, patch: { reason: 'wrong_item' } });
    s = rcvReducer(s, { type: 'delivery', text: ' GT-DN-55120 ' });
    expect(receiveBody(s)).toEqual({ lines: [{ po_line_id: 3, quantity: 1, rejected_qty: 1, quarantine_qty: 0, reject_reason: 'wrong_item' }], delivery_note_no: 'GT-DN-55120', error: null });
  });

  it('matches what was counted to the draft receipt’s own lines, by order line, to post it', () => {
    const counted = [
      { po_line_id: 2, quantity: 12, rejected_qty: 0, quarantine_qty: 12, batch_no: 'B-1' },
      { po_line_id: 1, quantity: 1, rejected_qty: 1, quarantine_qty: 0, reject_reason: 'damaged', serials: ['AP6-1'] },
    ];
    expect(
      postLines(counted, [
        { id: 90, po_line_id: 1 },
        { id: 91, po_line_id: '2' },
        { id: 92, po_line_id: 3 },
        { id: 93, po_line_id: null },
      ]),
    ).toEqual([
      { id: 90, quantity: 1, rejected_qty: 1, quarantine_qty: 0, reject_reason: 'damaged', serials: ['AP6-1'] },
      { id: 91, quantity: 12, rejected_qty: 0, quarantine_qty: 12, batch_no: 'B-1' },
    ]);
  });
});
