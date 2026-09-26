import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { apiGet, apiPost, apiUrl, request } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { bytes, dateLabel, listStamp } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Spinner, cx } from '../../components/ui';
import { can, type DriveFile } from './api';
import { ADJUSTMENTS, BLANK, LOOKS, isBlank, outputSize, outputType, render, summary, turned, type Adjustment, type Look, type Recipe } from './imaging';

interface Opened {
  file: { id: number; name: string; version: number; extension: string | null; size: number };
  image: { width: number | null; height: number | null } | null;
  exif: Record<string, unknown> | null;
  source: string | null;
  editable: boolean;
  needs: string | null;
  versions: Array<{ id: number; version: number; size: number; note: string | null; created_at: string }>;
}

type Tool = 'crop' | 'rotate' | 'adjust' | 'filters' | 'watermark' | 'resize' | 'info';
const TOOLS: Array<[Tool, string, string]> = [
  ['crop', 'Crop', '⌗'],
  ['rotate', 'Rotate', '↻'],
  ['adjust', 'Adjust', '◐'],
  ['filters', 'Filters', '◍'],
  ['watermark', 'Watermark', '©'],
  ['resize', 'Resize', '⤢'],
  ['info', 'Info', 'ⓘ'],
];
const LABEL: Record<Adjustment, string> = { exposure: 'Exposure', brightness: 'Brightness', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', saturation: 'Saturation', vibrance: 'Vibrance', temperature: 'Temperature', tint: 'Tint', hue: 'Hue', gamma: 'Gamma' };
const LOOK_LABEL: Record<Look, string> = { none: 'Original', mono: 'Mono', sepia: 'Sepia', warm: 'Warm', cool: 'Cool', vivid: 'Vivid', fade: 'Fade' };
const ASPECTS: Array<[string, number | null]> = [['Free', null], ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9]];
const PREVIEW_MAX = 1800;

function sourcePath(source: string | null): string | null {
  if (!source) return null;
  if (source.startsWith('/media/')) return apiUrl(source);
  const at = source.indexOf('/media/');
  return at >= 0 ? apiUrl(source.slice(at)) : null;
}

/**
 * The image editor (DriveImage): crop, turn and flip, eleven adjustments,
 * looks, a text watermark and resize, drawn live; Undo, and Compare (hold)
 * for the original. Saving makes the next version of the file, or a copy.
 */
export function ImageEditor({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'image', file.id], queryFn: ({ signal }) => apiGet<Opened>(`/api/drive/image/${file.id}`, undefined, signal), gcTime: 0 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(BLANK);
  const [undo, setUndo] = useState<Recipe[]>([]);
  const [tool, setTool] = useState<Tool>('adjust');
  const [comparing, setComparing] = useState(false);
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit');
  const [saving, setSaving] = useState<'version' | 'copy' | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [lockRatio, setLockRatio] = useState(true);
  const [dragFrom, setDragFrom] = useState<Recipe | null>(null);
  const [copyName, setCopyName] = useState<string | null>(null);
  /** The edits last saved as a copy: closing then loses nothing. */
  const [copied, setCopied] = useState<string | null>(null);
  const stage = useRef<HTMLCanvasElement>(null);
  const cropBox = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const o = q.data;
  const ext = (o?.file.extension ?? file.extension ?? '').toLowerCase();
  const src = sourcePath(o?.source ?? null);

  // The picture, read through the app so its pixels can be saved, and read
  // afresh after each save (the signed address can stay the same).
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!src) return;
    let gone = false;
    let object: string | null = null;
    void (async () => {
      try {
        const res = await fetch(src, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        object = URL.createObjectURL(await res.blob());
        const el = new Image();
        el.onload = () => !gone && setImg(el);
        el.onerror = () => !gone && setLoadError('The picture could not be read.');
        el.src = object;
      } catch {
        if (!gone) setLoadError('The picture could not be loaded.');
      }
    })();
    return () => {
      gone = true;
      if (object) URL.revokeObjectURL(object);
    };
  }, [src, rev]);

  // Draw the preview whenever the recipe (or what is shown) changes.
  const shown: Recipe = comparing ? BLANK : tool === 'crop' ? { ...recipe, crop: null, resize: null } : recipe;
  useEffect(() => {
    if (!img || !stage.current) return;
    const frame = requestAnimationFrame(() => {
      const size = outputSize(img.width, img.height, shown);
      const scale = Math.min(1, PREVIEW_MAX / Math.max(size.w, size.h));
      const c = render(img, shown, scale);
      const el = stage.current;
      if (!el) return;
      el.width = c.width;
      el.height = c.height;
      el.getContext('2d')!.drawImage(c, 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  });

  const commit = (next: Recipe) => {
    setUndo([...undo.slice(-49), recipe]);
    setRecipe(next);
  };
  const back = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    setUndo(undo.slice(0, -1));
    setRecipe(prev);
  };
  const dirty = !isBlank(recipe);
  const unsaved = dirty && JSON.stringify(recipe) !== copied;
  const size = img ? outputSize(img.width, img.height, recipe) : null;

  const close = () => {
    if (unsaved && !window.confirm('Close without saving your edits?')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        back();
      } else if (e.key === 'Escape' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const renderFull = async (): Promise<Blob> => {
    if (!img) throw new Error('The picture is not loaded yet.');
    const c = render(img, recipe, 1);
    const type = outputType(ext);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type.mime, 0.92));
    if (!blob) throw new Error('The picture could not be drawn.');
    if (blob.size > 24 * 1024 * 1024) throw new Error('The edited picture is larger than 24 MB. Resize it first.');
    return blob;
  };
  const saveVersion = async () => {
    setSaving('version');
    try {
      const blob = await renderFull();
      const form = new FormData();
      form.append('image', blob, file.name);
      form.append('note', summary(recipe));
      form.append('summary', summary(recipe));
      form.append('recipe', JSON.stringify(recipe));
      const r = (await request<{ version: number }>('POST', `/api/drive/image/${file.id}/save`, { body: form })).data;
      toast('success', `Saved as version ${r.version}`);
      setRecipe(BLANK);
      setUndo([]);
      setImg(null);
      setCopied(null);
      await q.refetch();
      setRev((n) => n + 1);
      void qc.invalidateQueries({ queryKey: ['files'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(null);
    }
  };
  const saveCopy = async (name: string) => {
    setCopyName(null);
    if (!name.trim()) return;
    setSaving('copy');
    try {
      const blob = await renderFull();
      const form = new FormData();
      form.append('image', blob, name.trim());
      form.append('source_id', String(file.id));
      form.append('name', name.trim());
      const r = (await request<{ name: string }>('POST', '/api/drive/image/derive', { body: form })).data;
      toast('success', `Saved “${r.name}” next to the original`);
      setCopied(JSON.stringify(recipe));
      void qc.invalidateQueries({ queryKey: ['files'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(null);
    }
  };
  const prepare = async () => {
    try {
      await apiPost(`/api/drive/image/${file.id}/prepare`);
      toast('info', 'Preparing a viewable copy. The original is not changed.');
      setTimeout(() => void q.refetch(), 3000);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  // Drawing a crop on the picture: fractions of the (uncropped) turned image.
  const point = (e: ReactPointerEvent) => {
    const r = cropBox.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const cropDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = point(e);
    setCropRect({ ...drawing.current, w: 0, h: 0 });
  };
  const cropMove = (e: ReactPointerEvent) => {
    const from = drawing.current;
    if (!from || !img) return;
    const p = point(e);
    let w = Math.abs(p.x - from.x);
    let h = Math.abs(p.y - from.y);
    if (aspect) {
      const t = turned(img.width, img.height, recipe.rotate);
      const want = (aspect * t.h) / t.w;
      if (w / h > want) w = h * want;
      else h = w / want;
    }
    setCropRect({ x: p.x < from.x ? from.x - w : from.x, y: p.y < from.y ? from.y - h : from.y, w, h });
  };
  const cropUp = () => {
    drawing.current = null;
  };

  const panel = 'flex flex-col gap-2.5';
  const head = (t: string, reset?: () => void) => (
    <div className="flex items-center">
      <h2 className="flex-1 text-[15px] font-bold text-ink">{t}</h2>
      {reset ? <button type="button" onClick={reset} className="text-[12px] font-semibold text-primary hover:underline">Reset</button> : null}
    </div>
  );
  const editable = !!o?.editable && can(file.access, 'upload_version');
  const nextVersion = (o?.file.version ?? file.version ?? 1) + 1;
  const cr = recipe.crop;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Edit image ${file.name}`} className="no-drag fixed inset-0 z-50 flex flex-col bg-ground text-[13px]">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 bg-[#0F1B3D] px-4 text-white">
        <button type="button" aria-label="Back" onClick={close} className="flex h-[34px] w-[34px] items-center justify-center rounded-[8px] text-[#E6ECFA] hover:bg-white/10"><Icon name="chevron-left" size={18} /></button>
        <b className="truncate text-[14px]">{file.name}</b>
        <span className="text-[12px] text-[#AFC0E8]">Editing · version {o?.file.version ?? file.version ?? 1}</span>
        {unsaved ? <span className="rounded-[10px] bg-[#3A3413] px-[9px] py-[3px] text-[11.5px] font-bold text-[#FDE68A]">Not saved</span> : dirty ? <span className="rounded-[10px] bg-[#123D33] px-[9px] py-[3px] text-[11.5px] font-bold text-[#9EE6C3]">Saved as a copy</span> : null}
        <span className="flex-1" />
        <button type="button" disabled={!undo.length} onClick={back} className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold text-[#E6ECFA] hover:bg-white/10 disabled:opacity-40">Undo</button>
        <button type="button" disabled={!dirty} aria-pressed={comparing} onPointerDown={() => setComparing(true)} onPointerUp={() => setComparing(false)} onPointerLeave={() => setComparing(false)} title="Hold to see the original" className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold text-[#E6ECFA] hover:bg-white/10 disabled:opacity-40">Compare</button>
        {can(file.access, 'download') ? <button type="button" disabled={!img || !!saving} onClick={() => setCopyName(`${file.name.replace(/\.[^.]+$/, '')} (edited).${outputType(ext).ext}`)} className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold text-[#E6ECFA] hover:bg-white/10 disabled:opacity-40">{saving === 'copy' ? 'Saving…' : 'Save as copy'}</button> : null}
        {editable ? <button type="button" disabled={!dirty || !img || !!saving} onClick={() => void saveVersion()} className="h-[34px] rounded-[8px] bg-[#3B5BDB] px-3.5 font-bold text-white hover:brightness-110 disabled:opacity-40">{saving === 'version' ? 'Saving…' : `Save as version ${nextVersion}`}</button> : null}
        <button type="button" aria-label="Close editor" onClick={close} className="ml-1 flex h-[34px] w-[34px] items-center justify-center rounded-[8px] text-[18px] text-[#C3CEEA] hover:bg-white/10">×</button>
      </div>
      {copyName !== null ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <span className="font-semibold text-ink">Save a copy as</span>
          <input autoFocus value={copyName} maxLength={255} onChange={(e) => setCopyName(e.target.value.replace(/[/\\]/g, ''))} onKeyDown={(e) => (e.key === 'Enter' ? void saveCopy(copyName) : e.key === 'Escape' ? setCopyName(null) : undefined)} aria-label="Name of the copy" className="h-8 w-[360px] rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
          <Button size="sm" variant="primary" disabled={!copyName.trim()} onClick={() => void saveCopy(copyName)}>Save copy</Button>
          <Button size="sm" onClick={() => setCopyName(null)}>Cancel</Button>
          <span className="text-[12px] text-ink-3">It goes next to the original; the original is not changed.</span>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Tools" className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-surface py-3.5 text-[10.5px] font-semibold text-ink-2">
          {TOOLS.map(([k, l, g]) => (
            <button key={k} type="button" aria-pressed={tool === k} onClick={() => (setTool(k), setCropRect(k === 'crop' ? (recipe.crop ?? null) : null))} className={cx('flex h-14 w-[60px] flex-col items-center justify-center gap-[3px] rounded-[9px]', tool === k ? 'bg-selection text-primary' : 'hover:bg-subtle')}>
              <span className="text-[16px]">{g}</span>
              {l}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-6">
          <div className={cx('relative flex min-h-0 flex-1 rounded-[12px] bg-[#2B3448]', zoom === 'fit' ? 'items-center justify-center overflow-hidden p-5' : 'overflow-auto p-5')}>
            {q.isLoading || (src && !img && !loadError) ? <Spinner /> : null}
            {q.error ? <p className="text-[#FFB4A3]">{errorMessage(q.error)}</p> : null}
            {loadError ? <p className="text-[#FFB4A3]">{loadError}</p> : null}
            {o && !o.source ? (
              <div className="flex flex-col items-center gap-3 text-center text-[#E6ECFA]">
                <span>This picture needs a viewable copy before it can be edited.</span>
                <Button variant="primary" onClick={() => void prepare()}>Prepare it</Button>
              </div>
            ) : null}
            <div className="relative" style={{ lineHeight: 0 }}>
              <canvas ref={stage} aria-label="Picture" className={cx('rounded-[4px] shadow-[0_10px_30px_rgba(0,0,0,.35)]', zoom === 'fit' ? 'max-h-[calc(100vh-200px)] max-w-full' : '', !img && 'hidden')} />
              {tool === 'crop' && img ? (
                <div ref={cropBox} onPointerDown={cropDown} onPointerMove={cropMove} onPointerUp={cropUp} className="absolute inset-0 cursor-crosshair touch-none">
                  {cropRect && cropRect.w > 0.01 ? (
                    <div className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,.45)]" style={{ left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`, width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%` }} />
                  ) : null}
                </div>
              ) : null}
            </div>
            {comparing ? <span className="absolute top-3 left-3 rounded-[6px] bg-black/60 px-2 py-0.5 text-[11.5px] font-bold text-white">Original</span> : null}
          </div>
          <div className="flex items-center gap-2.5 text-[12px] text-ink-2">
            <span>{size ? `${size.w} × ${size.h}` : ''} · {ext.toUpperCase()}{img && (size!.w !== img.width || size!.h !== img.height) ? ` (was ${img.width} × ${img.height})` : ''}</span>
            <span className="flex-1" />
            <span>Zoom</span>
            <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')} className={cx('h-[26px] rounded-[6px] border border-line px-2', zoom === 'fit' ? 'bg-selection text-primary' : 'bg-surface')}>Fit</button>
            <button type="button" aria-pressed={zoom === 'full'} onClick={() => setZoom('full')} className={cx('h-[26px] rounded-[6px] border border-line px-2', zoom === 'full' ? 'bg-selection text-primary' : 'bg-surface')}>100%</button>
          </div>
        </div>
        <aside aria-label={TOOLS.find((t) => t[0] === tool)![1]} className="flex w-[330px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-surface px-[18px] py-4 scroll-thin">
          {tool === 'crop' ? (
            <div className={panel}>
              {head('Crop', cr ? () => (commit({ ...recipe, crop: null }), setCropRect(null)) : undefined)}
              <span className="text-[12.5px] text-ink-2">Drag on the picture to choose what to keep.</span>
              <div className="flex flex-wrap gap-1.5">
                {ASPECTS.map(([l, v]) => (
                  <button key={l} type="button" aria-pressed={aspect === v} onClick={() => setAspect(v)} className={cx('h-7 rounded-[14px] px-3 text-[12px] font-semibold', aspect === v ? 'bg-primary text-white' : 'border border-line text-ink hover:bg-subtle')}>{l}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="primary" disabled={!cropRect || cropRect.w < 0.02 || cropRect.h < 0.02} onClick={() => (commit({ ...recipe, crop: cropRect, resize: null }), setTool('adjust'))}>Apply crop</Button>
                <Button onClick={() => setCropRect(recipe.crop ?? null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
          {tool === 'rotate' ? (
            <div className={panel}>
              {head('Rotate and flip', recipe.rotate || recipe.flipH || recipe.flipV ? () => commit({ ...recipe, rotate: 0, flipH: false, flipV: false, crop: null }) : undefined)}
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => commit({ ...recipe, rotate: (((recipe.rotate + 270) % 360) as Recipe['rotate']), crop: null, resize: null })}>↺ Turn left</Button>
                <Button onClick={() => commit({ ...recipe, rotate: (((recipe.rotate + 90) % 360) as Recipe['rotate']), crop: null, resize: null })}>↻ Turn right</Button>
                <Button aria-pressed={recipe.flipH} onClick={() => commit({ ...recipe, flipH: !recipe.flipH })}>⇆ Flip across</Button>
                <Button aria-pressed={recipe.flipV} onClick={() => commit({ ...recipe, flipV: !recipe.flipV })}>⇅ Flip down</Button>
              </div>
              <span className="text-[12px] text-ink-3">Turning clears a crop, which is drawn on the turned picture.</span>
            </div>
          ) : null}
          {tool === 'adjust' ? (
            <div className={panel}>
              {head('Adjust', ADJUSTMENTS.some((a) => recipe.adjust[a]) ? () => commit({ ...recipe, adjust: { ...BLANK.adjust } }) : undefined)}
              {ADJUSTMENTS.map((a) => (
                <label key={a} className="grid grid-cols-[92px_1fr_36px] items-center gap-2 text-[12.5px] text-ink">
                  {LABEL[a]}
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={recipe.adjust[a]}
                    aria-label={LABEL[a]}
                    onPointerDown={() => setDragFrom(recipe)}
                    onPointerUp={() => (dragFrom ? (setUndo([...undo.slice(-49), dragFrom]), setDragFrom(null)) : undefined)}
                    onChange={(e) => setRecipe({ ...recipe, adjust: { ...recipe.adjust, [a]: Number(e.target.value) } })}
                    className="accent-[var(--color-primary)]"
                  />
                  <span className="text-right font-mono text-[11.5px] text-ink-2">{recipe.adjust[a]}</span>
                </label>
              ))}
            </div>
          ) : null}
          {tool === 'filters' ? (
            <div className={panel}>
              {head('Looks', recipe.look !== 'none' ? () => commit({ ...recipe, look: 'none' }) : undefined)}
              <div className="grid grid-cols-2 gap-2">
                {LOOKS.map((l) => (
                  <button key={l} type="button" aria-pressed={recipe.look === l} onClick={() => commit({ ...recipe, look: l })} className={cx('h-10 rounded-[9px] text-[12.5px] font-semibold', recipe.look === l ? 'bg-primary text-white' : 'border border-line text-ink hover:bg-subtle')}>
                    {LOOK_LABEL[l]}
                  </button>
                ))}
              </div>
              <span className="text-[12px] text-ink-3">A look adds to the Adjust sliders.</span>
            </div>
          ) : null}
          {tool === 'watermark' ? (
            <div className={panel}>
              {head('Watermark', recipe.watermark ? () => commit({ ...recipe, watermark: null }) : undefined)}
              <label className="flex flex-col gap-[5px] font-semibold text-ink">
                Text
                <input value={recipe.watermark?.text ?? ''} maxLength={120} placeholder="© Your company" onChange={(e) => setRecipe({ ...recipe, watermark: { pos: 8, opacity: 60, size: 30, ...recipe.watermark, text: e.target.value } })} onBlur={() => recipe.watermark && setUndo([...undo.slice(-49), { ...recipe, watermark: null }])} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 font-normal outline-none focus:border-primary" />
              </label>
              {recipe.watermark ? (
                <>
                  <div className="flex flex-col gap-1.5 font-semibold text-ink">
                    Position
                    <div role="radiogroup" aria-label="Position" className="grid w-[114px] grid-cols-3 gap-1">
                      {Array.from({ length: 9 }, (_, i) => (
                        <button key={i} type="button" role="radio" aria-checked={recipe.watermark!.pos === i} aria-label={`Position ${i + 1}`} onClick={() => commit({ ...recipe, watermark: { ...recipe.watermark!, pos: i } })} className={cx('h-[26px] w-[34px] rounded-[5px]', recipe.watermark!.pos === i ? 'bg-primary' : 'bg-subtle hover:bg-line')} />
                      ))}
                    </div>
                  </div>
                  <label className="grid grid-cols-[70px_1fr_36px] items-center gap-2 text-ink">
                    Opacity
                    <input type="range" min={10} max={100} value={recipe.watermark.opacity} onChange={(e) => setRecipe({ ...recipe, watermark: { ...recipe.watermark!, opacity: Number(e.target.value) } })} className="accent-[var(--color-primary)]" />
                    <span className="text-right font-mono text-[11.5px]">{recipe.watermark.opacity}</span>
                  </label>
                  <label className="grid grid-cols-[70px_1fr_36px] items-center gap-2 text-ink">
                    Size
                    <input type="range" min={5} max={80} value={recipe.watermark.size} onChange={(e) => setRecipe({ ...recipe, watermark: { ...recipe.watermark!, size: Number(e.target.value) } })} className="accent-[var(--color-primary)]" />
                    <span className="text-right font-mono text-[11.5px]">{recipe.watermark.size}</span>
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
          {tool === 'resize' && img ? (
            <ResizePanel base={outputSize(img.width, img.height, { ...recipe, resize: null })} value={recipe.resize} lock={lockRatio} setLock={setLockRatio} onChange={(r) => commit({ ...recipe, resize: r })} />
          ) : null}
          {tool === 'info' ? (
            <div className={panel}>
              {head('Info & versions')}
              <div className="flex flex-col gap-1.5 text-[12.5px] text-ink">
                <span><b>Size:</b> {img ? `${img.width} × ${img.height}` : '—'} · {bytes(o?.file.size ?? file.size)}</span>
                {Object.entries(o?.exif ?? {})
                  .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
                  .slice(0, 12)
                  .map(([k, v]) => (
                    <span key={k}><b className="capitalize">{k.replace(/_/g, ' ')}:</b> {String(v)}</span>
                  ))}
                {!o?.exif || !Object.keys(o.exif).length ? <span className="text-ink-3">No camera details in this file.</span> : null}
                {file.description ? <span><b>Description:</b> {file.description}</span> : null}
              </div>
              <b className="mt-2 text-ink">Versions</b>
              <span className="flex items-center gap-2 text-[12.5px] text-ink">Version {o?.file.version ?? 1} · current <span className="rounded-[10px] bg-success-bg px-2 text-[11px] font-bold text-success">Current</span></span>
              {(o?.versions ?? []).filter((v) => v.version !== o?.file.version).map((v) => (
                <span key={v.id} className="flex items-center gap-2 text-[12.5px] text-ink">
                  <span className="flex-1">Version {v.version} · {dateLabel(v.created_at)}{v.note ? ` · ${v.note}` : ''}</span>
                  {editable ? (
                    <button
                      type="button"
                      onClick={() =>
                        void apiPost(`/api/files/${file.id}/versions/${v.id}/restore`).then(
                          () => (toast('success', `Version ${v.version} restored`), setImg(null), void q.refetch().then(() => setRev((n) => n + 1)), void qc.invalidateQueries({ queryKey: ['files'] })),
                          (e) => toast('error', errorMessage(e)),
                        )
                      }
                      className="font-semibold text-primary hover:underline"
                    >
                      Restore
                    </button>
                  ) : null}
                </span>
              ))}
              <span className="text-[11.5px] text-ink-3">Changed {listStamp(file.updated_at)}. Saving here makes a new version; the old ones stay.</span>
            </div>
          ) : null}
          {!editable && o ? <p className="mt-auto rounded-[8px] bg-warning-bg p-2.5 text-[12px] text-warning">{o.editable ? 'You can edit a copy of this picture, not the picture itself.' : 'This kind of picture is saved as a copy (PNG).'}</p> : null}
        </aside>
      </div>
    </div>
  );
}

function ResizePanel({ base, value, lock, setLock, onChange }: { base: { w: number; h: number }; value: { w: number; h: number } | null; lock: boolean; setLock: (v: boolean) => void; onChange: (r: { w: number; h: number } | null) => void }) {
  const cur = value ?? base;
  const [w, setW] = useState(String(cur.w));
  const [h, setH] = useState(String(cur.h));
  const ratio = base.w / base.h;
  const input = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary';
  const apply = (nw: number, nh: number) => {
    if (nw >= 1 && nh >= 1 && nw <= 12000 && nh <= 12000) onChange(nw === base.w && nh === base.h ? null : { w: nw, h: nh });
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center">
        <h2 className="flex-1 text-[15px] font-bold text-ink">Resize</h2>
        {value ? <button type="button" onClick={() => (onChange(null), setW(String(base.w)), setH(String(base.h)))} className="text-[12px] font-semibold text-primary hover:underline">Reset</button> : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Width
          <input type="number" min={1} max={12000} value={w} onChange={(e) => (setW(e.target.value), lock && setH(String(Math.round(Number(e.target.value) / ratio) || '')))} className={input} />
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Height
          <input type="number" min={1} max={12000} value={h} onChange={(e) => (setH(e.target.value), lock && setW(String(Math.round(Number(e.target.value) * ratio) || '')))} className={input} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-ink">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} className="accent-[var(--color-primary)]" />
        Keep the proportions
      </label>
      <div className="flex flex-wrap gap-1.5">
        {[0.5, 0.25].map((f) => (
          <button key={f} type="button" onClick={() => (setW(String(Math.round(base.w * f))), setH(String(Math.round(base.h * f))))} className="h-7 rounded-[14px] border border-line px-3 text-[12px] font-semibold text-ink hover:bg-subtle">{f * 100}%</button>
        ))}
        {[1920, 1280].filter((x) => x < base.w).map((x) => (
          <button key={x} type="button" onClick={() => (setW(String(x)), setH(String(Math.round(x / ratio))))} className="h-7 rounded-[14px] border border-line px-3 text-[12px] font-semibold text-ink hover:bg-subtle">{x} wide</button>
        ))}
      </div>
      <Button variant="primary" onClick={() => apply(Number(w), Number(h))}>Apply size</Button>
      <span className="text-[12px] text-ink-3">Now {cur.w} × {cur.h}; the picture as cropped is {base.w} × {base.h}.</span>
    </div>
  );
}
