// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { holdKeyName, isHoldKey, typingIn, usePushToTalk, type HoldEvent, type PushToTalkTarget } from '../../../src/modules/meet/pushToTalk';
import { DEFAULT_SHORTCUTS, isGlobalShortcut, shortcutMeta } from '../../../src/core/commands';

afterEach(cleanup);

/**
 * Push to talk (WS-MEET-ENH-01 D06).
 *
 * These pin the things that would break *silently*. The default key is the
 * bare space bar, which means every mistake here is either a microphone that
 * opens when it should not, or a space bar that stops typing a space — and
 * neither shows up as an error anywhere.
 */

const ev = (over: Partial<HoldEvent> = {}): HoldEvent => ({
  key: ' ',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...over,
});

describe('push to talk · the key', () => {
  it('is the space bar by default, and listed as an in-app key', () => {
    expect(DEFAULT_SHORTCUTS['meet-push-to-talk']).toBe('Space');
    expect(shortcutMeta('meet-push-to-talk')).toEqual({ area: 'Meet', scope: 'app' });
  });

  it('is never held for the whole computer', () => {
    // A bare Space taken system-wide would break the space bar in every other
    // app on the machine.
    expect(isGlobalShortcut('meet-push-to-talk')).toBe(false);
  });

  it('matches the space bar however the accelerator spells it', () => {
    // `Space` is the default's spelling; `' '` is what the shortcuts page's own
    // recorder stores when somebody records the key themselves.
    expect(isHoldKey(ev(), 'Space')).toBe(true);
    expect(isHoldKey(ev(), ' ')).toBe(true);
    expect(holdKeyName(' ')).toBe('Space');
  });

  it('matches a letter key set in its place', () => {
    expect(isHoldKey(ev({ key: 'z' }), 'Z')).toBe(true);
    expect(isHoldKey(ev({ key: 'z' }), 'X')).toBe(false);
  });

  it('ignores the key with any modifier held', () => {
    // ⌘Space is Spotlight and ⌃Space an input switcher: taking either would
    // open a microphone when somebody meant to do something else entirely.
    expect(isHoldKey(ev({ metaKey: true }), 'Space')).toBe(false);
    expect(isHoldKey(ev({ ctrlKey: true }), 'Space')).toBe(false);
    expect(isHoldKey(ev({ altKey: true }), 'Space')).toBe(false);
    expect(isHoldKey(ev({ shiftKey: true }), 'Space')).toBe(false);
  });

  it('ignores a key repeat', () => {
    // A held key fires over and over; the repeats must not read as new presses.
    expect(isHoldKey(ev({ repeat: true }), 'Space')).toBe(false);
  });

  it('refuses a chord, because a chord cannot be a hold key', () => {
    expect(isHoldKey(ev(), 'Mod+Space')).toBe(false);
    expect(isHoldKey(ev(), '')).toBe(false);
    expect(isHoldKey(ev(), null)).toBe(false);
  });
});

describe('push to talk · what it leaves alone', () => {
  it('leaves the key to whatever is being typed into', () => {
    const page = document.createElement('div');

    page.innerHTML = '<input id="a"><textarea id="b"></textarea><div id="c" contenteditable="true"><span id="d">x</span></div><button id="e">go</button>';
    document.body.append(page);

    // The chat composer and a name field get their space; the hold key is only
    // the hold key where a space would otherwise do nothing.
    expect(typingIn(page.querySelector('#a'))).toBe(true);
    expect(typingIn(page.querySelector('#b'))).toBe(true);
    expect(typingIn(page.querySelector('#d'))).toBe(true);
    expect(typingIn(page.querySelector('#e'))).toBe(false);
    expect(typingIn(null)).toBe(false);

    page.remove();
  });
});

/**
 * The hold itself. Every one of these is a microphone that would otherwise be
 * left open, or closed, without anybody being told.
 */

function Harness(props: Partial<PushToTalkTarget> & { setMic: PushToTalkTarget['setMic'] }) {
  usePushToTalk({ accelerator: 'Space', micOn: false, mayMic: true, ...props });

  return <div>in a call</div>;
}

const down = (over: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, ...over }));
const up = (over: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, ...over }));

describe('push to talk · the hold', () => {
  it('opens the microphone while down and closes it on release', () => {
    const setMic = vi.fn();

    render(<Harness setMic={setMic} />);
    down();
    expect(setMic.mock.calls).toEqual([[true]]);
    up();
    expect(setMic.mock.calls).toEqual([[true], [false]]);
  });

  it('does nothing at all when the microphone is already live', () => {
    // Otherwise letting go would mute somebody mid-sentence in a sentence they
    // had already chosen to say out loud.
    const setMic = vi.fn();

    render(<Harness micOn setMic={setMic} />);
    down();
    up();
    expect(setMic).not.toHaveBeenCalled();
  });

  it('does nothing when the host has turned microphones off', () => {
    // The key is not a second permission: `mayMic` is the meeting's answer and
    // the mute button reads the same one.
    const setMic = vi.fn();

    render(<Harness mayMic={false} setMic={setMic} />);
    down();
    expect(setMic).not.toHaveBeenCalled();
  });

  it('releases when the window loses focus', () => {
    // A key held while you switch apps never delivers its keyup, and the
    // failure mode is a live microphone in a meeting its owner walked away
    // from.
    const setMic = vi.fn();

    render(<Harness setMic={setMic} />);
    down();
    window.dispatchEvent(new Event('blur'));
    expect(setMic.mock.calls).toEqual([[true], [false]]);
  });

  it('releases when the meeting window goes away mid-hold', () => {
    const setMic = vi.fn();
    const view = render(<Harness setMic={setMic} />);

    down();
    view.unmount();
    expect(setMic.mock.calls).toEqual([[true], [false]]);
  });

  it('releases once, however many times the key comes up', () => {
    const setMic = vi.fn();

    render(<Harness setMic={setMic} />);
    down();
    up();
    up();
    expect(setMic.mock.calls).toEqual([[true], [false]]);
  });

  it('releases even when a modifier was pressed during the hold', () => {
    // ⇧Space while talking still means the space bar is down.
    const setMic = vi.fn();

    render(<Harness setMic={setMic} />);
    down();
    up({ shiftKey: true });
    expect(setMic.mock.calls).toEqual([[true], [false]]);
  });

  it('takes the hold only once while the key repeats', () => {
    const setMic = vi.fn();

    render(<Harness setMic={setMic} />);
    down();
    down({ repeat: true });
    down({ repeat: true });
    expect(setMic.mock.calls).toEqual([[true]]);
  });

  it('stops the space bar scrolling the call while it is being used to talk', () => {
    render(<Harness setMic={vi.fn()} />);
    const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });

    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});
