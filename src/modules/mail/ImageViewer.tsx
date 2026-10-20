import { useEffect, useRef, useState } from 'react';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import type { FramedPicture } from './readable';
import { topBarPaddingRight } from '../../core/window-chrome';

/**
 * A picture from an email's body, over the page (worksuite-desktop#287). The frame cannot run anything, so a click on
 * a picture there is a picture link (readable.linkPictures) that the window hands back to this reader by number —
 * never by an address the email chose — and only pictures already shown in the body (kept in the message or the local
 * store, or through WorkSuite's proxy) come here. Fitted or at its own size, ‹ › through the message's pictures,
 * Escape closes, and the focus goes back where it was.
 */
export function MailImageViewer({ pictures, start, onClose }: { pictures: FramedPicture[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(() => Math.min(Math.max(0, start), Math.max(0, pictures.length - 1)));
  const [actual, setActual] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    box.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus?.();
    };
  }, [opener]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(pictures.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
      else if (e.key === '0') setActual((a) => !a);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pictures.length]);
  const pic = pictures[i];
  if (!pic) return null;
  const tool = 'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[13px] font-semibold text-white/90 hover:bg-white/10 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-white/80';
  const name = pic.alt || text('Picture {n} of {m}', { n: i + 1, m: pictures.length });
  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={name} data-mail-image-viewer className="no-drag fixed inset-0 z-[60] flex flex-col bg-[#080c18]/95 outline-none">
      <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-white/10 pl-3" style={{ paddingRight: topBarPaddingRight(12) }}>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white" title={name}>
          {name}
        </span>
        {pictures.length > 1 ? (
          <>
            <span className="px-1 text-[12.5px] text-white/60">{text('{n} of {m}', { n: i + 1, m: pictures.length })}</span>
            <button type="button" className={tool} aria-label={text('Previous picture')} title={text('Previous (←)')} disabled={i === 0} onClick={() => setI(i - 1)}>
              <Icon name="chevron-left" size={17} />
            </button>
            <button type="button" className={tool} aria-label={text('Next picture')} title={text('Next (→)')} disabled={i >= pictures.length - 1} onClick={() => setI(i + 1)}>
              <Icon name="chevron-right" size={17} />
            </button>
          </>
        ) : null}
        <button type="button" className={tool} aria-pressed={actual} title={text('Fit or actual size (0)')} onClick={() => setActual(!actual)}>
          <Icon name={actual ? 'minimize' : 'maximize'} size={15} />
          {actual ? text('Fit') : text('Actual size')}
        </button>
        <button type="button" className={tool} aria-label={text('Close')} title={text('Close (Esc)')} onClick={onClose}>
          <Icon name="x" size={17} />
        </button>
      </div>
      <div className={cx('flex min-h-0 flex-1 overflow-auto p-6', actual ? 'items-start justify-start' : 'items-center justify-center')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <img key={i} src={pic.src} alt={pic.alt} draggable={false} className={cx('select-none', actual ? 'max-w-none' : 'max-h-full max-w-full object-contain')} />
      </div>
    </div>
  );
}
