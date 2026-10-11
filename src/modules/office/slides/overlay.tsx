import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Icon } from '../../../components/Icon';
import { fetchBytes } from './render';
import { SlidesViewer } from './SlidesViewer';

/**
 * The presentation viewer over the page (worksuite-desktop#321), for a .pptx that is not a Drive file in Files: a
 * Mail attachment, a chat file, a tender document. The page underneath stays where it was; Esc or ‹ comes back.
 */
export interface SlidesSource {
  name: string;
  /** Where the app reads the file (its own origin: `apiUrl(…)`). */
  url: string;
  onDownload?: () => void;
  onOpenInOffice?: () => void;
}

/** The presentations the viewer draws: .pptx (the Slides engine's format). Older .ppt and .odp open as before. */
export const isSlidesFile = (name: string): boolean => /\.pptx$/i.test(name);

let mounted: { root: Root; host: HTMLElement } | null = null;

export function closeSlidesViewer(): void {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  root.unmount();
  host.remove();
}

export function openSlidesViewer(src: SlidesSource): void {
  closeSlidesViewer();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  const opener = document.activeElement as HTMLElement | null;
  const close = () => {
    closeSlidesViewer();
    if (opener?.isConnected) opener.focus();
  };
  root.render(<SlidesOverlay src={src} onClose={close} />);
}

export function SlidesOverlay({ src, onClose }: { src: SlidesSource; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const leave = (run?: () => void) => (run ? () => (onClose(), run()) : undefined);
  return (
    <div role="dialog" aria-modal="true" aria-label={`Presentation ${src.name}`} className="no-drag fixed inset-0 z-[60] flex flex-col bg-ground text-ink">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3">
        <button type="button" aria-label="Back" title="Back (Esc)" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="rounded-[6px] bg-selection px-2 py-0.5 text-[10.5px] font-bold text-primary">PPTX</span>
        <b className="min-w-0 flex-1 truncate text-[14px]" title={src.name}>
          {src.name}
        </b>
        <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <SlidesViewer name={src.name} load={(signal) => fetchBytes(src.url, signal)} onDownload={src.onDownload} onOpenInOffice={leave(src.onOpenInOffice)} />
      </div>
    </div>
  );
}
