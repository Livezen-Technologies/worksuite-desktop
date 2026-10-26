import { useEffect, useMemo, useRef, useState } from 'react';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import type { MailPrefs } from './types';
import { topBarPaddingRight } from '../../core/window-chrome';

/**
 * Immersive reader (ENH-MAIL-03 DMO-RD-04): the message's words alone, full
 * window — bigger text, wider spacing, a narrower column, line focus that
 * dims all but the paragraph being read, and Read aloud with the computer's
 * own voices (nothing leaves the computer). Translate stays where it is, in
 * the message's More menu, because it goes through WorkSuite's AI.
 *
 * Only text is shown — React-escaped paragraphs from the sanitised body —
 * so the email's own styles and pictures never reach the app's page.
 */

export type ImmersivePrefs = NonNullable<MailPrefs['immersive']>;

/** The body as paragraphs: blank lines split them; a paragraph keeps its own line breaks. */
export function paragraphsOf(plain: string): string[] {
  return plain
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean)
    .slice(0, 2000);
}

const SIZES = [16, 18, 20, 24, 28];

export function ImmersiveReader({ subject, from, plain, prefs, onPrefs, onClose }: { subject: string; from: string; plain: string; prefs: ImmersivePrefs; onPrefs: (p: ImmersivePrefs) => void; onClose: () => void }) {
  const paras = useMemo(() => paragraphsOf(plain), [plain]);
  const [at, setAt] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const size = SIZES.includes(prefs.size ?? 0) ? prefs.size! : 20;
  const wide = prefs.spacing === 'wide';
  const focusLine = !!prefs.focusLine;
  const box = useRef<HTMLDivElement>(null);
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  useEffect(() => {
    box.current?.focus();
    return () => synth?.cancel();
  }, [synth]);
  useEffect(() => {
    if (!focusLine) return;
    box.current?.querySelector(`[data-para="${at}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [at, focusLine]);

  const speak = (from: number) => {
    if (!synth) return;
    synth.cancel();
    const go = (i: number) => {
      if (i >= paras.length) return setSpeaking(false);
      setAt(i);
      const u = new SpeechSynthesisUtterance(paras[i]!);
      u.onend = () => go(i + 1);
      u.onerror = () => setSpeaking(false);
      synth.speak(u);
    };
    setSpeaking(true);
    go(from);
  };
  const stop = () => {
    synth?.cancel();
    setSpeaking(false);
  };
  const set = (patch: Partial<ImmersivePrefs>) => onPrefs({ ...prefs, ...patch });

  return (
    <div role="dialog" aria-modal="true" aria-label={text('Immersive reader')} className="fixed inset-0 z-50 flex flex-col bg-ground">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface py-2 pl-4" style={{ paddingRight: topBarPaddingRight(16) }} role="toolbar" aria-label={text('Reader options')}>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-2">{text('Immersive reader')}</span>
        <Button size="sm" icon="zoom-out" disabled={size === SIZES[0]} onClick={() => set({ size: SIZES[Math.max(0, SIZES.indexOf(size) - 1)] })}>
          {text('Smaller')}
        </Button>
        <Button size="sm" icon="zoom-in" disabled={size === SIZES[SIZES.length - 1]} onClick={() => set({ size: SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(size) + 1)] })}>
          {text('Larger')}
        </Button>
        <Button size="sm" aria-pressed={wide} onClick={() => set({ spacing: wide ? 'normal' : 'wide' })}>
          {text('Wide spacing')}
        </Button>
        <Button size="sm" aria-pressed={prefs.width === 'wide'} onClick={() => set({ width: prefs.width === 'wide' ? 'narrow' : 'wide' })}>
          {text('Wide column')}
        </Button>
        <Button size="sm" aria-pressed={focusLine} onClick={() => set({ focusLine: !focusLine })}>
          {text('Line focus')}
        </Button>
        {synth ? (
          speaking ? (
            <Button size="sm" icon="pause" onClick={stop}>
              {text('Stop reading')}
            </Button>
          ) : (
            <Button size="sm" icon="play" onClick={() => speak(focusLine ? at : 0)} disabled={!paras.length}>
              {text('Read aloud')}
            </Button>
          )
        ) : null}
        <button type="button" aria-label={text('Close the reader')} title={text('Close (Esc)')} onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            stop();
            onClose();
          } else if (focusLine && (e.key === 'ArrowDown' || e.key === 'j')) {
            e.preventDefault();
            setAt((i) => Math.min(paras.length - 1, i + 1));
          } else if (focusLine && (e.key === 'ArrowUp' || e.key === 'k')) {
            e.preventDefault();
            setAt((i) => Math.max(0, i - 1));
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto outline-none"
      >
        <article className={cx('mx-auto px-6 py-10 text-ink', prefs.width === 'wide' ? 'max-w-[960px]' : 'max-w-[680px]')} style={{ fontSize: size, lineHeight: wide ? 2 : 1.6, letterSpacing: wide ? '0.04em' : undefined, wordSpacing: wide ? '0.12em' : undefined }}>
          <h1 className="mb-1 text-[1.4em] font-bold leading-tight">{subject || text('(no subject)')}</h1>
          <p className="mb-8 text-[0.75em] text-ink-3">{from}</p>
          {paras.map((t, i) => (
            <p key={i} data-para={i} role="presentation" onClick={() => setAt(i)} className={cx('mb-[1em] whitespace-pre-wrap motion-safe:transition-opacity', focusLine && i !== at && 'opacity-30', focusLine && i === at && 'rounded-[6px] bg-selection')}>
              {t}
            </p>
          ))}
          {paras.length === 0 ? <p className="text-ink-3">{text('This message has no text to read.')}</p> : null}
        </article>
      </div>
    </div>
  );
}
