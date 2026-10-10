import { describe, expect, it, vi } from 'vitest';
import { ShareBar, barBounds } from '../../../electron/services/share-bar';
import type { GrantedSource } from '../../../electron/services/screen-share';
import type { ShareBarState } from '@shared/share-bar';

/**
 * The sharing bar (WS-MEET-ENH-01 D03).
 *
 * What these protect: the bar belongs to the window that is sharing and to no
 * other, so a second meeting cannot redraw or drive somebody else's bar; and a
 * bar that cannot open never stops a share, because every control it carries
 * is still in the call window.
 */

const source = (over: Partial<GrantedSource> = {}): GrantedSource => ({ id: 'screen:1', name: 'Figma', kind: 'window', displayId: null, windowId: '42', at: Date.now(), ...over });
const display = (id: number, x: number, width: number) => ({ id, workArea: { x, y: 0, width, height: 1080 } }) as never;
const state = (over: Partial<ShareBarState> = {}): ShareBarState => ({ label: 'Figma', paused: false, micOn: true, cameraOn: false, unreadChat: 0, since: 1, ...over });

function harness(opts: { failOpen?: boolean } = {}) {
  const opened: string[] = [];
  const sent: Array<ShareBarState | null> = [];
  let closed = 0;
  const win = {
    isDestroyed: () => false,
    close: () => void closed++,
    on: () => undefined,
    setBounds: () => undefined,
  };
  const bar = new ShareBar({
    open: (hash) => {
      if (opts.failOpen) throw new Error('no display');
      opened.push(hash);

      return win as never;
    },
    send: (_win, s) => void sent.push(s),
    place: () => ({ x: 0, y: 0, width: 620, height: 56 }),
  });

  return { bar, opened, sent, closed: () => closed };
}

describe('where the bar sits', () => {
  it('centres at the top of the display being shared', () => {
    const displays = [display(1, 0, 1920), display(2, 1920, 2560)];
    const b = barBounds(source({ displayId: '2' }), displays, displays[0]!);

    expect(b.x).toBe(1920 + Math.round((2560 - 620) / 2));
    expect(b.y).toBe(14);
    expect(b.width).toBe(620);
  });

  it('falls back to the primary display when the share names none', () => {
    const displays = [display(1, 0, 1920)];

    expect(barBounds(source({ displayId: null }), displays, displays[0]!).x).toBe(Math.round((1920 - 620) / 2));
  });

  it('falls back to the primary display when the named one is gone', () => {
    const displays = [display(1, 0, 1920)];

    expect(barBounds(source({ displayId: '99' }), displays, displays[0]!).x).toBe(Math.round((1920 - 620) / 2));
  });
});

describe('raising and dropping it', () => {
  it('opens its own window on its own route when a share starts', () => {
    const h = harness();

    h.bar.start(7, source());
    expect(h.opened).toEqual(['/share/bar']);
    expect(h.bar.sharer()).toBe(7);
  });

  it('keeps one bar when the same window shares something else', () => {
    const h = harness();

    h.bar.start(7, source());
    h.bar.start(7, source({ name: 'Sheets' }));
    expect(h.opened).toHaveLength(1);
  });

  it('replaces it when another window starts sharing: there is one screen to show it on', () => {
    const h = harness();

    h.bar.start(7, source());
    h.bar.start(9, source());
    expect(h.opened).toHaveLength(2);
    expect(h.closed()).toBe(1);
    expect(h.bar.sharer()).toBe(9);
  });

  it('closes on the share ending, and forgets what it was showing', () => {
    const h = harness();

    h.bar.start(7, source());
    h.bar.update(7, state());
    h.bar.stop(7);
    expect(h.closed()).toBe(1);
    expect(h.bar.sharer()).toBeNull();
    expect(h.bar.current()).toBeNull();
  });

  it('ignores a stop from a window that is not the sharer', () => {
    const h = harness();

    h.bar.start(7, source());
    h.bar.stop(9);
    expect(h.closed()).toBe(0);
    expect(h.bar.sharer()).toBe(7);
  });

  it('carries on when the bar cannot open at all', () => {
    // Every control it has is still in the call window; a bar that failed to
    // open must never be the reason a share does not start.
    const h = harness({ failOpen: true });

    expect(() => h.bar.start(7, source())).not.toThrow();
    expect(h.bar.sharer()).toBeNull();
  });
});

describe('what it is told', () => {
  it('passes the meeting’s state to the bar’s window', () => {
    const h = harness();

    h.bar.start(7, source());
    h.bar.update(7, state({ paused: true }));
    expect(h.sent.at(-1)).toEqual(state({ paused: true }));
    expect(h.bar.current()?.paused).toBe(true);
  });

  it('refuses a report from a window that is not sharing', () => {
    // A second meeting window must not redraw somebody else's bar.
    const h = harness();

    h.bar.start(7, source());
    h.bar.update(9, state({ label: 'Somebody else’s screen' }));
    expect(h.sent).toHaveLength(0);
    expect(h.bar.current()).toBeNull();
  });

  it('says nothing before a share, so there is no state to read', () => {
    const h = harness();

    h.bar.update(7, state());
    expect(h.bar.current()).toBeNull();
  });

  it('survives a send that throws', () => {
    const bar = new ShareBar({
      open: () => ({ isDestroyed: () => false, close: () => undefined, on: () => undefined, setBounds: () => undefined }) as never,
      send: () => {
        throw new Error('window gone');
      },
      place: () => ({ x: 0, y: 0, width: 620, height: 56 }),
    });

    bar.start(7, source());
    expect(() => bar.update(7, state())).not.toThrow();
  });
});

describe('the screen-share service raises it', () => {
  it('tells the bar about every share signal, and asks for none without a granted source', async () => {
    vi.resetModules();
    const { ScreenShare } = await import('../../../electron/services/screen-share');
    const share = new ScreenShare(() => true);
    const calls: Array<[number, string | null]> = [];

    share.onShare = (id, src) => void calls.push([id, src?.name ?? null]);
    // No source granted: indicating a share has nothing to draw a bar for.
    share.indicate(7, true);
    share.indicate(7, false);
    expect(calls).toEqual([
      [7, null],
      [7, null],
    ]);
  });
});
