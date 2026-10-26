// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(async () => ({ results: [] })) }));

import { MentionPopup } from '../../../src/modules/mail/Mentions';

/**
 * The @mention list closes a moment after the editor loses focus. That timer belonged to nothing: closing the
 * composer inside those 150 ms left it to set state on an unmounted editor — after a test's jsdom was gone,
 * "ReferenceError: window is not defined" from react-dom (audit D-G15, Build run 40373841257,
 * mail-compose-layout.test.tsx). The timer is now the effect's, cleared when it goes.
 */
function Editor() {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <>
      <div ref={ref} contentEditable data-testid="editor" />
      <MentionPopup editor={ref} onMention={() => undefined} />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the @mention list in Mail (D-G15)', () => {
  it('leaves no timer behind when the composer closes right after the editor loses focus', () => {
    vi.useFakeTimers();
    const view = render(<Editor />);
    const editor = view.getByTestId('editor');
    act(() => {
      editor.dispatchEvent(new FocusEvent('blur'));
    });
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still closes the list after the pause while the editor is there', () => {
    vi.useFakeTimers();
    const view = render(<Editor />);
    const editor = view.getByTestId('editor');
    act(() => {
      editor.dispatchEvent(new FocusEvent('blur'));
      editor.dispatchEvent(new FocusEvent('blur'));
    });
    // A second blur replaces the first timer rather than adding one.
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
