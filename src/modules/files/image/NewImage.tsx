import { useState } from 'react';
import { Button, Modal, cx } from '../../../components/ui';

/**
 * New › Create image (NEW-01, NEW-02): a size, a background (a colour or transparent), and a name; the editor opens on
 * a blank canvas and the file is made in the current folder when it is first saved.
 */
export const IMAGE_SIZES: Array<{ id: 'square' | 'portrait' | 'banner' | 'story' | 'a4' | 'custom'; label: string; width: number; height: number }> = [
  { id: 'square', label: 'Image design', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait', width: 1080, height: 1350 },
  { id: 'banner', label: 'Banner', width: 1920, height: 1080 },
  { id: 'story', label: 'Story', width: 1080, height: 1920 },
  // A4 at 150 dpi: 210 × 297 mm.
  { id: 'a4', label: 'A4 (150 dpi)', width: 1240, height: 1754 },
  { id: 'custom', label: 'Custom size…', width: 0, height: 0 },
];

export function CreateImageDialog({ preset, folderName, onClose, onCreate }: { preset: number | null; folderName: string; onClose: () => void; onCreate: (s: { name: string; width: number; height: number; background: string | null }) => void }) {
  const start = IMAGE_SIZES[preset ?? 0] ?? IMAGE_SIZES[0]!;
  const [size, setSize] = useState(start.id);
  const chosen = IMAGE_SIZES.find((x) => x.id === size)!;
  const [w, setW] = useState(String(start.width || 1200));
  const [h, setH] = useState(String(start.height || 800));
  const [bg, setBg] = useState<string | null>('#FFFFFF');
  const [name, setName] = useState(`${start.id === 'custom' ? 'Untitled' : start.label} design.png`);
  const width = size === 'custom' ? Number(w) : chosen.width;
  const height = size === 'custom' ? Number(h) : chosen.height;
  const ok = width >= 16 && height >= 16 && width <= 12000 && height <= 12000 && !!name.trim();
  const field = 'h-8 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary';
  return (
    <Modal title="Create image" width={460} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onCreate({ name: /\.(png|jpe?g|webp)$/i.test(name.trim()) ? name.trim() : `${name.trim()}.png`, width, height, background: bg })}>Open in the editor</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <div role="radiogroup" aria-label="Size" className="grid grid-cols-2 gap-1.5">
          {IMAGE_SIZES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={size === x.id} onClick={() => setSize(x.id)} className={cx('flex items-center justify-between rounded-[9px] border px-3 py-2 text-left', size === x.id ? 'border-primary bg-selection text-primary' : 'border-line hover:bg-subtle')}>
              <span className="font-semibold">{x.label}</span>
              {x.width ? <span className="text-[11.5px] text-ink-3">{`${x.width} × ${x.height}`}</span> : null}
            </button>
          ))}
        </div>
        {size === 'custom' ? (
          <div className="flex items-center gap-2">
            <input type="number" aria-label="Width in pixels" min={16} max={12000} value={w} onChange={(e) => setW(e.target.value)} className={cx(field, 'w-28')} />
            ×
            <input type="number" aria-label="Height in pixels" min={16} max={12000} value={h} onChange={(e) => setH(e.target.value)} className={cx(field, 'w-28')} />
            px
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <span className="text-ink-2">Background</span>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="bg" checked={bg !== null} onChange={() => setBg('#FFFFFF')} className="accent-[var(--color-primary)]" />
            Colour
          </label>
          {bg !== null ? <input type="color" aria-label="Background colour" value={bg} onChange={(e) => setBg(e.target.value.toUpperCase())} /> : null}
          <label className="flex items-center gap-1.5">
            <input type="radio" name="bg" checked={bg === null} onChange={() => setBg(null)} className="accent-[var(--color-primary)]" />
            Transparent
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-ink-2">Name</span>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value.replace(/[/\\]/g, ''))} aria-label="Name" className={field} />
        </label>
        <span className="text-[12px] text-ink-3">{`It is made in ${folderName} when you first save it.`}</span>
      </div>
    </Modal>
  );
}
