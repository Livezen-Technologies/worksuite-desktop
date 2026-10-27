import { useEffect, useMemo, useRef, useState } from 'react';
import { DriveFilePicker } from '../../../components/DriveFilePicker';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { cx } from '../../../components/ui';
import type { Libraries, LibraryItem, Preset } from './api';
import { Chip, DarkButton, FIELD, Head, Label, Note, Seg, Slider, SwitchRow, Swatches, TILE, TILE_ON } from './controls';
import {
  ADJUSTMENTS,
  CROP_RATIOS,
  FILTERS,
  NO_SHADOW,
  blankRecipe,
  contentSize,
  cropForRatio,
  filterLabel,
  newId,
  outputSize,
  ratioFromText,
  turned,
  type Adjustment,
  type FilterName,
  type Frame,
  type FramePreset,
  type OverlayObject,
  type Recipe,
  type Rect,
  type ShapeKind,
  type ShapeObject,
  type StickerObject,
  type TextObject,
  type Watermark,
} from './recipe';
import { renderRecipe, type Drawable } from './render';
import { STICKER_CATEGORIES, searchStickers, stickerSvg, type StickerCategory } from './stickers';
import { BUNDLED_FONTS, SYSTEM_FONTS, TEXT_PRESETS, applyPreset, newText, type TextPreset } from './text';
import { labelOf } from './Stage';
import { itemPicture, type LibraryFolders } from './assets';

/**
 * The 320 px panel's tools (EDT-E-04; P02–P05): each one's options, changing the recipe through `commit` (one undo
 * step) or `live` (a slider or a word in progress, one step when it settles).
 */
export interface PanelProps {
  recipe: Recipe;
  commit: (r: Recipe) => void;
  live: (r: Recipe) => void;
  settle: () => void;
  W: number;
  H: number;
  src: Drawable | null;
  ext: string;
  selected: string[];
  onSelect: (ids: string[]) => void;
}

const LABEL: Record<Adjustment, string> = { exposure: 'Exposure', brightness: 'Brightness', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', saturation: 'Saturation', vibrance: 'Vibrance', temperature: 'Warmth', tint: 'Tint', hue: 'Hue', gamma: 'Gamma', sharpness: 'Sharpness' };

const withObject = (r: Recipe, id: string, fn: (o: OverlayObject) => OverlayObject): Recipe => ({ ...r, objects: r.objects.map((o) => (o.id === id ? fn(o) : o)) });

/* ==================================================================== *
 * Crop, straighten, turn, corners (CRT-01…04)
 * ==================================================================== */

export function CropPanel(p: PanelProps & { draft: Rect | null; setDraft: (r: Rect | null) => void; ratio: string; setRatio: (id: string, value: number | null) => void; onApply: () => void; onGrid: (on: boolean) => void }) {
  const r = p.recipe;
  const t = turned(p.W, p.H, r.rotate);
  const [custom, setCustom] = useState('');
  const d = p.draft ?? { x: 0, y: 0, w: 1, h: 1 };
  const chooseRatio = (id: string, value: number | null) => {
    p.setRatio(id, value);
    if (value) p.setDraft(cropForRatio(t.w, t.h, value));
  };
  const turn = (by: 90 | 270) => {
    p.setDraft(null);
    p.commit({ ...r, rotate: (((r.rotate + by) % 360) as Recipe['rotate']), crop: null, crop_ratio: null, resize: null });
  };
  return (
    <div className="flex flex-col gap-3">
      <Head title="Crop and straighten" onReset={r.crop || r.straighten || r.rotate || r.flipH || r.flipV || r.corners ? () => (p.setDraft(null), p.commit({ ...r, crop: null, crop_ratio: null, straighten: 0, straighten_fill: null, rotate: 0, flipH: false, flipV: false, corners: 0, corners_fill: null })) : null} />
      <Slider
        label="Straighten"
        value={r.straighten}
        min={-45}
        max={45}
        step={0.1}
        unit="°"
        signed
        onChange={(v) => (p.onGrid(true), p.live({ ...r, straighten: Math.round(v * 10) / 10 }))}
        onDone={() => (p.onGrid(false), p.settle())}
      />
      <SwitchRow label="Fill the corners with a colour" sub={r.straighten_fill ? 'The picture keeps its size; the corners are filled.' : 'Off: the picture is enlarged so no empty corners show.'} checked={!!r.straighten_fill} onChange={(on) => p.commit({ ...r, straighten_fill: on ? '#FFFFFF' : null })} />
      {r.straighten_fill ? <Swatches label="Corner colour" value={r.straighten_fill} onChange={(c) => p.commit({ ...r, straighten_fill: c })} /> : null}
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5">
        <DarkButton onClick={() => turn(270)} icon={<Icon name="undo" size={14} />}>
          90° left
        </DarkButton>
        <DarkButton onClick={() => turn(90)} icon={<Icon name="rotate-cw" size={14} />}>
          90° right
        </DarkButton>
        <DarkButton aria-label="Flip across" aria-pressed={r.flipH} title="Flip across" onClick={() => p.commit({ ...r, flipH: !r.flipH })} icon={<Icon name="flip" size={15} />}>
          {''}
        </DarkButton>
        <DarkButton aria-label="Flip down" aria-pressed={r.flipV} title="Flip down" onClick={() => p.commit({ ...r, flipV: !r.flipV })} icon={<Icon name="flip-v" size={15} />}>
          {''}
        </DarkButton>
      </div>
      <Label>Ratio</Label>
      <div className="flex flex-wrap gap-1.5">
        {CROP_RATIOS.map((c) => (
          <Chip key={c.id} on={p.ratio === c.id} title={c.hint} onClick={() => chooseRatio(c.id, c.ratio)}>
            {c.label}
          </Chip>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom ratio, for example 5:4" placeholder="Custom, e.g. 5:4" className={FIELD} />
        <DarkButton disabled={!ratioFromText(custom)} onClick={() => chooseRatio(custom.trim(), ratioFromText(custom))}>
          Use
        </DarkButton>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12px] text-stage-accent">
        <span className="rounded-[8px] border border-stage-line-soft px-2.5 py-1.5">W {Math.round(t.w * d.w)}</span>
        <span className="rounded-[8px] border border-stage-line-soft px-2.5 py-1.5">H {Math.round(t.h * d.h)}</span>
      </div>
      <div className="flex gap-2">
        <DarkButton primary onClick={p.onApply} disabled={d.w < 0.02 || d.h < 0.02}>
          Apply crop
        </DarkButton>
        {r.crop ? <DarkButton onClick={() => (p.setDraft(null), p.commit({ ...r, crop: null, crop_ratio: null }))}>Remove crop</DarkButton> : null}
      </div>
      <span className="text-[12px] text-stage-ink-3">Drag on the picture to choose what to keep. Layers stay where they are on the picture.</span>
      <Label>Rounded corners</Label>
      <Slider label="Corner radius" value={r.corners} min={0} max={200} unit=" px" onChange={(v) => p.live({ ...r, corners: v })} onDone={p.settle} />
      {r.corners > 0 && ['jpg', 'jpeg'].includes(p.ext) ? (
        <>
          <Note tone="warning">A JPEG cannot be transparent: the corners are filled with this colour, or saved transparent as PNG or WebP.</Note>
          <Swatches label="Corner fill" value={r.corners_fill ?? '#FFFFFF'} onChange={(c) => p.commit({ ...r, corners_fill: c })} />
        </>
      ) : null}
    </div>
  );
}

/* ==================================================================== *
 * Adjust
 * ==================================================================== */

export function AdjustPanel(p: PanelProps) {
  const r = p.recipe;
  return (
    <div className="flex flex-col gap-3">
      <Head title="Adjust" onReset={ADJUSTMENTS.some((a) => r.adjust[a]) ? () => p.commit({ ...r, adjust: { ...blankRecipe().adjust } }) : null} />
      {ADJUSTMENTS.map((a) => (
        <Slider key={a} label={LABEL[a]} value={r.adjust[a]} min={-100} max={100} signed onChange={(v) => p.live({ ...r, adjust: { ...r.adjust, [a]: v } })} onDone={p.settle} />
      ))}
    </div>
  );
}

/* ==================================================================== *
 * Filters (EDT-E-06…08)
 * ==================================================================== */

function useThumbs(src: Drawable | null, W: number, H: number, recipe: Recipe, names: readonly FilterName[]): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const base = useMemo(() => ({ ...recipe, objects: [], watermark: null, frame: null, redactions: [], corners: 0, filter: { ...recipe.filter, strength: 100, scope: 'image' as const, preset: null } }), [recipe]);
  const key = JSON.stringify([base.rotate, base.flipH, base.flipV, base.straighten, base.crop, base.adjust]);
  useEffect(() => {
    if (!src) return;
    let gone = false;
    const id = setTimeout(() => {
      const out: Record<string, string> = {};
      try {
        for (const n of names) {
          const r = { ...base, filter: { ...base.filter, name: n } };
          const s = Math.min(1, 96 / Math.max(contentSize(W, H, r).w, contentSize(W, H, r).h));
          out[n] = renderRecipe(src, W, H, r, { scale: s, noObjects: true }).toDataURL('image/jpeg', 0.7);
        }
      } catch {
        return;
      }
      if (!gone) setThumbs(out);
    }, 120);
    return () => {
      gone = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, W, H, key]);
  return thumbs;
}

export function FiltersPanel(p: PanelProps & { presets: Preset[]; onSavePreset: (name: string) => void; hasArea: boolean }) {
  const r = p.recipe;
  const names = FILTERS.filter((f) => f !== 'sepia' || r.filter.name === 'sepia');
  const thumbs = useThumbs(p.src, p.W, p.H, r, names);
  const [naming, setNaming] = useState<string | null>(null);
  const current = r.filter.preset ? r.filter.preset.name : filterLabel(r.filter.name);
  return (
    <div className="flex flex-col gap-3">
      <Head title="Filters" onReset={r.filter.name !== 'none' || r.filter.preset ? () => p.commit({ ...r, filter: { name: 'none', strength: 100, scope: r.filter.scope, preset: null } }) : null} />
      <Seg
        label="Apply to"
        value={r.filter.scope}
        onChange={(scope) => p.commit({ ...r, filter: { ...r.filter, scope } })}
        options={[
          { value: 'image', label: 'Whole image' },
          { value: 'area', label: 'Selection', disabled: !p.hasArea, title: p.hasArea ? undefined : 'Pick an area with the Area tool first' },
        ]}
      />
      <Label>Presets</Label>
      <div className="grid grid-cols-3 gap-2">
        {names.map((n) => {
          const on = !r.filter.preset && r.filter.name === n;
          return (
            <button key={n} type="button" aria-pressed={on} onClick={() => p.commit({ ...r, filter: { ...r.filter, name: n, preset: null, strength: n === r.filter.name ? r.filter.strength : 100 } })} className="flex flex-col items-center gap-1 text-[12px] font-semibold text-stage-ink">
              <span className={cx('flex h-[58px] w-full items-center justify-center overflow-hidden', on ? TILE_ON : TILE)}>{thumbs[n] ? <img src={thumbs[n]} alt="" className="h-full w-full object-cover" /> : <Icon name="blend" size={18} className="text-stage-ink-4" />}</span>
              {filterLabel(n)}
            </button>
          );
        })}
      </div>
      <Slider label={`Strength · ${current}`} value={r.filter.strength} min={0} max={100} unit="%" disabled={r.filter.name === 'none' && !r.filter.preset} onChange={(v) => p.live({ ...r, filter: { ...r.filter, strength: v } })} onDone={p.settle} />
      {p.presets.length ? (
        <>
          <Label>Organization and my presets</Label>
          <div className="flex flex-wrap gap-1.5">
            {p.presets.map((x) => (
              <Chip key={x.id} on={r.filter.preset?.id === x.id} title={x.user_id ? 'Your preset' : 'Set by your admin in Drive settings › Photo editor'} onClick={() => p.commit({ ...r, filter: { ...r.filter, name: (typeof x.payload.base === 'string' && (FILTERS as readonly string[]).includes(x.payload.base) ? x.payload.base : 'none') as FilterName, strength: typeof x.payload.strength === 'number' ? x.payload.strength : 100, preset: { id: x.id, name: x.name, adjust: (x.payload.adjust ?? {}) as Partial<Record<Adjustment, number>> } } })}>
                {x.name}
              </Chip>
            ))}
          </div>
        </>
      ) : null}
      {naming === null ? (
        <DarkButton onClick={() => setNaming('')} icon={<Icon name="plus" size={14} />}>
          Save current look as my preset
        </DarkButton>
      ) : (
        <div className="flex gap-1.5">
          <input autoFocus value={naming} maxLength={60} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && naming.trim() && (p.onSavePreset(naming.trim()), setNaming(null))} aria-label="Name of the preset" placeholder="Name" className={FIELD} />
          <DarkButton primary disabled={!naming.trim()} onClick={() => (p.onSavePreset(naming.trim()), setNaming(null))}>
            Save
          </DarkButton>
        </div>
      )}
      <Note>Filters stay editable: the strength and preset are saved with the version, so reopening it puts this slider back where it is.</Note>
    </div>
  );
}

/* ==================================================================== *
 * Area (magic wand)
 * ==================================================================== */

export function AreaPanel(p: PanelProps) {
  const r = p.recipe;
  const area = r.area;
  return (
    <div className="flex flex-col gap-3">
      <Head title="Area" onReset={area ? () => p.commit({ ...r, area: null, filter: { ...r.filter, scope: 'image' } }) : null} />
      <span className="text-[12.5px] text-stage-accent">Click the picture to pick a colour area — a sky, a wall. Shift-click adds to it. Filters can then apply to the area alone.</span>
      <Slider label="How near a colour counts" value={area?.tolerance ?? 32} min={4} max={120} onChange={(v) => p.live({ ...r, area: { seeds: area?.seeds ?? [], tolerance: v } })} onDone={p.settle} />
      <span className="text-[12px] text-stage-ink-3">{area?.seeds.length ? `${area.seeds.length} ${area.seeds.length === 1 ? 'pick' : 'picks'}` : 'Nothing picked yet.'}</span>
      {area?.seeds.length ? (
        <DarkButton onClick={() => p.commit({ ...r, filter: { ...r.filter, scope: 'area' } })} disabled={r.filter.scope === 'area'}>
          Use for filters
        </DarkButton>
      ) : null}
    </div>
  );
}

/* ==================================================================== *
 * Text (CRT-10…14)
 * ==================================================================== */

export function TextPanel(p: PanelProps & { brandFonts: string[]; orgPresets: Preset[]; missing: string[] }) {
  const r = p.recipe;
  const sel = r.objects.find((o): o is TextObject => o.kind === 'text' && p.selected.includes(o.id)) ?? null;
  const presets: TextPreset[] = [...TEXT_PRESETS, ...p.orgPresets.map((x) => ({ id: `org:${x.id}`, label: x.name, sample: x.name, style: x.payload as Partial<TextObject> }))];
  const ch = contentSize(p.W, p.H, r).h;
  const set = (patch: Partial<TextObject>, live = false) => sel && (live ? p.live : p.commit)(withObject(r, sel.id, (o) => ({ ...(o as TextObject), ...patch })));
  const add = (preset: TextPreset) => {
    const c = contentSize(p.W, p.H, r);
    const o = newText(preset.id === 'caption' ? 'CAPTION' : 'Your text', preset, c.w / c.h);
    p.commit({ ...r, objects: [...r.objects, o] });
    p.onSelect([o.id]);
  };
  const fonts = [...p.brandFonts.map((f) => ({ value: f, label: f, group: 'Brand' })), ...BUNDLED_FONTS.map((f) => ({ value: f.family, label: f.label, group: 'Included' })), ...SYSTEM_FONTS.map((f) => ({ value: f.family, label: f.label, group: 'This computer' }))];
  if (sel && !fonts.some((f) => f.value === sel.font)) fonts.unshift({ value: sel.font, label: `${sel.font} (missing)`, group: 'Brand' });
  return (
    <div className="flex flex-col gap-3">
      <Head title="Text" />
      <Label>Style presets</Label>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={sel?.style_preset === x.id}
            onClick={() => (sel ? p.commit(withObject(r, sel.id, (o) => applyPreset(o as TextObject, x))) : add(x))}
            className={cx('flex h-[52px] items-center justify-center truncate px-2', sel?.style_preset === x.id ? TILE_ON : TILE)}
            style={{ fontFamily: `"${x.style.font ?? 'Plus Jakarta Sans'}", sans-serif`, fontWeight: x.style.weight ?? 700, fontStyle: x.style.italic ? 'italic' : 'normal', color: x.style.outline?.on ? 'transparent' : x.style.pill?.on ? '#1B1F2E' : (x.style.colour ?? '#fff'), WebkitTextStroke: x.style.outline?.on ? '1px #fff' : undefined, letterSpacing: x.style.letterSpacing ? `${x.style.letterSpacing}em` : undefined, fontSize: 17 }}
          >
            <span className={cx(x.style.pill?.on && 'rounded-full px-2.5 py-0.5')} style={{ background: x.style.pill?.on ? x.style.pill.colour : undefined }}>
              {x.sample}
            </span>
          </button>
        ))}
      </div>
      <DarkButton onClick={() => add(TEXT_PRESETS[0]!)} icon={<Icon name="plus" size={14} />}>
        Add text
      </DarkButton>
      {p.missing.length ? <Note tone="warning">{`Not on this computer: ${p.missing.join(', ')}. The text shows in a similar font until the brand font is available.`}</Note> : null}
      {sel ? (
        <>
          <textarea aria-label="Text" value={sel.text} rows={2} onChange={(e) => set({ text: e.target.value }, true)} onBlur={p.settle} className={cx(FIELD, 'h-auto py-1.5')} />
          <Label>Font</Label>
          <Select value={sel.font} aria-label="Font" options={fonts} onValueChange={(v) => set({ font: v })} className="h-8 w-full text-white" searchable />
          <span className="text-[11.5px] text-stage-ink-3">Brand fonts load from Drive › Brand › Fonts and are kept for offline use.</span>
          <div className="grid grid-cols-[90px_1fr] gap-2">
            <label className="flex items-center gap-1 rounded-[8px] border border-stage-line-soft bg-stage px-2 text-[13px] text-stage-ink">
              <input type="number" aria-label="Size in pixels" min={4} max={2000} value={Math.round((sel.size / 1000) * ch)} onChange={(e) => set({ size: (Math.max(4, Number(e.target.value) || 4) / ch) * 1000 }, true)} className="h-8 w-full bg-transparent outline-none" />
              <span className="text-stage-ink-3">px</span>
            </label>
            <Select value={String(sel.weight)} aria-label="Weight" options={[{ value: '400', label: 'Regular' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' }, { value: '800', label: 'Extra bold' }]} onValueChange={(v) => set({ weight: Number(v) })} className="h-8 w-full text-white" />
          </div>
          <div className="flex gap-1.5">
            <div className="flex-1">
              <Seg label="Alignment" value={sel.align} onChange={(align) => set({ align })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
            </div>
            <DarkButton aria-label="Italic" aria-pressed={sel.italic} title="Italic" onClick={() => set({ italic: !sel.italic })} icon={<Icon name="italic" size={14} />}>
              {''}
            </DarkButton>
          </div>
          <Label>Colour</Label>
          <Swatches label="Text colour" value={sel.colour} onChange={(c) => set({ colour: c })} />
          <Slider label="Letter spacing" value={Math.round(sel.letterSpacing * 100)} min={-10} max={60} onChange={(v) => set({ letterSpacing: v / 100 }, true)} onDone={p.settle} />
          <Slider label="Line height" value={sel.lineHeight} min={0.8} max={2.4} step={0.1} onChange={(v) => set({ lineHeight: v }, true)} onDone={p.settle} />
          <Slider label="Opacity" value={Math.round(sel.opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 }, true)} onDone={p.settle} />
          <SwitchRow label="Shadow" sub={sel.shadow.on ? `${Math.round(sel.shadow.blur)} blur · ${sel.shadow.opacity}%` : undefined} checked={sel.shadow.on} onChange={(on) => set({ shadow: { ...sel.shadow, on } })} />
          {sel.shadow.on ? (
            <>
              <Slider label="Shadow blur" value={sel.shadow.blur} min={0} max={60} onChange={(v) => set({ shadow: { ...sel.shadow, blur: v } }, true)} onDone={p.settle} />
              <Slider label="Shadow offset" value={sel.shadow.dy} min={-30} max={30} signed onChange={(v) => set({ shadow: { ...sel.shadow, dy: v, dx: v / 2 } }, true)} onDone={p.settle} />
              <Slider label="Shadow opacity" value={sel.shadow.opacity} min={0} max={100} unit="%" onChange={(v) => set({ shadow: { ...sel.shadow, opacity: v } }, true)} onDone={p.settle} />
              <Swatches label="Shadow colour" value={sel.shadow.colour} onChange={(c) => set({ shadow: { ...sel.shadow, colour: c } })} />
            </>
          ) : null}
          <SwitchRow label="Outline" checked={sel.outline.on} onChange={(on) => set({ outline: { ...sel.outline, on } })} />
          {sel.outline.on ? (
            <>
              <Slider label="Outline width" value={sel.outline.width} min={1} max={20} onChange={(v) => set({ outline: { ...sel.outline, width: v } }, true)} onDone={p.settle} />
              <Swatches label="Outline colour" value={sel.outline.colour} onChange={(c) => set({ outline: { ...sel.outline, colour: c } })} />
            </>
          ) : null}
          <SwitchRow label="Background pill" checked={sel.pill.on} onChange={(on) => set({ pill: { ...sel.pill, on } })} />
          {sel.pill.on ? (
            <>
              <Slider label="Padding" value={sel.pill.padding} min={0} max={60} onChange={(v) => set({ pill: { ...sel.pill, padding: v } }, true)} onDone={p.settle} />
              <Slider label="Roundness" value={sel.pill.radius} min={0} max={80} onChange={(v) => set({ pill: { ...sel.pill, radius: v } }, true)} onDone={p.settle} />
              <Swatches label="Pill colour" value={sel.pill.colour} onChange={(c) => set({ pill: { ...sel.pill, colour: c } })} />
            </>
          ) : null}
        </>
      ) : (
        <span className="text-[12px] text-stage-ink-3">Choose a style to add text, or select text on the picture. Double-click text to type in place; drag its side handles to set where it wraps.</span>
      )}
      <Note>Text stays a live layer in the version: anyone with Edit access can fix a typo after the picture is saved.</Note>
    </div>
  );
}

/* ==================================================================== *
 * Stickers, shapes, From Drive (CRT-20…33)
 * ==================================================================== */

const SHAPES: Array<{ id: ShapeKind; label: string; icon: string }> = [
  { id: 'rect', label: 'Rectangle', icon: '▭' },
  { id: 'roundrect', label: 'Rounded rectangle', icon: '▢' },
  { id: 'ellipse', label: 'Ellipse', icon: '◯' },
  { id: 'triangle', label: 'Triangle', icon: '△' },
  { id: 'line', label: 'Line', icon: '╱' },
  { id: 'arrow', label: 'Arrow', icon: '➚' },
  { id: 'pill', label: 'Pill', icon: '⬭' },
  { id: 'star', label: 'Star', icon: '☆' },
  { id: 'bubble', label: 'Speech bubble', icon: '💬' },
];

function newShape(kind: ShapeKind, aspect: number): ShapeObject {
  const w = 0.24;
  const square = ['ellipse', 'star', 'triangle', 'roundrect', 'rect'].includes(kind);
  return {
    id: newId('s'),
    kind: 'shape',
    shape: kind,
    x: 0.38,
    y: 0.38,
    w,
    h: square ? w * aspect : kind === 'pill' ? w * 0.4 * aspect : kind === 'line' || kind === 'arrow' ? w * 0.5 * aspect : w * 0.7 * aspect,
    rotation: 0,
    opacity: 1,
    fill: { style: kind === 'line' || kind === 'arrow' ? 'outline' : 'filled', colour: '#3B5BDB', colour2: '#9E8CFC', angle: 45 },
    stroke: { width: 6, colour: '#FFFFFF', dash: 'solid' },
    radius: 30,
    shadow: { ...NO_SHADOW },
  };
}

export function StickersPanel(p: PanelProps & { start: 'stickers' | 'shapes'; libraries: Libraries; libraryOffline: boolean; folders: LibraryFolders }) {
  const r = p.recipe;
  const [tab, setTab] = useState<'stickers' | 'shapes' | 'drive'>(p.start);
  const [seen, setSeen] = useState(p.start);
  if (seen !== p.start) {
    setSeen(p.start);
    setTab(p.start);
  }
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState<StickerCategory | 'all' | 'brand'>('all');
  const [picking, setPicking] = useState(false);
  const c = contentSize(p.W, p.H, r);
  const aspect = c.w / c.h;
  const sel = r.objects.find((o) => p.selected.includes(o.id)) ?? null;
  const place = (o: OverlayObject) => {
    p.commit({ ...r, objects: [...r.objects, o] });
    p.onSelect([o.id]);
  };
  const sticker = (id: string, colour: string, name: string) => place({ id: newId('k'), kind: 'sticker', sticker: id, vector: true, colour, outline: { on: false, width: 3, colour: '#FFFFFF' }, shadow: { ...NO_SHADOW }, x: 0.4, y: 0.35, w: 0.16, h: 0.16 * aspect, rotation: 0, opacity: 1, name });
  const fromLibrary = (it: LibraryItem, kind: 'sticker' | 'logo') => {
    const vector = (it.mime_type ?? '').includes('svg') || /\.svg$/i.test(it.name);
    const base = { id: newId(kind === 'logo' ? 'l' : 'k'), x: 0.78, y: 0.76, w: 0.14, h: 0.14 * aspect, rotation: 0, opacity: 1, asset: { file_id: it.file_id, version: it.version }, shadow: { ...NO_SHADOW }, name: it.name };
    place(kind === 'logo' ? { ...base, kind: 'logo', vector } : { ...base, kind: 'sticker', sticker: null, vector, colour: '#FFFFFF', outline: { on: false, width: 3, colour: '#FFFFFF' } });
  };
  const list = searchStickers(term, cat);
  const brand = cat === 'brand' || cat === 'all' ? p.libraries.stickers.filter((s) => !term.trim() || s.name.toLowerCase().includes(term.trim().toLowerCase())) : [];
  const setSel = (patch: Partial<OverlayObject>, live = false) => sel && (live ? p.live : p.commit)(withObject(r, sel.id, (o) => ({ ...o, ...patch }) as OverlayObject));
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Stickers and shapes" className="-mx-4 -mt-4 flex border-b border-stage-line-soft px-2">
        {(['stickers', 'shapes', 'drive'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('h-11 px-3 text-[13px] font-bold', tab === t ? 'border-b-2 border-stage-ink-3 text-white' : 'text-stage-ink-3 hover:text-white')}>
            {t === 'stickers' ? 'Stickers' : t === 'shapes' ? 'Shapes' : 'From Drive'}
          </button>
        ))}
      </div>
      {tab === 'stickers' ? (
        <>
          <input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search stickers" placeholder="Search stickers" className={FIELD} />
          <div className="flex flex-wrap gap-1.5">
            {STICKER_CATEGORIES.map((x) => (
              <Chip key={x.id} on={cat === x.id} onClick={() => setCat(x.id)}>
                {x.label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {list.map((s) => (
              <button key={s.id} type="button" aria-label={`Add sticker: ${s.name}`} title={s.name} onClick={() => sticker(s.id, s.colour, s.name)} className={cx('flex h-[58px] items-center justify-center p-2', TILE)}>
                <img alt="" className="h-full w-full object-contain" src={`data:image/svg+xml;utf8,${encodeURIComponent(stickerSvg(s, s.colour, { on: false, width: 0, colour: '#000' }))}`} />
              </button>
            ))}
            {brand.map((it) => (
              <button key={`${it.file_id}:${it.version}`} type="button" aria-label={`Add brand sticker: ${it.name}`} title={it.name} onClick={() => fromLibrary(it, 'sticker')} className={cx('flex h-[58px] items-center justify-center overflow-hidden p-1.5', TILE)}>
                <LibraryThumb item={it} />
              </button>
            ))}
          </div>
          {!list.length && !brand.length ? <span className="text-[12px] text-stage-ink-3">{cat === 'brand' && !p.libraries.stickers.length ? 'Your admin has not chosen a Stickers folder yet.' : 'No sticker matches.'}</span> : null}
        </>
      ) : null}
      {tab === 'shapes' ? (
        <>
          <Label>Quick shapes</Label>
          <div className="grid grid-cols-5 gap-2">
            {SHAPES.map((s) => (
              <button key={s.id} type="button" aria-label={`Add ${s.label.toLowerCase()}`} title={s.label} onClick={() => place(newShape(s.id, aspect))} className={cx('flex h-11 items-center justify-center text-[20px] text-white', TILE)}>
                {s.icon}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {tab === 'drive' ? (
        <>
          {p.libraryOffline ? <Note tone="info">Offline: the library items kept on this computer.</Note> : null}
          <Label>{`Brand library · ${p.folders.logos?.name ?? 'Logos'}`}</Label>
          <div className="grid grid-cols-3 gap-2">
            {p.libraries.logos.map((it) => (
              <button key={`${it.file_id}:${it.version}`} type="button" aria-label={`Add logo: ${it.name}`} title={it.name} onClick={() => fromLibrary(it, 'logo')} className={cx('flex h-[52px] items-center justify-center overflow-hidden p-1.5', TILE)}>
                <LibraryThumb item={it} />
              </button>
            ))}
          </div>
          {!p.libraries.logos.length ? <span className="text-[12px] text-stage-ink-3">No logos you can view. Your admin chooses the Logos folder in Drive settings › Photo editor.</span> : null}
          <DarkButton onClick={() => setPicking(true)} icon={<Icon name="folder-open" size={14} />}>
            Browse Drive…
          </DarkButton>
          {picking ? (
            <DriveFilePicker
              title="Place a picture from Drive"
              confirmLabel="Place"
              onClose={() => setPicking(false)}
              onChoose={(files) => {
                setPicking(false);
                for (const f of files.filter((x) => /^(png|jpe?g|webp|gif|svg)$/i.test(x.extension ?? ''))) fromLibrary({ file_id: Number(f.id), version: 0, name: f.name, mime_type: f.extension === 'svg' ? 'image/svg+xml' : null, url: '' }, 'logo');
              }}
            />
          ) : null}
        </>
      ) : null}
      {sel && (sel.kind === 'sticker' || sel.kind === 'logo' || sel.kind === 'image') ? (
        <>
          <Label>{sel.kind === 'sticker' ? 'Selected sticker' : 'Selected picture'}</Label>
          {sel.kind === 'sticker' && sel.vector ? (
            <>
              <div className="flex items-center gap-3 text-[12.5px] text-stage-ink">
                Colour
                <Swatches label="Sticker colour" value={sel.colour} onChange={(colour) => setSel({ colour } as Partial<StickerObject>)} colours={['#5B9BFF', '#FFFFFF', '#F59E0B', '#E5484D', '#12A594', '#1B1F2E']} />
              </div>
              <SwitchRow label="Outline" sub={sel.outline.on ? `${sel.outline.width} px` : undefined} checked={sel.outline.on} onChange={(on) => setSel({ outline: { ...sel.outline, on } } as Partial<StickerObject>)} />
              {sel.outline.on ? <Slider label="Outline width" value={sel.outline.width} min={1} max={12} onChange={(v) => setSel({ outline: { ...sel.outline, width: v } } as Partial<StickerObject>, true)} onDone={p.settle} /> : null}
            </>
          ) : (
            <span className="text-[12px] text-stage-ink-3">A picture keeps its own colours: opacity and shadow only.</span>
          )}
          <Slider label="Opacity" value={Math.round(sel.opacity * 100)} min={5} max={100} unit="%" onChange={(v) => setSel({ opacity: v / 100 }, true)} onDone={p.settle} />
          <SwitchRow label="Shadow" checked={sel.shadow.on} onChange={(on) => setSel({ shadow: { ...sel.shadow, on } })} />
        </>
      ) : null}
      {sel && sel.kind === 'shape' && sel.shape !== 'path' ? <ShapeOptions o={sel} set={(patch, live) => setSel(patch as Partial<OverlayObject>, live)} settle={p.settle} /> : null}
    </div>
  );
}

function ShapeOptions({ o, set, settle }: { o: ShapeObject; set: (patch: Partial<ShapeObject>, live?: boolean) => void; settle: () => void }) {
  const lineish = o.shape === 'line' || o.shape === 'arrow';
  return (
    <>
      <Label>Selected shape</Label>
      {!lineish ? <Seg label="Fill" value={o.fill.style} onChange={(style) => set({ fill: { ...o.fill, style } })} options={[{ value: 'filled', label: 'Filled' }, { value: 'outline', label: 'Outline' }, { value: 'gradient', label: 'Gradient' }]} /> : null}
      {o.fill.style !== 'outline' && !lineish ? <Swatches label="Fill colour" value={o.fill.colour} onChange={(c) => set({ fill: { ...o.fill, colour: c } })} /> : null}
      {o.fill.style === 'gradient' ? (
        <>
          <Swatches label="Second colour" value={o.fill.colour2} onChange={(c) => set({ fill: { ...o.fill, colour2: c } })} />
          <Slider label="Angle" value={o.fill.angle} min={0} max={360} unit="°" onChange={(v) => set({ fill: { ...o.fill, angle: v } }, true)} onDone={settle} />
        </>
      ) : null}
      <Slider label="Stroke width" value={o.stroke.width} min={0} max={40} onChange={(v) => set({ stroke: { ...o.stroke, width: v } }, true)} onDone={settle} />
      <Swatches label="Stroke colour" value={o.stroke.colour} onChange={(c) => set({ stroke: { ...o.stroke, colour: c } })} />
      <Seg label="Dash" value={o.stroke.dash} onChange={(dash) => set({ stroke: { ...o.stroke, dash } })} options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }]} />
      {o.shape === 'roundrect' ? <Slider label="Corner radius" value={o.radius} min={0} max={200} onChange={(v) => set({ radius: v }, true)} onDone={settle} /> : null}
      <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 }, true)} onDone={settle} />
    </>
  );
}

/* ==================================================================== *
 * Frames (CRT-40, CRT-41)
 * ==================================================================== */

const FRAME_TILES: Array<{ id: FramePreset; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'thin', label: 'Thin' },
  { id: 'polaroid', label: 'Polaroid' },
  { id: 'film', label: 'Film' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'brand', label: 'Brand' },
];

const FRAME_DEFAULT: Record<FramePreset, Omit<Frame, 'preset'>> = {
  none: { size: 0, colour: '#FFFFFF' },
  thin: { size: 12, colour: '#FFFFFF' },
  polaroid: { size: 36, colour: '#F4EFE6', caption: '' },
  film: { size: 40, colour: '#111111' },
  shadow: { size: 30, colour: '#FFFFFF' },
  brand: { size: 30, colour: '#23349E' },
  library: { size: 40, colour: '#FFFFFF' },
};

export function FramesPanel(p: PanelProps & { libraries: Libraries }) {
  const r = p.recipe;
  const f = r.frame;
  const content = contentSize(p.W, p.H, r);
  const out = outputSize(p.W, p.H, r);
  const choose = (preset: FramePreset, asset?: LibraryItem) => p.commit({ ...r, frame: preset === 'none' ? null : { preset, ...FRAME_DEFAULT[preset], ...(f && f.preset !== 'none' ? { size: f.size || FRAME_DEFAULT[preset].size } : {}), ...(asset ? { asset: { file_id: asset.file_id, version: asset.version } } : {}) } });
  return (
    <div className="flex flex-col gap-3">
      <Head title="Frame" onReset={f ? () => p.commit({ ...r, frame: null }) : null} />
      <div className="grid grid-cols-3 gap-2">
        {FRAME_TILES.map((x) => {
          const on = (f?.preset ?? 'none') === x.id;
          return (
            <button key={x.id} type="button" aria-pressed={on} onClick={() => choose(x.id)} className="flex flex-col items-center gap-1 text-[12px] font-semibold text-stage-ink">
              <span className={cx('flex h-[58px] w-full items-center justify-center', on ? TILE_ON : TILE)}>
                <FrameGlyph id={x.id} />
              </span>
              {x.label}
            </button>
          );
        })}
        {p.libraries.frames.map((it) => {
          const on = f?.preset === 'library' && f.asset?.file_id === it.file_id;
          return (
            <button key={`${it.file_id}`} type="button" aria-pressed={on} onClick={() => choose('library', it)} className="flex flex-col items-center gap-1 text-[12px] font-semibold text-stage-ink">
              <span className={cx('flex h-[58px] w-full items-center justify-center overflow-hidden', on ? TILE_ON : TILE)}><LibraryThumb item={it} /></span>
              <span className="w-full truncate text-center">{it.name.replace(/\.[^.]+$/, '')}</span>
            </button>
          );
        })}
      </div>
      {f ? (
        <>
          <Slider label="Frame size" value={f.size} min={0} max={200} unit=" px" onChange={(v) => p.live({ ...r, frame: { ...f, size: v } })} onDone={p.settle} />
          {f.preset !== 'shadow' && f.preset !== 'library' ? (
            <div className="flex items-center gap-3 text-[12.5px] text-stage-ink">
              Colour
              <Swatches label="Frame colour" value={f.colour} onChange={(colour) => p.commit({ ...r, frame: { ...f, colour } })} colours={['#FFFFFF', '#F4EFE6', '#111111', '#23349E']} />
            </div>
          ) : null}
          {f.preset === 'polaroid' ? <input value={f.caption ?? ''} maxLength={80} onChange={(e) => p.live({ ...r, frame: { ...f, caption: e.target.value } })} onBlur={p.settle} aria-label="Caption" placeholder="Caption, e.g. Ella · October" className={FIELD} /> : null}
        </>
      ) : null}
      <Note>{`Frames and corners make the saved picture larger than the crop: ${content.w} × ${content.h} becomes ${out.w} × ${out.h} px.${r.corners ? ' Transparent corners need PNG or WebP.' : ''}`}</Note>
    </div>
  );
}

function FrameGlyph({ id }: { id: FramePreset }) {
  const inner = 'h-[30px] w-[44px] rounded-[2px] bg-brand';
  switch (id) {
    case 'thin':
      return <span className="rounded-[3px] border-2 border-white p-0"><span className={cx(inner, 'block')} /></span>;
    case 'polaroid':
      return <span className="rounded-[3px] bg-white p-1 pb-2.5"><span className={cx(inner, 'block')} /></span>;
    case 'film':
      return <span className="rounded-[3px] border-y-4 border-dotted border-white bg-black p-0.5"><span className={cx(inner, 'block')} /></span>;
    case 'shadow':
      return <span className={cx(inner, 'block shadow-[0_6px_10px_rgba(0,0,0,.7)]')} />;
    case 'brand':
      return <span className="rounded-[3px] bg-stage-primary p-1"><span className={cx(inner, 'block')} /></span>;
    default:
      return <span className={cx(inner, 'block')} />;
  }
}

/* ==================================================================== *
 * Draw
 * ==================================================================== */

export interface DrawStyle {
  colour: string;
  width: number;
  highlighter: boolean;
  erase: boolean;
}

export function DrawPanel({ style, setStyle }: { style: DrawStyle; setStyle: (s: DrawStyle) => void }) {
  const mode = style.erase ? 'erase' : style.highlighter ? 'highlight' : 'brush';
  return (
    <div className="flex flex-col gap-3">
      <Head title="Draw" />
      <Seg label="Pen" value={mode} onChange={(m) => setStyle({ ...style, erase: m === 'erase', highlighter: m === 'highlight' })} options={[{ value: 'brush', label: 'Brush' }, { value: 'highlight', label: 'Highlighter' }, { value: 'erase', label: 'Eraser' }]} />
      {!style.erase ? (
        <>
          <Swatches label="Pen colour" value={style.colour} onChange={(colour) => setStyle({ ...style, colour })} />
          <Slider label="Width" value={style.width} min={1} max={60} onChange={(width) => setStyle({ ...style, width })} />
          <span className="text-[12px] text-stage-ink-3">Draw on the picture. Each stroke is a layer you can move, hide or delete.</span>
        </>
      ) : (
        <span className="text-[12px] text-stage-ink-3">Click a stroke to remove it.</span>
      )}
    </div>
  );
}

/* ==================================================================== *
 * Mark: the watermark (CRT-50)
 * ==================================================================== */

export function MarkPanel(p: PanelProps & { presets: Preset[]; libraries: Libraries }) {
  const r = p.recipe;
  const wm: Watermark | null = r.watermark;
  const base: Watermark = wm ?? { kind: 'text', text: '', pos: 8, opacity: 60, size: 30, tile: false };
  const set = (patch: Partial<Watermark>, live = false) => (live ? p.live : p.commit)({ ...r, watermark: { ...base, ...patch } });
  return (
    <div className="flex flex-col gap-3">
      <Head title="Watermark" onReset={wm ? () => p.commit({ ...r, watermark: null }) : null} />
      {p.presets.length ? (
        <>
          <Label>Organization presets</Label>
          <div className="flex flex-wrap gap-1.5">
            {p.presets.map((x) => (
              <Chip key={x.id} on={wm?.preset_id === x.id} onClick={() => p.commit({ ...r, watermark: { ...base, ...(x.payload as Partial<Watermark>), preset_id: x.id } })}>
                {x.name}
              </Chip>
            ))}
          </div>
        </>
      ) : null}
      <Seg label="Kind" value={base.kind} onChange={(kind) => set({ kind })} options={[{ value: 'text', label: 'Text' }, { value: 'logo', label: 'Logo', disabled: !p.libraries.logos.length && !base.asset, title: p.libraries.logos.length ? undefined : 'No logos you can view' }]} />
      {base.kind === 'text' ? (
        <input value={base.text} maxLength={120} placeholder="© Your company" aria-label="Watermark text" onChange={(e) => set({ text: e.target.value }, true)} onBlur={p.settle} className={FIELD} />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {p.libraries.logos.map((it) => (
            <button key={it.file_id} type="button" aria-pressed={base.asset?.file_id === it.file_id} onClick={() => set({ asset: { file_id: it.file_id, version: it.version } })} className={cx('flex h-11 items-center justify-center overflow-hidden p-1', base.asset?.file_id === it.file_id ? TILE_ON : TILE)}>
              <LibraryThumb item={it} />
            </button>
          ))}
        </div>
      )}
      {wm ? (
        <>
          <SwitchRow label="Tile across the picture" checked={base.tile} onChange={(tile) => set({ tile })} />
          {!base.tile ? (
            <div className="flex flex-col gap-1.5 text-[12.5px] text-stage-ink">
              Position
              <div role="radiogroup" aria-label="Position" className="grid w-[120px] grid-cols-3 gap-1">
                {Array.from({ length: 9 }, (_, i) => (
                  <button key={i} type="button" role="radio" aria-checked={base.pos === i} aria-label={`Position ${i + 1}`} onClick={() => set({ pos: i })} className={cx('h-[26px] rounded-[5px]', base.pos === i ? 'bg-stage-primary-2' : 'bg-stage-line-soft hover:bg-stage-line-soft')} />
                ))}
              </div>
            </div>
          ) : null}
          <Slider label="Opacity" value={base.opacity} min={10} max={100} unit="%" onChange={(v) => set({ opacity: v }, true)} onDone={p.settle} />
          <Slider label="Size" value={base.size} min={5} max={80} onChange={(v) => set({ size: v }, true)} onDone={p.settle} />
        </>
      ) : null}
    </div>
  );
}

/* ==================================================================== *
 * Redact (CRT-51)
 * ==================================================================== */

export function RedactPanel(p: PanelProps) {
  const r = p.recipe;
  return (
    <div className="flex flex-col gap-3">
      <Head title="Redact" />
      <Note tone="warning">Redact destroys the pixels underneath. Once saved it cannot be removed — not by reopening the edit, and not by anyone else.</Note>
      <span className="text-[12.5px] text-stage-accent">Drag over what to hide: a name, a number, a face.</span>
      <span className="text-[12px] text-stage-ink-3">{r.redactions.length ? `${r.redactions.length} ${r.redactions.length === 1 ? 'area' : 'areas'} blacked out. Undo takes back the last one until you save.` : 'Nothing redacted yet.'}</span>
    </div>
  );
}

/* ==================================================================== *
 * Layers (EDT-E-04 tab; CRT-22)
 * ==================================================================== */

export function LayersPanel(p: PanelProps) {
  const r = p.recipe;
  const chosen = r.objects.filter((o) => p.selected.includes(o.id));
  const move = (id: string, by: 1 | -1) => {
    const i = r.objects.findIndex((o) => o.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= r.objects.length) return;
    const next = [...r.objects];
    [next[i], next[j]] = [next[j]!, next[i]!];
    p.commit({ ...r, objects: next });
  };
  const patch = (ids: string[], fn: (o: OverlayObject) => OverlayObject) => p.commit({ ...r, objects: r.objects.map((o) => (ids.includes(o.id) ? fn(o) : o)) });
  const align = (how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const many = chosen.length > 1;
    const minX = many ? Math.min(...chosen.map((o) => o.x)) : 0;
    const maxX = many ? Math.max(...chosen.map((o) => o.x + o.w)) : 1;
    const minY = many ? Math.min(...chosen.map((o) => o.y)) : 0;
    const maxY = many ? Math.max(...chosen.map((o) => o.y + o.h)) : 1;
    patch(chosen.map((o) => o.id), (o) => {
      const dx = how === 'left' ? minX - o.x : how === 'right' ? maxX - o.w - o.x : how === 'center' ? (minX + maxX) / 2 - o.w / 2 - o.x : 0;
      const dy = how === 'top' ? minY - o.y : how === 'bottom' ? maxY - o.h - o.y : how === 'middle' ? (minY + maxY) / 2 - o.h / 2 - o.y : 0;
      return { ...o, x: o.x + dx, y: o.y + dy, ...(o.kind === 'shape' && o.points ? { points: o.points.map((v, i) => v + (i % 2 ? dy : dx)) } : {}) } as OverlayObject;
    });
  };
  const distribute = (axis: 'x' | 'y') => {
    if (chosen.length < 3) return;
    const sorted = [...chosen].sort((a, b) => a[axis] - b[axis]);
    const first = sorted[0]![axis];
    const last = sorted[sorted.length - 1]![axis];
    const step = (last - first) / (sorted.length - 1);
    const target = new Map(sorted.map((o, i) => [o.id, first + step * i]));
    patch(chosen.map((o) => o.id), (o) => ({ ...o, [axis]: target.get(o.id)! }) as OverlayObject);
  };
  const grouped = chosen.length > 1 && chosen.every((o) => o.group && o.group === chosen[0]!.group);
  return (
    <div className="flex flex-col gap-3">
      <Head title="Layers" />
      {chosen.length ? (
        <>
          <Label>{chosen.length > 1 ? `${chosen.length} selected` : 'Selected'}</Label>
          <div className="grid grid-cols-6 gap-1">
            {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((a) => (
              <DarkButton key={a} aria-label={`Align ${a}`} title={`Align ${a}${chosen.length > 1 ? '' : ' of the picture'}`} onClick={() => align(a)} className="px-0">
                {a === 'left' ? '⇤' : a === 'center' ? '↔' : a === 'right' ? '⇥' : a === 'top' ? '⤒' : a === 'middle' ? '↕' : '⤓'}
              </DarkButton>
            ))}
          </div>
          {chosen.length > 2 ? (
            <div className="flex gap-1.5">
              <DarkButton onClick={() => distribute('x')}>Distribute across</DarkButton>
              <DarkButton onClick={() => distribute('y')}>Distribute down</DarkButton>
            </div>
          ) : null}
          {chosen.length > 1 ? (
            <DarkButton onClick={() => {
              const g = grouped ? null : newId('g');
              patch(chosen.map((o) => o.id), (o) => ({ ...o, group: g }));
            }}>{grouped ? 'Ungroup' : 'Group'}</DarkButton>
          ) : null}
        </>
      ) : null}
      {!r.objects.length ? <span className="text-[12px] text-stage-ink-3">No layers yet. Text, shapes, stickers, logos and drawings show here, top first.</span> : null}
      <ul aria-label="Layers" className="flex flex-col gap-1">
        {[...r.objects].reverse().map((o, n) => {
          const i = r.objects.length - 1 - n;
          const on = p.selected.includes(o.id);
          return (
            <li key={o.id} className={cx('flex items-center gap-1 rounded-[8px] border px-1.5 py-1', on ? 'border-stage-primary-2 bg-navy-2' : 'border-stage-line-soft')}>
              <button type="button" onClick={(e) => p.onSelect(e.shiftKey ? [...p.selected, o.id] : [o.id])} className="min-w-0 flex-1 truncate px-1 text-left text-[12.5px] text-stage-ink">
                {labelOf(o)}
                {o.group ? <span className="ml-1 text-[10.5px] text-stage-ink-3">· group</span> : null}
              </button>
              <button type="button" aria-label={o.hidden ? `Show ${labelOf(o)}` : `Hide ${labelOf(o)}`} title={o.hidden ? 'Show' : 'Hide'} onClick={() => patch([o.id], (x) => ({ ...x, hidden: !x.hidden }))} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-stage-accent hover:bg-white/10"><Icon name={o.hidden ? 'eye-off' : 'eye'} size={14} /></button>
              <button type="button" aria-label={o.locked ? `Unlock ${labelOf(o)}` : `Lock ${labelOf(o)}`} title={o.locked ? 'Unlock' : 'Lock'} onClick={() => patch([o.id], (x) => ({ ...x, locked: !x.locked }))} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-stage-accent hover:bg-white/10"><Icon name={o.locked ? 'lock' : 'unlock'} size={14} /></button>
              <button type="button" aria-label="Bring forward" title="Bring forward" disabled={i === r.objects.length - 1} onClick={() => move(o.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-stage-accent hover:bg-white/10 disabled:opacity-30"><Icon name="arrow-up" size={14} /></button>
              <button type="button" aria-label="Send back" title="Send back" disabled={i === 0} onClick={() => move(o.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-stage-accent hover:bg-white/10 disabled:opacity-30"><Icon name="arrow-down" size={14} /></button>
              <button type="button" aria-label={`Delete ${labelOf(o)}`} title="Delete" onClick={() => (p.commit({ ...r, objects: r.objects.filter((x) => x.id !== o.id) }), p.onSelect(p.selected.filter((x) => x !== o.id)))} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-stage-danger hover:bg-white/10"><Icon name="trash" size={14} /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ==================================================================== *
 * Export (EDT-E-04 tab)
 * ==================================================================== */

export function ExportPanel({ ext, onExport, busy }: { ext: string; onExport: (format: 'png' | 'jpg' | 'webp', quality: number, longEdge: number | null) => void; busy: boolean }) {
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>(ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpg');
  const [quality, setQuality] = useState(90);
  const [size, setSize] = useState<'original' | '2048' | '1024'>('original');
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <Head title="Export" />
      <Seg label="Format" value={format} onChange={setFormat} options={[{ value: 'jpg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} />
      {format !== 'png' ? <Slider label="Quality" value={quality} min={1} max={100} onChange={setQuality} /> : null}
      <Seg label="Size" value={size} onChange={setSize} options={[{ value: 'original', label: 'Original' }, { value: '2048', label: 'Large' }, { value: '1024', label: 'Small' }]} />
      <DarkButton primary disabled={busy} onClick={() => onExport(format, quality, size === 'original' ? null : Number(size))} icon={<Icon name="download" size={14} />}>
        Download a copy
      </DarkButton>
      <span className="text-[12px] text-stage-ink-3">Saved on this computer only; nothing changes in Drive. Large is 2048 px and small 1024 px on the long edge.</span>
    </div>
  );
}

/** A library item's own picture (an SVG fetched with the session into a blob URL), or its name while it loads. */
function LibraryThumb({ item }: { item: LibraryItem }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    let made: string | null = null;
    void itemPicture(item).then((u) => {
      made = u;
      if (gone && u) URL.revokeObjectURL(u);
      else setUrl(u);
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [item]);
  return url ? <img alt="" src={url} className="h-full w-full object-contain" /> : <span className="truncate px-1 text-[11px] text-navy-ink">{item.name}</span>;
}
