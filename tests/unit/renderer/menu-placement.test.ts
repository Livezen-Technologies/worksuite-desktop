import { describe, expect, it } from 'vitest';
import { placeMenu, sheetMode, SHEET_BELOW } from '../../../src/components/menuPlacement';

const viewport = { width: 1200, height: 800 };
// A More button in a toolbar along the bottom of the window.
const button = { left: 600, top: 720, width: 44, height: 44 };

describe('placeMenu', () => {
  it('opens above a bottom toolbar, centred on its button, at its natural height', () => {
    const p = placeMenu({ trigger: button, menu: { width: 280, height: 400 }, viewport, prefer: 'top', gap: 10 });
    expect(p.side).toBe('top');
    expect(p.top).toBe(720 - 10 - 400);
    expect(p.left).toBe(622 - 140);
    expect(p.maxHeight).toBe(720 - 10 - 8);
  });

  it('measures the room above from the toolbar it must not cover, not just the button', () => {
    const bar = { left: 300, top: 690, width: 600, height: 90 };
    const p = placeMenu({ trigger: button, menu: { width: 280, height: 300 }, viewport, prefer: 'top', gap: 10, avoid: bar });
    expect(p.side).toBe('top');
    expect(p.top + 300).toBeLessThanOrEqual(bar.top - 10);
  });

  it('flips below when there is not room above but there is below', () => {
    const high = { left: 600, top: 40, width: 44, height: 32 };
    const p = placeMenu({ trigger: high, menu: { width: 280, height: 400 }, viewport, prefer: 'top', gap: 8 });
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(40 + 32 + 8);
  });

  it('keeps the side with more room and caps the height there when it fits on neither (the menu scrolls)', () => {
    const p = placeMenu({ trigger: { left: 600, top: 500, width: 44, height: 44 }, menu: { width: 280, height: 900 }, viewport, prefer: 'top', gap: 8, margin: 8 });
    expect(p.side).toBe('top');
    expect(p.maxHeight).toBe(500 - 8 - 8);
    expect(p.top).toBe(8);
  });

  it('shifts sideways to stay inside the window, and narrows to it in a tiny one', () => {
    const atEdge = placeMenu({ trigger: { left: 1170, top: 720, width: 24, height: 44 }, menu: { width: 280, height: 200 }, viewport, prefer: 'top' });
    expect(atEdge.left).toBe(1200 - 8 - 280);
    const atStart = placeMenu({ trigger: { left: 2, top: 720, width: 24, height: 44 }, menu: { width: 280, height: 200 }, viewport, prefer: 'top' });
    expect(atStart.left).toBe(8);
    const tiny = placeMenu({ trigger: { left: 100, top: 300, width: 24, height: 24 }, menu: { width: 280, height: 200 }, viewport: { width: 200, height: 400 }, prefer: 'top' });
    expect(tiny.maxWidth).toBe(184);
    expect(tiny.left).toBe(8);
  });

  it('lines up with the end of the button when asked (the leave menu)', () => {
    const p = placeMenu({ trigger: button, menu: { width: 200, height: 100 }, viewport, prefer: 'top', align: 'end' });
    expect(p.left).toBe(644 - 200);
    const rtl = placeMenu({ trigger: button, menu: { width: 200, height: 100 }, viewport, prefer: 'top', align: 'end', rtl: true });
    expect(rtl.left).toBe(600);
  });

  it('puts a submenu beside its item, flipping to the other side at the window edge', () => {
    const item = { left: 400, top: 300, width: 280, height: 36 };
    const right = placeMenu({ trigger: item, menu: { width: 260, height: 200 }, viewport, prefer: 'end', gap: 2 });
    expect(right.side).toBe('end');
    expect(right.left).toBe(682);
    expect(right.top).toBe(300);
    const nearEdge = placeMenu({ trigger: { ...item, left: 900 }, menu: { width: 260, height: 200 }, viewport, prefer: 'end', gap: 2 });
    expect(nearEdge.side).toBe('start');
    expect(nearEdge.left).toBe(900 - 2 - 260);
  });

  it('opens a submenu to the left in a right-to-left layout', () => {
    const item = { left: 400, top: 300, width: 280, height: 36 };
    const p = placeMenu({ trigger: item, menu: { width: 260, height: 200 }, viewport, prefer: 'end', gap: 2, rtl: true });
    expect(p.side).toBe('end');
    expect(p.left).toBe(400 - 2 - 260);
  });

  it('moves a submenu up so its bottom stays on screen', () => {
    const item = { left: 400, top: 700, width: 280, height: 36 };
    const p = placeMenu({ trigger: item, menu: { width: 260, height: 300 }, viewport, prefer: 'end', margin: 8 });
    expect(p.top).toBe(800 - 8 - 300);
    expect(p.maxHeight).toBe(784);
  });

  it('scales with the display: the same layout in CSS pixels at 125% and 200%', () => {
    // Display scaling changes device pixels, not CSS pixels: the window reports a smaller viewport, and the menu still fits it.
    for (const scale of [1.25, 2]) {
      const vp = { width: Math.round(1920 / scale), height: Math.round(1080 / scale) };
      const p = placeMenu({ trigger: { left: vp.width / 2, top: vp.height - 70, width: 44, height: 44 }, menu: { width: 288, height: 620 }, viewport: vp, prefer: 'top', gap: 10 });
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(Math.min(620, p.maxHeight) + p.top).toBeLessThanOrEqual(vp.height - 70 - 10);
      expect(p.left + 288).toBeLessThanOrEqual(vp.width - 8);
    }
  });
});

describe('sheetMode', () => {
  it('uses a bottom sheet below the breakpoint', () => {
    expect(SHEET_BELOW).toBe(640);
    expect(sheetMode(639)).toBe(true);
    expect(sheetMode(640)).toBe(false);
    expect(sheetMode(500, 480)).toBe(false);
  });
});
