import { useState } from 'react';
import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { Button, Modal, TextField, cx } from '../../../components/ui';
import { frequentEmoji, noteEmojiUsed, searchEmoji } from '../../chat/emoji';
import type { TableStyle } from './emailHtml';
import { cropRect, type CropBox } from './images';
import { SPECIAL_CHARACTERS } from './insert';

/**
 * The composer's small panels and dialogs (worksuite-desktop#188): the
 * table grid, Insert table…, emoji, special characters, a button, a picture
 * from an address, and cropping a picture.
 */

/** A strip under the toolbar; Escape closes it. */
export function Strip({ label, children, onClose, className }: { label: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-subtle/60 px-3 py-1.5 text-[12.5px]', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

/** Choose rows × columns by pointing (up to 10 × 10), or open the full dialog. */
export function TableGrid({ onPick, onMore, onClose }: { onPick: (rows: number, cols: number) => void; onMore: () => void; onClose: () => void }) {
  const [at, setAt] = useState<[number, number]>([0, 0]);
  return (
    <Strip label={text('Insert a table')} onClose={onClose} className="items-start">
      <div className="flex flex-col gap-1.5">
        <div role="grid" aria-label={text('Table size')} className="grid grid-cols-10 gap-[3px]" onMouseLeave={() => setAt([0, 0])}>
          {Array.from({ length: 10 }, (_, r) =>
            Array.from({ length: 10 }, (_, c) => (
              <button
                key={`${r}-${c}`}
                type="button"
                role="gridcell"
                aria-label={text('{rows} by {cols} table', { rows: r + 1, cols: c + 1 })}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setAt([r + 1, c + 1])}
                onFocus={() => setAt([r + 1, c + 1])}
                onClick={() => onPick(r + 1, c + 1)}
                className={cx('h-[15px] w-[15px] rounded-[2px] border', r < at[0] && c < at[1] ? 'border-primary bg-selection' : 'border-line bg-surface')}
              />
            )),
          )}
        </div>
        <span className="text-[12px] text-ink-3">{at[0] ? text('{rows} × {cols}', { rows: at[0], cols: at[1] }) : text('Point to choose a size')}</span>
      </div>
      <button type="button" onClick={onMore} className="ml-2 inline-flex h-7 items-center gap-1 rounded-[6px] px-2 font-semibold text-primary hover:bg-surface">
        <Icon name="table" size={14} /> {text('Insert table…')}
      </button>
    </Strip>
  );
}

export function InsertTableDialog({ onInsert, onClose }: { onInsert: (o: { rows: number; cols: number; header: boolean; style: TableStyle }) => void; onClose: () => void }) {
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');
  const [header, setHeader] = useState(true);
  const [style, setStyle] = useState<TableStyle>('bordered');
  const r = Math.min(50, Math.max(1, Number(rows) || 0));
  const c = Math.min(20, Math.max(1, Number(cols) || 0));
  const ok = Number(rows) >= 1 && Number(cols) >= 1;
  return (
    <Modal
      title={text('Insert table')}
      labelledBy="mail-insert-table"
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" disabled={!ok} onClick={() => onInsert({ rows: r, cols: c, header, style })}>
            {text('Insert')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 p-4 text-[13px]">
        <TextField label={text('Rows')} type="number" min={1} max={50} value={rows} onChange={(e) => setRows(e.target.value)} autoFocus />
        <TextField label={text('Columns')} type="number" min={1} max={20} value={cols} onChange={(e) => setCols(e.target.value)} />
        <label className="col-span-2 flex items-center gap-2 text-ink">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
          {text('Header row')}
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">{text('Style')}</span>
          <select aria-label={text('Table style')} value={style} onChange={(e) => setStyle(e.target.value as TableStyle)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-ink">
            <option value="bordered">{text('Bordered')}</option>
            <option value="plain">{text('Plain')}</option>
            <option value="striped">{text('Striped rows')}</option>
            <option value="header">{text('Coloured header')}</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}

/** Emoji with search and the ones used most (Chat's list, remembered on this computer). */
export function EmojiPanel({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = q.trim() ? searchEmoji(q) : frequentEmoji();
  const all = q.trim() ? [] : searchEmoji('');
  const pick = (e: string) => {
    noteEmojiUsed(e);
    onPick(e);
  };
  const cell = (e: string, i: number) => (
    <button key={`${e}-${i}`} type="button" aria-label={e} onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick(e)} className="h-8 w-8 rounded-[6px] text-[18px] hover:bg-surface">
      {e}
    </button>
  );
  return (
    <Strip label={text('Emoji')} onClose={onClose} className="flex-col items-stretch">
      <input
        autoFocus
        aria-label={text('Search emoji')}
        placeholder={text('Search emoji')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault();
            pick(list[0]);
          }
        }}
        className="h-8 rounded-[6px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary"
      />
      <span className="text-[11.5px] font-semibold text-ink-3">{q.trim() ? text('Results') : text('Recently used')}</span>
      <div className="flex flex-wrap gap-0.5">{list.length ? list.slice(0, 64).map(cell) : <span className="text-ink-3">{text('No emoji match.')}</span>}</div>
      {all.length ? (
        <>
          <span className="text-[11.5px] font-semibold text-ink-3">{text('All')}</span>
          <div className="flex max-h-[132px] flex-wrap gap-0.5 overflow-y-auto scroll-thin">{all.map(cell)}</div>
        </>
      ) : null}
    </Strip>
  );
}

export function SpecialCharsPanel({ onPick, onClose }: { onPick: (c: string) => void; onClose: () => void }) {
  return (
    <Strip label={text('Special characters')} onClose={onClose}>
      {SPECIAL_CHARACTERS.map(([c, name]) => (
        <button key={c} type="button" aria-label={text(name)} title={text(name)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} className="h-8 min-w-8 rounded-[6px] border border-line bg-surface px-1 text-[15px] text-ink hover:border-primary">
          {c}
        </button>
      ))}
      <button type="button" onClick={onClose} className="ml-auto h-7 rounded-[6px] px-2 text-ink-2 hover:bg-surface">
        {text('Close')}
      </button>
    </Strip>
  );
}

/** One line to fill in and a button: a link's address, a picture's address, alt text. */
export function FieldStrip({ label, icon, placeholder, initial = '', action, error, onSubmit, onClose, extra }: { label: string; icon: string; placeholder?: string; initial?: string; action: string; error?: string; onSubmit: (value: string) => void; onClose: () => void; extra?: React.ReactNode }) {
  const [value, setValue] = useState(initial);
  return (
    <Strip label={label} onClose={onClose}>
      <Icon name={icon} size={14} className="text-ink-3" />
      <input
        autoFocus
        aria-label={label}
        aria-invalid={!!error || undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onSubmit(value);
          }
        }}
        className="h-7 min-w-[180px] flex-1 rounded-[6px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary"
      />
      <button type="button" onClick={() => onSubmit(value)} className="h-7 rounded-[6px] bg-primary px-2.5 font-semibold text-[var(--ws-on-primary)] hover:bg-primary-hover">
        {action}
      </button>
      {extra}
      <button type="button" onClick={onClose} className="h-7 rounded-[6px] px-2 text-ink-2 hover:bg-surface">
        {text('Cancel')}
      </button>
      {error ? (
        <span role="alert" className="basis-full text-danger">
          {error}
        </span>
      ) : null}
    </Strip>
  );
}

export function ButtonDialog({ onInsert, onClose, check }: { onInsert: (label: string, href: string) => void; onClose: () => void; check: (href: string) => string | null }) {
  const [label, setLabel] = useState('');
  const [href, setHref] = useState('');
  const [error, setError] = useState('');
  const go = () => {
    const url = check(href);
    if (!url) return setError(text('Use an https, http or mailto address (for example https://example.com).'));
    onInsert(label.trim() || text('Open'), url);
  };
  return (
    <Modal
      title={text('Insert a button')}
      labelledBy="mail-insert-button"
      width={420}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" onClick={go}>
            {text('Insert')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <TextField label={text('Button text')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={text('Book a call')} autoFocus />
        <TextField label={text('Link')} value={href} onChange={(e) => (setHref(e.target.value), setError(''))} placeholder="https://" error={error || null} />
        <p className="text-[12px] text-ink-3">{text('A styled link that looks like a button in every mail app, Outlook included.')}</p>
      </div>
    </Modal>
  );
}

/** Taking a little off each side of a picture; the preview is the picture clipped, the result a new picture. */
export function CropDialog({ src, onCrop, onClose }: { src: string; onCrop: (box: CropBox) => void; onClose: () => void }) {
  const [box, setBox] = useState<CropBox>({ top: 0, right: 0, bottom: 0, left: 0 });
  const side = (k: keyof CropBox, label: string) => (
    <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
      <span className="w-14">{label}</span>
      <input type="range" min={0} max={45} value={box[k]} aria-label={label} onChange={(e) => setBox({ ...box, [k]: Number(e.target.value) })} className="flex-1" />
      <span className="w-9 text-right tabular-nums">{box[k]}%</span>
    </label>
  );
  const r = cropRect(100, 100, box);
  return (
    <Modal
      title={text('Crop picture')}
      labelledBy="mail-crop"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" onClick={() => onCrop(box)} disabled={!box.top && !box.right && !box.bottom && !box.left}>
            {text('Crop')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex justify-center rounded-[8px] bg-subtle p-2">
          <img src={src} alt="" className="max-h-[220px] max-w-full" style={{ clipPath: `inset(${box.top}% ${box.right}% ${box.bottom}% ${box.left}%)` }} />
        </div>
        {side('top', text('Top'))}
        {side('bottom', text('Bottom'))}
        {side('left', text('Left'))}
        {side('right', text('Right'))}
        <p className="text-[12px] text-ink-3">{text('Keeps {w}% × {h}% of the picture.', { w: r.w, h: r.h })}</p>
      </div>
    </Modal>
  );
}
