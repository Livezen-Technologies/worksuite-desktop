import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage, isMac } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { Spinner, cx } from '../../../components/ui';
import { clampSlide, moveSlide, slideLabel, startSlide } from './deck';
import { ZOOM_STEPS, parseZoom, slideBox, slideScale, stepZoom, zoomLabel, zoomValue, type SlideZoom, type Size } from './fit';
import { typingTarget, viewerAction } from './keys';
import { present } from './present';
import { openDeck, type Deck } from './render';
import { SlideCanvas } from './SlideCanvas';

/**
 * The presentation viewer (worksuite-desktop#321), the same in Files, Chat, Mail and Tenders: the slides drawn by the
 * Slides engine at the screen's full resolution, fitted to the space between the header and the bar below, centred
 * and never cropped; thumbnails down the left (collapsible) with the current slide marked; and a bar with
 * ‹ Slide 1 of 8 ›, the zoom (Fit slide, Fit width, 50–200%), Present ▶, Download and Open in WorkSuite Office.
 *
 * Keys: ← → ↑ ↓ Page Up / Page Down / Space change slides, Home / End the first and last, ⌘+ ⌘− ⌘0 zoom, ⌘⏎ / F5
 * present from the start and ⇧⌘⏎ / ⇧F5 from the current slide (Ctrl on Windows and Linux).
 */
export interface SlidesViewerProps {
  name: string;
  /** The .pptx's bytes. */
  load: (signal: AbortSignal) => Promise<Uint8Array>;
  onDownload?: () => void;
  onOpenInOffice?: () => void;
  /** Keys are this viewer's while true (it is on screen, nothing is over it). */
  active?: boolean;
  start?: number;
  className?: string;
}

const THUMBS_KEY = 'ws.slides.thumbs';
function readThumbs(): boolean {
  try {
    return localStorage.getItem(THUMBS_KEY) !== '0';
  } catch {
    return true;
  }
}
function saveThumbs(on: boolean): void {
  try {
    localStorage.setItem(THUMBS_KEY, on ? '1' : '0');
  } catch {
    /* a private window: remembered for this viewer only */
  }
}

/** Follows an element's size (the window, a panel or the chat drawer resizing). */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function SlidesViewer({ name, load, onDownload, onOpenInOffice, active = true, start = 0, className }: SlidesViewerProps) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const bytes = useRef<Uint8Array | null>(null);
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState<SlideZoom>('fit');
  const [thumbs, setThumbs] = useState(readThumbs);
  const [stage, area] = useElementSize<HTMLDivElement>();
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  useEffect(() => {
    const ctl = new AbortController();
    let opened: Deck | null = null;
    let gone = false;
    void (async () => {
      try {
        const data = await loader.current(ctl.signal);
        if (gone) return;
        bytes.current = data;
        opened = await openDeck(data);
        if (gone) {
          opened.dispose();
          return;
        }
        setDeck(opened);
        setIndex((i) => clampSlide(i, opened!.count));
      } catch (e) {
        if (gone) return;
        console.error('[slides] could not open a presentation', { error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
        setError(errorMessage(e) || 'This presentation could not be read.');
      }
    })();
    return () => {
      gone = true;
      ctl.abort();
      opened?.dispose();
      setDeck(null);
    };
  }, [attempt]);

  const count = deck?.count ?? 0;
  const slide = { width: deck?.width ?? 16, height: deck?.height ?? 9 };
  const scale = slideScale(area, slide, zoom);
  const box = slideBox(area, slide, zoom);

  const go = useCallback((i: number) => setIndex(clampSlide(i, count)), [count]);
  const startShow = useCallback(
    (fromCurrent: boolean) => {
      if (!deck || !bytes.current) return;
      void present({ name, bytes: bytes.current, start: startSlide(index, deck.count, fromCurrent), onEnd: (i) => setIndex(clampSlide(i, deck.count)) });
    },
    [deck, index, name],
  );

  useEffect(() => {
    if (!active || !deck) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typingTarget(e.target)) return;
      const a = viewerAction(e, isMac);
      if (!a) return;
      if (a.type === 'present') startShow(a.fromCurrent);
      else if (a.type === 'zoomIn') setZoom(stepZoom(scale, 1));
      else if (a.type === 'zoomOut') setZoom(stepZoom(scale, -1));
      else if (a.type === 'zoomReset') setZoom('fit');
      else setIndex((i) => moveSlide(i, deck.count, a.type));
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, deck, scale, startShow]);

  // The thumbnail of the slide on screen stays in view.
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rail.current?.querySelector<HTMLElement>(`[data-slide="${index}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [index, thumbs]);

  const bar = 'flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-40 disabled:hover:bg-transparent';
  const zoomOptions: SlideZoom[] = ['fit', 'width', ...ZOOM_STEPS];

  return (
    <div data-slides-viewer className={cx('flex h-full min-h-0 w-full flex-col', className)}>
      <div className="flex min-h-0 flex-1">
        {deck && thumbs ? (
          <div ref={rail} role="listbox" aria-label="Slides" className="flex w-[176px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface px-3 py-3 scroll-thin">
            {Array.from({ length: deck.count }, (_, i) => (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={i === index}
                data-slide={i}
                onClick={() => go(i)}
                className="group flex items-start gap-2 text-left"
              >
                <span className={cx('w-4 shrink-0 pt-0.5 text-right text-[11px] tabular-nums', i === index ? 'font-bold text-primary' : 'text-ink-3')}>{i + 1}</span>
                <span className={cx('overflow-hidden rounded-[4px] ring-offset-1 ring-offset-surface', i === index ? 'ring-2 ring-primary' : 'ring-1 ring-line group-hover:ring-ink-3')}>
                  <SlideCanvas deck={deck} index={i} width={132} lazy label={`Slide ${i + 1}`} />
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div ref={stage} data-slides-stage className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-info-bg scroll-thin dark:bg-slate-bg">
          {error ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <Icon name="alert" size={30} className="text-ink-3" />
              <b className="text-[15px] text-ink">This presentation couldn’t be shown</b>
              <p className="m-0 max-w-[420px] text-[13px] text-ink-2">{error}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => (setError(null), setAttempt((n) => n + 1))} className="h-9 rounded-[8px] bg-primary px-4 text-[13px] font-bold text-white hover:bg-primary-hover">
                  Retry
                </button>
                {onOpenInOffice ? (
                  <button type="button" onClick={onOpenInOffice} className="h-9 rounded-[8px] border border-line px-4 text-[13px] font-semibold text-ink hover:bg-subtle">
                    Open in WorkSuite Office
                  </button>
                ) : null}
                {onDownload ? (
                  <button type="button" onClick={onDownload} className="h-9 rounded-[8px] border border-line px-4 text-[13px] font-semibold text-ink hover:bg-subtle">
                    Download
                  </button>
                ) : null}
              </div>
            </div>
          ) : !deck ? (
            <Spinner label="Opening the presentation…" className="h-full" />
          ) : count === 0 ? (
            <div className="flex h-full items-center justify-center text-[13px] text-ink-2">This presentation has no slides.</div>
          ) : area.width > 0 ? (
            <div style={{ width: box.contentWidth, height: box.contentHeight }} className="relative">
              <div style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height }} className="shadow-[0_2px_14px_rgba(0,0,0,.22)]">
                <SlideCanvas deck={deck} index={index} width={box.width} label={`${slideLabel(index, count)} — ${name}`} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div role="toolbar" aria-label="Presentation" className="flex h-11 shrink-0 items-center gap-1 border-t border-line bg-surface px-2 text-ink-2">
        <button type="button" aria-label={thumbs ? 'Hide slide thumbnails' : 'Show slide thumbnails'} title={thumbs ? 'Hide thumbnails' : 'Show thumbnails'} aria-pressed={thumbs} disabled={!deck} onClick={() => (setThumbs(!thumbs), saveThumbs(!thumbs))} className={bar}>
          <Icon name={thumbs ? 'panel-close' : 'panel-open'} size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" aria-label="Previous slide" title="Previous slide (←)" disabled={!deck || index <= 0} onClick={() => go(index - 1)} className={bar}>
          <Icon name="chevron-left" size={16} />
        </button>
        <span aria-live="polite" className="min-w-[96px] text-center text-[12.5px] font-semibold text-ink tabular-nums">{deck ? slideLabel(index, count) : '—'}</span>
        <button type="button" aria-label="Next slide" title="Next slide (→)" disabled={!deck || index >= count - 1} onClick={() => go(index + 1)} className={bar}>
          <Icon name="chevron-right" size={16} />
        </button>
        <span className="flex-1" />
        <button type="button" aria-label="Zoom out" title={`Zoom out (${isMac ? '⌘' : 'Ctrl+'}−)`} disabled={!deck} onClick={() => setZoom(stepZoom(scale, -1))} className={cx(bar, 'max-sm:hidden')}>
          <Icon name="zoom-out" size={15} />
        </button>
        <select
          aria-label="Zoom"
          value={zoomValue(zoom)}
          disabled={!deck}
          onChange={(e) => setZoom(parseZoom(e.target.value))}
          className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] font-semibold text-ink disabled:opacity-40"
        >
          {zoomOptions.map((z) => (
            <option key={zoomValue(z)} value={zoomValue(z)}>
              {zoomLabel(z)}
            </option>
          ))}
        </select>
        <button type="button" aria-label="Zoom in" title={`Zoom in (${isMac ? '⌘' : 'Ctrl+'}+)`} disabled={!deck} onClick={() => setZoom(stepZoom(scale, 1))} className={cx(bar, 'max-sm:hidden')}>
          <Icon name="zoom-in" size={15} />
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button
          type="button"
          disabled={!deck || count === 0}
          onClick={() => startShow(false)}
          title={`Present from the start (${isMac ? '⌘⏎' : 'Ctrl+Enter'} or F5) · from this slide: ${isMac ? '⇧⌘⏎' : 'Shift+Ctrl+Enter'}`}
          className="flex h-8 items-center gap-1.5 rounded-[8px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          <Icon name="play" size={14} /> Present
        </button>
        {onDownload ? (
          <button type="button" onClick={onDownload} className={bar} aria-label="Download" title="Download">
            <Icon name="download" size={15} />
            <span className="max-lg:hidden">Download</span>
          </button>
        ) : null}
        {onOpenInOffice ? (
          <button type="button" onClick={onOpenInOffice} className={bar} aria-label="Open in WorkSuite Office" title="Open in WorkSuite Office">
            <Icon name="external" size={15} />
            <span className="max-lg:hidden">Open in WorkSuite Office</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
