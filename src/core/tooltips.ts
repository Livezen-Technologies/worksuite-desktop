/**
 * Tooltips (worksuite-desktop#285). An element's `title` is drawn by the app rather than the system: the system's own
 * tooltip outlived what it belonged to — the message box's "Emoji" stayed over the conversation after the box changed
 * under the pointer. Ours goes when the pointer leaves the element, on any scroll, wheel, click, key or drag, when the
 * window loses focus or is hidden, and when the element leaves the page, so none is ever left on screen.
 *
 * Every `title` in the app works this way without any change to it. While the pointer is on an element its words wait
 * in `data-tip` (so the system's tooltip cannot appear as well) and go back to `title` when the pointer leaves; an
 * element named only by its title keeps that name meanwhile, and the tooltip describes the element it is shown for.
 * Text being edited (a mail, a document) is never touched: it keeps the system's tooltip.
 */

/** How long the pointer rests on an element before its tooltip shows, as the system's does. */
export const TOOLTIP_DELAY = 600;
const TIP_ID = 'ws-tooltip';
/** Keeps it clear of the pointer and of the window's edges. */
const GAP = 8;

export function wireTooltips(doc: Document = document): () => void {
  const win = doc.defaultView ?? window;
  let held: Element | null = null;
  let words = '';
  // What we added to `held` and take away again.
  let named = false;
  let described: string | null = null;
  let tip: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Hidden by a click or a scroll: not shown again until the pointer comes back to the element.
  let quiet = false;
  let at = { x: 0, y: 0 };
  const watch = new MutationObserver(() => {
    if (!held) return;
    if (!held.isConnected) return forget();
    // The element's title was changed while it was held: the new words are the ones to show.
    const now = held.getAttribute('title');
    if (now !== null) {
      held.removeAttribute('title');
      if (now) words = now;
      if (named) held.setAttribute('aria-label', words);
      if (tip) tip.textContent = words;
    }
  });

  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    tip?.remove();
    tip = null;
    if (held && described !== null) {
      if (described) held.setAttribute('aria-describedby', described);
      else held.removeAttribute('aria-describedby');
    }
    described = null;
  };
  /** The element is gone from the page: nothing to give back. */
  const forget = () => {
    hide();
    watch.disconnect();
    held = null;
    named = false;
  };
  /**
   * The title the element is meant to have now. React writes a changed title to the page, which `watch` sees, but a
   * title it takes away it only removes — from an element that has none while held — so React's own props say.
   */
  const intended = (el: Element): string | null => {
    const props = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    if (!props) return words || null;
    const title = (el as unknown as Record<string, { title?: unknown } | undefined>)[props]?.title;
    return typeof title === 'string' && title ? title : null;
  };
  /** The pointer left: the element has its title again. */
  const release = () => {
    const el = held;
    hide();
    watch.disconnect();
    held = null;
    if (el?.isConnected) {
      const title = intended(el);
      if (title && !el.hasAttribute('title')) el.setAttribute('title', title);
      el.removeAttribute('data-tip');
      if (named) el.removeAttribute('aria-label');
    }
    named = false;
  };
  const show = () => {
    timer = null;
    if (!held || !words || quiet || !held.isConnected) return;
    const t = doc.createElement('div');
    t.id = TIP_ID;
    t.setAttribute('role', 'tooltip');
    t.className = 'pointer-events-none fixed z-[1000] max-w-[320px] rounded-[6px] bg-ink px-2 py-1 text-[11.5px] leading-[1.35] break-words whitespace-pre-line text-surface shadow-[0_4px_14px_rgb(var(--ws-shadow-rgb)/.25)]';
    t.textContent = words;
    doc.body.appendChild(t);
    tip = t;
    // Below the pointer, as the system places one; above it, or further left, where the window ends.
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const left = Math.max(GAP, Math.min(at.x, win.innerWidth - w - GAP));
    const top = at.y + 20 + h + GAP > win.innerHeight ? Math.max(GAP, at.y - h - GAP) : at.y + 20;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
    described = held.getAttribute('aria-describedby') ?? '';
    if (!named) held.setAttribute('aria-describedby', `${described} ${TIP_ID}`.trim());
  };
  const hold = (el: Element) => {
    held = el;
    words = el.getAttribute('title') ?? '';
    quiet = false;
    el.setAttribute('data-tip', words);
    el.removeAttribute('title');
    // An icon button named only by its title keeps its name while the title waits.
    named = !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.hasAttribute('alt') && !(el.textContent ?? '').trim();
    if (named) el.setAttribute('aria-label', words);
    watch.observe(doc.body, { childList: true, subtree: true });
    watch.observe(el, { attributes: true, attributeFilter: ['title'] });
    timer = setTimeout(show, TOOLTIP_DELAY);
  };

  const over = (e: Event) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    // The held element has no title of its own while held: what is found is inside it, or around it.
    const el = target.closest('[title]');
    if (held && held.contains(target) && !(el && el !== held && held.contains(el))) return;
    if (held) release();
    // What is being written (a mail's or a document's text) is left exactly as it is, its title too.
    if (el && el.tagName !== 'IFRAME' && el.getAttribute('title') && !el.closest('[contenteditable]:not([contenteditable="false"])')) hold(el);
  };
  const out = (e: Event) => {
    if (!held) return;
    const to = (e as MouseEvent).relatedTarget;
    if (to instanceof Node && held.contains(to)) return;
    release();
  };
  const move = (e: Event) => {
    const m = e as MouseEvent;
    at = { x: m.clientX, y: m.clientY };
  };
  /** A click, a key, a scroll: the tooltip goes, and stays gone while the pointer is still on the element. */
  const dismiss = () => {
    if (!held) return;
    quiet = true;
    hide();
  };
  const leaveWindow = () => (held ? release() : undefined);

  const opts = { capture: true, passive: true } as const;
  doc.addEventListener('mouseover', over, opts);
  doc.addEventListener('mouseout', out, opts);
  doc.addEventListener('mousemove', move, opts);
  for (const type of ['mousedown', 'pointerdown', 'click', 'contextmenu', 'keydown', 'wheel', 'scroll', 'dragstart'] as const) doc.addEventListener(type, dismiss, opts);
  // The page's own scroll reaches the window without passing the document's listeners.
  win.addEventListener('scroll', dismiss, opts);
  win.addEventListener('blur', leaveWindow);
  doc.addEventListener('visibilitychange', leaveWindow);
  doc.documentElement.addEventListener('mouseleave', leaveWindow);
  return () => {
    release();
    doc.removeEventListener('mouseover', over, opts);
    doc.removeEventListener('mouseout', out, opts);
    doc.removeEventListener('mousemove', move, opts);
    for (const type of ['mousedown', 'pointerdown', 'click', 'contextmenu', 'keydown', 'wheel', 'scroll', 'dragstart'] as const) doc.removeEventListener(type, dismiss, opts);
    win.removeEventListener('scroll', dismiss, opts);
    win.removeEventListener('blur', leaveWindow);
    doc.removeEventListener('visibilitychange', leaveWindow);
    doc.documentElement.removeEventListener('mouseleave', leaveWindow);
  };
}
