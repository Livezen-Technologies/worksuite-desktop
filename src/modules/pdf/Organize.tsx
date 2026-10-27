import { useState } from 'react';
import type { PdfSessionView } from '@shared/pdf';
import { cx } from '../../components/ui';
import { Thumb } from './Panels';
import { clickOnKey } from '../../components/press';

/**
 * Organize (PDF Studio, stage D2): every page as a thumbnail, to select —
 * click, Shift for a range, Ctrl/⌘ for more — and drag into a new order.
 * The ribbon's page tools act on the selection.
 */
export function Organize({ view, selected, onSelect, onMove, onOpen, disabled }: {
  view: PdfSessionView;
  selected: number[];
  onSelect: (pages: number[]) => void;
  /** Drop the selected pages before this page (the page count to put them at the end). */
  onMove: (before: number) => void;
  onOpen: (page: number) => void;
  disabled: boolean;
}) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const pick = (p: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < p ? [anchor, p] : [p, anchor];
      onSelect(Array.from({ length: b - a + 1 }, (_, i) => a + i));
    } else if (e.metaKey || e.ctrlKey) {
      onSelect(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p].sort((a, b) => a - b));
      setAnchor(p);
    } else {
      onSelect([p]);
      setAnchor(p);
    }
  };
  return (
    <div role="listbox" aria-label="Pages" aria-multiselectable="true" className="min-h-0 flex-1 overflow-auto bg-info-bg p-5 scroll-thin dark:bg-slate-bg">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {view.pages.map((size, p) => (
          <div
            key={p}
            role="option"
            tabIndex={0}
            onKeyDown={clickOnKey}
            aria-selected={selected.includes(p)}
            draggable={!disabled}
            onDragStart={(e) => {
              if (!selected.includes(p)) onSelect([p]);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('application/x-ws-pdf-pages', 'move');
            }}
            onDragOver={(e) => {
              if (disabled || !e.dataTransfer.types.includes('application/x-ws-pdf-pages')) return;
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setOver(e.clientX < r.left + r.width / 2 ? p : p + 1);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (over !== null) onMove(over);
              setOver(null);
            }}
            onDoubleClick={() => onOpen(p)}
            onClick={(e) => pick(p, e)}
            className={cx('relative flex flex-col items-center rounded-[10px] p-2', selected.includes(p) ? 'bg-selection' : 'hover:bg-white/40 dark:hover:bg-white/5')}
          >
            {over === p ? <span aria-hidden="true" className="absolute -left-2 top-2 bottom-2 w-1 rounded-full bg-primary" /> : null}
            {over === p + 1 && p === view.pageCount - 1 ? <span aria-hidden="true" className="absolute -right-2 top-2 bottom-2 w-1 rounded-full bg-primary" /> : null}
            <Thumb session={view.id} page={p} width={size[0]} height={size[1]} current={false} selected={selected.includes(p)} onOpen={() => undefined} revision={view.edit.revision} size={130} />
          </div>
        ))}
      </div>
    </div>
  );
}
