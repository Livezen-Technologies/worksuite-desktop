import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Within this many pixels of the end counts as at the end: a reader a line short of it is still following. */
const NEAR = 48;
/** Room left above an answer shown from its start, so the question before it still peeks in. */
const REVEAL_GAP = 8;

/**
 * A conversation that follows what arrives (worksuite-desktop#50): while the reader is at (or near) the end, new
 * messages, a streaming answer, an image that loads and the panel changing size all keep the end in view; once they
 * scroll up to read, it stays where they put it and says that something new has arrived below (`unseen`), until they
 * come back to the end or `toEnd()` is called (Jump to latest, or sending a message).
 *
 * Put `scroller` on the element that scrolls and `content` on the one inside it that grows. `changed` is anything
 * whose change means new content (for environments with no ResizeObserver, and to follow at once in the same frame).
 */
export function useStickToBottom(changed: unknown): {
  scroller: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  pinned: boolean;
  unseen: boolean;
  toEnd: () => void;
  reveal: (el: Element | null | undefined) => void;
  onScroll: () => void;
} {
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const lastHeight = useRef(0);

  const atEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR;

  const pin = useCallback((on: boolean) => {
    pinnedRef.current = on;
    setPinned(on);
    if (on) setUnseen(false);
  }, []);

  const jump = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastHeight.current = el.scrollHeight;
  }, []);

  /** Something changed size: keep the end in view for a reader following it, and tell one who is not. */
  const follow = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const grew = el.scrollHeight > lastHeight.current;
    if (pinnedRef.current) jump();
    else if (grew) setUnseen(true);
    lastHeight.current = el.scrollHeight;
  }, [jump]);

  const toEnd = useCallback(() => {
    pin(true);
    jump();
  }, [jump, pin]);

  /**
   * A long answer that has just landed, for a reader following the conversation (worksuite-desktop#150): shown from its
   * first line rather than its last, so it is never read from mid-sentence. One that fits is simply followed to the end.
   * The view then stays put, as it does for a reader who scrolled up — without "Jump to latest", nothing is unseen.
   */
  const reveal = useCallback(
    (target: Element | null | undefined) => {
      const el = scroller.current;
      if (!el || !target || !pinnedRef.current) return;
      const top = el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top;
      const end = el.scrollHeight - el.clientHeight;
      if (top >= end) return jump();
      el.scrollTop = Math.max(0, top - REVEAL_GAP);
      lastHeight.current = el.scrollHeight;
      pin(atEnd(el));
    },
    [jump, pin],
  );

  // Only the reader moves the view away from the end; following it never does, because growing content does not scroll.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const end = atEnd(el);
    if (end !== pinnedRef.current) pin(end);
  }, [pin]);

  useEffect(() => {
    follow();
  }, [changed, follow]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => follow());
    if (scroller.current) ro.observe(scroller.current);
    if (content.current) ro.observe(content.current);
    return () => ro.disconnect();
  }, [follow]);

  return { scroller, content, pinned, unseen, toEnd, reveal, onScroll };
}
