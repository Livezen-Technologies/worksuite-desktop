// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStickToBottom } from '../../../src/components/useStickToBottom';

/**
 * The AI Assistant's conversation follows what arrives (worksuite-desktop#50): the end stays in view while the reader
 * is there, stays put once they scroll up (with "Jump to latest" when something new arrives below), and follows again
 * when they come back or send a message. jsdom lays nothing out, so the scroller's sizes are set by hand.
 */
const observers: Array<() => void> = [];
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: () => void) {
      observers.push(() => this.cb());
    }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A scroller 400px tall whose content is `height` px. */
function sized(el: HTMLElement, box: { height: number }) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => box.height });
  let top = 0;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, box.height - 400))) });
}

const box = { height: 1000 };
let push: (text: string) => void = () => undefined;

function Conversation() {
  const [lines, setLines] = useState<string[]>(['first']);
  push = (t) => setLines((l) => [...l, t]);
  const view = useStickToBottom(lines.length);
  return (
    <div>
      <div data-testid="scroller" ref={(el) => {
        view.scroller.current = el;
        if (el && !('sized' in el.dataset)) {
          el.dataset.sized = '1';
          sized(el, box);
        }
      }} onScroll={view.onScroll}>
        <div ref={view.content}>{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
      </div>
      {view.unseen ? <button type="button" onClick={view.toEnd}>Jump to latest</button> : null}
      <button type="button" onClick={() => { push('question'); view.toEnd(); }}>Send</button>
    </div>
  );
}

const scroller = () => screen.getByTestId('scroller');
const grow = (by: number, how: 'render' | 'resize' = 'render') =>
  act(() => {
    box.height += by;
    if (how === 'render') push(`line ${box.height}`);
    else observers.forEach((o) => o());
  });

beforeEach(() => {
  box.height = 1000;
});

describe('following the conversation', () => {
  it('keeps the end in view as messages and a streaming answer arrive', () => {
    render(<Conversation />);
    expect(scroller().scrollTop).toBe(600);
    grow(300);
    expect(scroller().scrollTop).toBe(900);
    // A streaming answer, an image that loads, the panel resized: the content changes size.
    grow(120, 'resize');
    expect(scroller().scrollTop).toBe(1020);
    expect(screen.queryByText('Jump to latest')).toBeNull();
  });

  it('a reader near the end is still following', () => {
    render(<Conversation />);
    act(() => {
      scroller().scrollTop = 570; // 30px short of the end
      fireEvent.scroll(scroller());
    });
    grow(200);
    expect(scroller().scrollTop).toBe(800);
  });

  it('stays where the reader scrolled up to, and says when something new arrives', () => {
    render(<Conversation />);
    act(() => {
      scroller().scrollTop = 100;
      fireEvent.scroll(scroller());
    });
    expect(screen.queryByText('Jump to latest')).toBeNull();
    grow(300);
    expect(scroller().scrollTop).toBe(100);
    grow(80, 'resize');
    expect(scroller().scrollTop).toBe(100);
    expect(screen.getByText('Jump to latest')).toBeTruthy();
  });

  it('follows again from Jump to latest', () => {
    render(<Conversation />);
    act(() => {
      scroller().scrollTop = 0;
      fireEvent.scroll(scroller());
    });
    grow(300);
    fireEvent.click(screen.getByText('Jump to latest'));
    expect(scroller().scrollTop).toBe(900);
    expect(screen.queryByText('Jump to latest')).toBeNull();
    grow(100, 'resize');
    expect(scroller().scrollTop).toBe(1000);
  });

  it('follows again once the reader scrolls back to the end', () => {
    render(<Conversation />);
    act(() => {
      scroller().scrollTop = 0;
      fireEvent.scroll(scroller());
    });
    grow(300);
    expect(screen.getByText('Jump to latest')).toBeTruthy();
    act(() => {
      scroller().scrollTop = 900;
      fireEvent.scroll(scroller());
    });
    expect(screen.queryByText('Jump to latest')).toBeNull();
    grow(100);
    expect(scroller().scrollTop).toBe(1000);
  });

  it('sending a message goes back to the end from wherever the reader was', () => {
    render(<Conversation />);
    act(() => {
      scroller().scrollTop = 0;
      fireEvent.scroll(scroller());
    });
    act(() => {
      box.height += 60;
      fireEvent.click(screen.getByText('Send'));
    });
    expect(scroller().scrollTop).toBe(660);
    grow(200);
    expect(scroller().scrollTop).toBe(860);
  });
});
