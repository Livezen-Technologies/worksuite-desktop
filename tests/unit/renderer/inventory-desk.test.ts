import { describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), apiPatch: vi.fn(), request: vi.fn() }));

const { WedgeDetector } = await import('../../../src/core/scanner');
const { closeTab, openTab, parseOpen, productRoute, serializeOpen, stepTab, MAX_OPEN } = await import('../../../src/modules/inventory/tabs');
const { countReducer, countedNow, linesFor, newSession, queueLabel, savedWords, unsent, varianceOf, waiting } = await import('../../../src/modules/inventory/countSync');
const { knownSerialText, labelsToPrint, leftWords, progress, serialLineFor } = await import('../../../src/modules/inventory/receiving');
const { EMPTY, rcvReducer } = await import('../../../src/modules/purchase/scan');
const { labelsHtml, countSheetHtml } = await import('../../../src/modules/inventory/labels');
const v2 = await import('../../../src/modules/inventory/v2');
const { ApiError } = await import('../../../src/core/api');
const { copyDraft } = await import('../../../src/modules/inventory/api');

describe('keyboard-wedge scanner', () => {
  const feed = (d: InstanceType<typeof WedgeDetector>, text: string, start: number, gap: number) => {
    let t = start;
    let out: string | null = null;
    for (const ch of [...text, 'Enter']) {
      out = d.feed(ch, t);
      t += gap;
    }
    return out;
  };

  it('reads a fast burst ended by Enter as a scan', () => {
    expect(feed(new WedgeDetector(), '4960999667450', 1000, 8)).toBe('4960999667450');
  });

  it('leaves a person typing alone, and too short a burst', () => {
    expect(feed(new WedgeDetector(), 'HP-85A', 1000, 180)).toBeNull();
    expect(feed(new WedgeDetector(), 'ab', 1000, 5)).toBeNull();
  });

  it('starts again after a pause, so a typed letter before a scan is not part of it', () => {
    const d = new WedgeDetector();
    d.feed('x', 0);
    expect(feed(d, 'CN0F4K3A', 2000, 10)).toBe('CN0F4K3A');
  });

  it('ignores keys that type nothing', () => {
    const d = new WedgeDetector();
    d.feed('Shift', 0);
    expect(feed(d, 'ABC123', 5, 5)).toBe('ABC123');
  });
});

describe('products in tabs', () => {
  it('reads the address leniently: ids once each, in order', () => {
    expect(parseOpen('12,15, 9,12,x,0,-3')).toEqual([12, 15, 9]);
    expect(parseOpen(null)).toEqual([]);
    expect(serializeOpen([3, 4])).toBe('3,4');
  });

  it('opens a tab once, and keeps to the most that may be open by closing the oldest other', () => {
    expect(openTab([1, 2], 2)).toEqual([1, 2]);
    expect(openTab([1, 2], 3)).toEqual([1, 2, 3]);
    const full = Array.from({ length: MAX_OPEN }, (_, i) => i + 1);
    expect(openTab(full, 99)).toEqual([...full.slice(1), 99]);
    expect(openTab([5, 6], 7, 2)).toEqual([6, 7]);
  });

  it('closing the tab in front shows its right-hand neighbour, else its left; another tab leaves the front alone', () => {
    expect(closeTab([1, 2, 3], 2, 2)).toEqual({ ids: [1, 3], active: 3 });
    expect(closeTab([1, 2, 3], 3, 3)).toEqual({ ids: [1, 2], active: 2 });
    expect(closeTab([1, 2, 3], 3, 1)).toEqual({ ids: [2, 3], active: 3 });
    expect(closeTab([4], 4, 4)).toEqual({ ids: [], active: null });
    expect(closeTab([1, 2], 1, 9)).toEqual({ ids: [1, 2], active: 1 });
  });

  it('steps round the tabs both ways', () => {
    expect(stepTab([1, 2, 3], 3, 1)).toBe(1);
    expect(stepTab([1, 2, 3], 1, -1)).toBe(3);
    expect(stepTab([], 1, 1)).toBeNull();
    expect(stepTab([7, 8], null, 1)).toBe(7);
  });

  it('opens a product in a tab or a window of the app at its own address', () => {
    expect(productRoute(42)).toBe('/inventory?tab=prod&open=42&product=42');
  });
});

describe('counting offline', () => {
  const lines = [
    { id: 1, product_id: 10, code: 'HP-85A', barcode: null, name: 'HP 85A Toner', variant_label: null, counted_qty: null },
    { id: 2, product_id: 11, code: 'HP-26A', barcode: '4960999667450', name: 'HP 26A Toner', variant_label: null, counted_qty: '4.0000' },
    { id: 3, product_id: 12, code: 'PG-745', barcode: null, name: 'Canon PG-745 ink', variant_label: null, counted_qty: null },
  ];
  const scan = (s: ReturnType<typeof newSession>, code: string) => countReducer(s, { type: 'scan', code, lines, reference: 'CNT-00005' });

  it('adds one per scan, by code or barcode, starting from what WorkSuite has', () => {
    let s = newSession(5);
    s = scan(s, 'hp-85a');
    s = scan(s, 'HP-85A');
    expect(countedNow(s, lines[0]!)).toBe(2);
    expect(s.last).toBe(1);
    expect(s.lines['1']).toEqual({ value: 2, state: 'local', at: null });
    s = scan(s, '4960999667450');
    expect(countedNow(s, lines[1]!)).toBe(5);
    expect(s.message).toEqual({ ok: true, text: 'HP 26A Toner · 5 counted' });
  });

  it('refuses a code that is on no line, and changes nothing', () => {
    const s0 = newSession(5);
    const s = scan(s0, 'LG-MK270');
    expect(s.lines).toBe(s0.lines);
    expect(s.message).toEqual({ ok: false, text: 'LG-MK270 is not on CNT-00005. Nothing was counted.' });
  });

  it('scans a barcode learnt from WorkSuite while online, offline too', () => {
    let s = countReducer(newSession(5), { type: 'learn', code: '4547597', productId: 12 });
    expect(linesFor(s, lines, '4547597').map((l) => l.id)).toEqual([3]);
    s = scan(s, '4547597');
    expect(countedNow(s, lines[2]!)).toBe(1);
  });

  it('sets a typed count, keeps empty as not counted, and refuses nonsense', () => {
    let s = countReducer(newSession(5), { type: 'set', lineId: 3, text: '10', lines });
    expect(countedNow(s, lines[2]!)).toBe(10);
    s = countReducer(s, { type: 'set', lineId: 3, text: '', lines });
    expect(countedNow(s, lines[2]!)).toBeNull();
    const bad = countReducer(s, { type: 'set', lineId: 3, text: '-2', lines });
    expect(bad.lines).toBe(s.lines);
    expect(bad.message?.ok).toBe(false);
  });

  it('follows each line from this computer to the queue to WorkSuite', () => {
    let s = scan(scan(newSession(5), 'HP-85A'), 'PG-745');
    expect(unsent(s)).toEqual([
      { id: 1, counted_qty: 1 },
      { id: 3, counted_qty: 1 },
    ]);
    expect(waiting(s)).toBe(true);
    const sent = { '1': 1, '3': 1 };
    // Line 1 is scanned again while the first send is on its way: it waits for the next.
    s = scan(s, 'HP-85A');
    s = countReducer(s, { type: 'submitted', sent, outcome: 'queued', at: '2026-10-15T08:52:00Z' });
    expect(s.lines['1']!.state).toBe('local');
    expect(s.lines['3']!.state).toBe('queued');
    expect(unsent(s)).toEqual([{ id: 1, counted_qty: 2 }]);
    s = countReducer(s, { type: 'submitted', sent: { '1': 2 }, outcome: 'queued', at: '2026-10-15T08:53:00Z' });
    s = countReducer(s, { type: 'synced', at: '2026-10-15T09:10:00Z' });
    expect(s.lines['1']).toEqual({ value: 2, state: 'sent', at: '2026-10-15T09:10:00Z' });
    expect(waiting(s)).toBe(false);
    expect(savedWords(s.lines['1'], () => '09:10')).toBe('sent 09:10');
  });

  it('marks queued lines that someone changed online for a decision, and retries a refused send only when asked', () => {
    let s = scan(newSession(5), 'HP-85A');
    s = countReducer(s, { type: 'submitted', sent: { '1': 1 }, outcome: 'queued', at: 'x' });
    s = countReducer(s, { type: 'conflict' });
    expect(s.lines['1']!.state).toBe('conflict');
    expect(savedWords(s.lines['1'], String)).toMatch(/choose which to keep/);

    let f = scan(newSession(5), 'PG-745');
    f = countReducer(f, { type: 'submitted', sent: { '3': 1 }, outcome: 'failed', at: 'x' });
    expect(unsent(f)).toEqual([]);
    expect(unsent(f, true)).toEqual([{ id: 3, counted_qty: 1 }]);
    f = countReducer(f, { type: 'submitted', sent: { '3': 1 }, outcome: 'sent', at: 'y' });
    expect(f.lines['3']).toEqual({ value: 1, state: 'sent', at: 'y' });
  });

  it('restores only its own count from the draft store', () => {
    const mine = { ...scan(newSession(5), 'HP-85A') };
    expect(countReducer(newSession(5), { type: 'restore', session: mine }).lines['1']!.value).toBe(1);
    expect(countReducer(newSession(6), { type: 'restore', session: mine }).lines).toEqual({});
  });

  it('words the queue and the variance', () => {
    expect(queueLabel('CNT-00005', 12)).toBe('CNT-00005 · 12 line counts');
    expect(queueLabel('CNT-00005', 1)).toBe('CNT-00005 · 1 line count');
    expect(varianceOf(8, '9.0000')).toBe(-1);
    expect(varianceOf(null, 9)).toBeNull();
    expect(savedWords(undefined, String)).toBe('—');
  });
});

describe('receiving with a scanner', () => {
  const order = (s = EMPTY) =>
    rcvReducer(s, {
      type: 'order',
      order: { id: 55, number: 'PO-00055', vendor: 'Abans', warehouse: 'Kandy Branch' },
      lines: [
        { lineId: 1, code: 'DL-5440', barcode: null, name: 'Dell Latitude 5440', unit: null, tracking: 'serial', bin: 'B-01-01', expected: 4 },
        { lineId: 2, code: 'WD19S', barcode: '5397184', name: 'Dell WD19S dock', unit: null, tracking: 'none', bin: 'B-01-02', expected: 2 },
      ],
    });
  const at = '10:00:00';

  it('knows when a scan is a unit’s serial, and when it is an item', () => {
    let s = order();
    expect(serialLineFor(s, 'CN0F4K37')).toBeNull();
    s = rcvReducer(s, { type: 'scan', code: 'DL-5440', at });
    expect(serialLineFor(s, 'CN0F4K37')?.lineId).toBe(1);
    expect(serialLineFor(s, 'wd19s')).toBeNull();
  });

  it('refuses the wrong item and an extra one, and shows each line’s progress', () => {
    let s = order();
    s = rcvReducer(s, { type: 'scan', code: 'LG-MK270', at });
    expect(s.message).toEqual({ ok: false, text: 'LG-MK270 is not on PO-00055. Nothing was counted.' });
    s = rcvReducer(s, { type: 'scan', code: '5397184', at });
    s = rcvReducer(s, { type: 'scan', code: '5397184', at });
    s = rcvReducer(s, { type: 'scan', code: '5397184', at });
    expect(s.message?.ok).toBe(false);
    expect(progress(s.lines[1]!)).toBe(100);
    expect(progress(s.lines[0]!)).toBe(0);
    expect(leftWords(s)).toBe('4 more Dell Latitude 5440 to scan.');
  });

  it('labels each serial once, in the order scanned', () => {
    let s = order();
    s = rcvReducer(s, { type: 'scan', code: 'DL-5440', at });
    s = rcvReducer(s, { type: 'scan', code: 'CN0F4K37', at });
    s = rcvReducer(s, { type: 'scan', code: 'CN0F4K38', at });
    expect(labelsToPrint(s, new Set(['CN0F4K37'])).map((l) => l.code)).toEqual(['CN0F4K38']);
    expect(labelsToPrint(s, new Set())[0]).toMatchObject({ title: 'Dell Latitude 5440', qr: 'CN0F4K37' });
    s = rcvReducer(s, { type: 'scan', code: 'CN0F4K37', at });
    expect(s.message).toEqual({ ok: false, text: 'Serial CN0F4K37 is scanned already.' });
    s = rcvReducer(s, { type: 'scan', code: 'CN0F4K39', at });
    expect(leftWords(s)).toBe('3 more to scan on 2 lines.');
    s = rcvReducer(s, { type: 'scan', code: 'WD19S', at });
    s = rcvReducer(s, { type: 'scan', code: 'WD19S', at });
    expect(leftWords(s)).toBe('One more Dell Latitude 5440 to scan.');
  });

  it('says which unit a known serial already is', () => {
    expect(knownSerialText('CN0F4K37', { product: 'Dell Latitude 5440', serial_no: 'CN0F4K37', status: 'in_stock', warehouse: 'Kandy Branch' })).toBe("CN0F4K37 is already Dell Latitude 5440's unit, in stock at Kandy Branch. Nothing was counted.");
    expect(knownSerialText('X1', {})).toBe('X1 is already a unit in WorkSuite. Nothing was counted.');
  });
});

describe('labels and sheets', () => {
  it('prints one 50 × 25 mm page per label, its text escaped, with a QR code', () => {
    const html = labelsHtml([{ title: 'Bag 14" <grey>', code: 'BAG-14' }]);
    expect(html).toContain('size:50mm 25mm');
    expect(html).toContain('Bag 14&quot; &lt;grey&gt;');
    expect(html).toContain('<svg');
  });

  it('prints a count sheet with a box to write in', () => {
    const html = countSheetHtml({ reference: 'CNT-00005', warehouse: 'Kandy Branch' }, [{ name: 'HP 85A Toner', code: 'HP-85A', bin: 'K-02-01', expected: '9' }]);
    expect(html).toContain('CNT-00005');
    expect(html).toContain('K-02-01');
    expect(html).toContain('class="box"');
  });
});

describe('Product 360 (V2)', () => {
  it('reads its tab from the address and sends a channel’s fix to the right one', () => {
    expect(v2.tab360('media')).toBe('media');
    expect(v2.tab360('nonsense')).toBe('overview');
    expect(v2.fixTab('images')).toBe('media');
    expect(v2.fixTab('specifications')).toBe('specs');
    expect(v2.fixTab('seo')).toBe('seo');
    expect(v2.fixTab(null)).toBe('general');
  });

  it('puts the least complete sections first', () => {
    expect(v2.gaps({ total: 74, sections: { general: 100, images: 60, seo: 40, documents: 90 } }).map((g) => g.key)).toEqual(['seo', 'images', 'documents']);
    expect(v2.scoreTone(95)).toBe('green');
    expect(v2.scoreTone(74)).toBe('amber');
    expect(v2.scoreTone(20)).toBe('red');
  });

  it('moves a picture within the gallery, and keeps alt text before it goes public', () => {
    expect(v2.moved([1, 2, 3], 3, -1)).toEqual([1, 3, 2]);
    expect(v2.moved([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(v2.altMissing({ alt: ' ', public: false }, true)).toBe(true);
    expect(v2.altMissing({ alt: null, public: false }, false)).toBe(false);
    expect(v2.isHeic({ type: '', name: 'IMG_2201.HEIC' })).toBe(true);
  });

  it('sends only the specifications that changed, as the server takes them', () => {
    const specs = {
      set: null,
      groups: [
        {
          name: 'Battery',
          fields: [
            { attribute_id: 1, name: 'Capacity', kind: 'number' as const, unit: 'Wh', required: true, value: 54 },
            { attribute_id: 2, name: 'Colour', kind: 'colour' as const, unit: null, required: false, value: 7 },
            { attribute_id: 3, name: 'Backlit', kind: 'boolean' as const, unit: null, required: false, value: false },
            { attribute_id: 4, name: 'Model', kind: 'text' as const, unit: null, required: false, value: 'L5440' },
          ],
        },
      ],
    };
    expect(v2.specChanges(specs, { '1': '54', '2': '9', '3': '1', '4': '', '99': 'x' })).toEqual({ '2': 9, '3': true, '4': null });
    expect(v2.specText({ value: true })).toBe('1');
  });

  it('reads the server’s refusal of a specification field by field', () => {
    const e = new ApiError(422, 'Check the specifications.', 'invalid_specs', { code: 'invalid_specs', fields: { '1': 'Must be a number with Wh' } });
    expect(v2.specErrors(e)).toEqual({ '1': 'Must be a number with Wh' });
    expect(v2.specErrors(new Error('x'))).toEqual({});
    expect(v2.notOnServer(new ApiError(404, 'Not found', null))).toBe(true);
    expect(v2.notOnServer(new ApiError(500, 'Boom', null))).toBe(false);
  });

  it('offers publishing only when a channel is valid, and taking it down only when it is out', () => {
    const ok = { ok: true, missing: [] };
    expect(v2.channelActions({ state: 'ready', validation: ok })).toEqual({ publish: true, unpublish: false, turnOn: false });
    expect(v2.channelActions({ state: 'draft', validation: { ok: false, missing: [{ field: 'alt', message: 'x', fix_tab: 'media' }] } }).publish).toBe(false);
    expect(v2.channelActions({ state: 'published', validation: ok })).toEqual({ publish: false, unpublish: true, turnOn: false });
    expect(v2.channelActions({ state: 'off', validation: ok })).toEqual({ publish: false, unpublish: false, turnOn: true });
  });

  it('judges a search listing’s lengths and keeps a slug clean', () => {
    expect(v2.seoLength('title', '')).toMatchObject({ tone: 'red', words: 'missing' });
    expect(v2.seoLength('title', 'Branded polo shirt — breathable cotton piqué')).toMatchObject({ tone: 'green' });
    expect(v2.seoLength('description', 'Short.')).toMatchObject({ tone: 'amber', words: 'short' });
    expect(v2.seoLength('description', 'x'.repeat(140))).toMatchObject({ tone: 'green', words: 'good' });
    expect(v2.slugify('  Branded Polo — Piqué Shirt! ')).toBe('branded-polo-pique-shirt');
  });
});

describe('duplicating a product', () => {
  it('copies everything but its code and barcode, and says it is a copy', () => {
    const p = { id: 1, name: 'Dell Latitude 5440', code: 'DL-5440', barcode: '123', kind: 'product', tracking: 'serial', costing_method: 'fifo', unit_price: 312400, cost_price: null, tax_rate: 18, is_stocked: true } as unknown as Parameters<typeof copyDraft>[0];
    expect(copyDraft(p)).toMatchObject({ name: 'Dell Latitude 5440 (copy)', code: '', barcode: '', tracking: 'serial', unit_price: '312400' });
  });
});
