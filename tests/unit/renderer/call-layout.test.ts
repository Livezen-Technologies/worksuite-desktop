import { describe, expect, it } from 'vitest';
import { computeLayout, gridColumns, nearestCorner, pipRect, type LayoutInput } from '../../../src/modules/calls/ui/layout';
import { featured, type CallPerson } from '../../../src/modules/calls/ui/people';

const base: LayoutInput = { width: 1440, height: 900, people: 2, primary: false, panelOpen: false, panelWidth: 360, fullscreen: false, floating: false, mode: 'auto' };
const person = (id: string, o: Partial<CallPerson> = {}): CallPerson => ({ id, name: id, self: false, speaking: false, micOn: true, camera: null, screen: null, screenPaused: false, ...o });

describe('the call layout manager', () => {
  it('puts a shared screen on stage with the person in the corner, and the panel beside it', () => {
    const l = computeLayout({ ...base, primary: true, panelOpen: true });
    expect(l.resolved).toBe('screen-focus');
    expect(l.pip).toBe(true);
    expect(l.panel).toEqual({ docked: true, rect: { x: 1080, y: 44, width: 360, height: 856 } });
    expect(l.stage).toEqual({ x: 0, y: 44, width: 1080, height: 856 });
  });

  it('lays the panel over the call when the stage would be too narrow beside it', () => {
    const l = computeLayout({ ...base, width: 800, primary: true, panelOpen: true, panelWidth: 420 });
    expect(l.panel?.docked).toBe(false);
    expect(l.stage.width).toBe(800);
  });

  it('honours the layout chosen while sharing, when it fits', () => {
    expect(computeLayout({ ...base, primary: true, mode: 'side' }).resolved).toBe('screen-side');
    expect(computeLayout({ ...base, primary: true, mode: 'grid' }).resolved).toBe('screen-grid');
    expect(computeLayout({ ...base, width: 640, primary: true, mode: 'side' }).resolved).toBe('screen-focus');
  });

  it('shows two people as speaker and PiP, three to nine as a grid, more as speaker with a strip', () => {
    expect(computeLayout(base)).toMatchObject({ resolved: 'speaker', pip: true, strip: false });
    expect(computeLayout({ ...base, people: 4 })).toMatchObject({ resolved: 'grid', columns: 2 });
    expect(computeLayout({ ...base, people: 7 })).toMatchObject({ resolved: 'grid', columns: 3 });
    expect(computeLayout({ ...base, people: 12 })).toMatchObject({ resolved: 'speaker', strip: true });
    expect(computeLayout({ ...base, people: 4, mode: 'focus' })).toMatchObject({ resolved: 'speaker', strip: true });
    expect(gridColumns(1)).toBe(1);
    expect(gridColumns(10)).toBe(4);
  });

  it('gives the floating card the whole window and compact controls', () => {
    expect(computeLayout({ ...base, width: 380, height: 250, floating: true, panelOpen: true })).toMatchObject({ resolved: 'floating', panel: null, compactControls: true });
  });

  it('docks the PiP box to a corner clear of the controls, and settles a drag in the nearest corner', () => {
    const stage = { width: 1000, height: 600 };
    expect(pipRect(stage, 'tr', 240, 84)).toEqual({ x: 744, y: 16, width: 240, height: 135 });
    expect(pipRect(stage, 'br', 240, 84)).toEqual({ x: 744, y: 365, width: 240, height: 135 });
    expect(nearestCorner(stage, 100, 100)).toBe('tl');
    expect(nearestCorner(stage, 900, 500)).toBe('br');
  });

  it('features the person sharing, else whoever speaks, else the last speaker', () => {
    const me = person('me', { self: true });
    const a = person('a');
    const b = person('b');
    expect(featured([me, a, b], null)?.id).toBe('a');
    expect(featured([me, a, b], 'b')?.id).toBe('b');
    expect(featured([me, a, { ...b, speaking: true }], null)?.id).toBe('b');
    expect(featured([me, { ...a, screen: {} as never }, { ...b, speaking: true }], null)?.id).toBe('a');
    expect(featured([me], null)?.id).toBe('me');
  });
});
