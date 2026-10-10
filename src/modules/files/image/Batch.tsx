import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Modal, Switch, cx } from '../../../components/ui';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { can, extOf, flatten, thumbUrl, tree as loadTree, type DriveFile } from '../api';
import { batchStatus, cancelBatch, listPresets, pauseBatch, savePreset, startBatch, type BatchJob, type BatchStep, type Preset } from './api';
import { FILTERS, blankRecipe, filterLabel, type FilterName, type FramePreset, type Recipe } from './recipe';
import { renderRecipe } from './render';

/**
 * Batch edit (BAT-01…07, P09): ordered steps, each on or off, run on up to 500 photos — renames at once, the pixel
 * work as a job on the server that the tray follows (progress, time left, pause, cancel; what was skipped and why).
 * The first five are previewed here, drawn by the editor's own pipeline.
 */
export const BATCH_MAX = 500;

export interface BatchSteps {
  resize: { on: boolean; longEdge: number };
  filter: { on: boolean; name: FilterName; strength: number };
  watermark: { on: boolean; text: string; pos: number; opacity: number };
  frame: { on: boolean; preset: FramePreset; size: number; colour: string };
  convert: { on: boolean; format: 'jpg' | 'png' | 'webp'; quality: number };
  strip_gps: { on: boolean };
  rename: { on: boolean; pattern: string };
}

export const DEFAULT_STEPS: BatchSteps = {
  resize: { on: true, longEdge: 1600 },
  filter: { on: false, name: 'warm', strength: 60 },
  watermark: { on: false, text: '©', pos: 8, opacity: 70 },
  frame: { on: false, preset: 'thin', size: 20, colour: '#FFFFFF' },
  convert: { on: false, format: 'webp', quality: 82 },
  strip_gps: { on: true },
  rename: { on: false, pattern: '{name}-{n}' },
};

/** A rename pattern for one file: {name}, {n} (from 1, padded to the count's width), {ext}, {date}. */
export function renamed(pattern: string, f: { name: string; extension?: string | null }, n: number, total: number, date = new Date(), newExt?: string | null): string {
  const ext = newExt ?? extOf(f.name, f.extension);
  const base = f.name.replace(/\.[^.]+$/, '');
  const width = String(Math.max(total, 1)).length;
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const out = pattern.replace(/\{name\}/g, base).replace(/\{n\}/g, String(n).padStart(Math.max(2, width), '0')).replace(/\{ext\}/g, ext).replace(/\{date\}/g, day).replace(/[/\\]/g, '-').trim();
  return /\{ext\}/.test(pattern) ? out : `${out}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

/** The steps as the server's batch job takes them (§14.3), in order. */
const POSITIONS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] as const;

export function toSteps(s: BatchSteps, output: 'versions' | 'copies' = 'copies'): BatchStep[] {
  const out: BatchStep[] = [];
  if (s.resize.on) out.push({ type: 'resize', edge: s.resize.longEdge });
  if (s.filter.on) out.push({ type: 'filter', name: s.filter.name, strength: s.filter.strength });
  if (s.watermark.on && s.watermark.text.trim()) out.push({ type: 'watermark', text: s.watermark.text.trim(), position: POSITIONS[s.watermark.pos] ?? 'br', opacity: s.watermark.opacity, size: 4, colour: '#FFFFFF', tile: false });
  if (s.frame.on) out.push({ type: 'frame', size: s.frame.size, colour: s.frame.colour });
  // A new version keeps its file's type; only copies change format.
  if (s.convert.on && output === 'copies') out.push({ type: 'convert', format: s.convert.format, quality: s.convert.quality });
  if (s.strip_gps.on) out.push({ type: 'strip_gps' });
  if (s.rename.on && s.rename.pattern.trim()) out.push({ type: 'rename', pattern: s.rename.pattern.trim(), start: 1 });
  return out;
}

/** The pixel steps as an editor recipe, for the preview. */
export function previewRecipe(s: BatchSteps): Recipe {
  const r = blankRecipe(null);
  return {
    ...r,
    filter: s.filter.on ? { name: s.filter.name, strength: s.filter.strength, scope: 'image', preset: null } : r.filter,
    watermark: s.watermark.on && s.watermark.text.trim() ? { kind: 'text', text: s.watermark.text.trim(), pos: s.watermark.pos, opacity: s.watermark.opacity, size: 24, tile: false } : null,
    frame: s.frame.on ? { preset: s.frame.preset, size: s.frame.size, colour: s.frame.colour } : null,
  };
}

function summaryOf(k: keyof BatchSteps, s: BatchSteps): string {
  switch (k) {
    case 'resize':
      return `Longest edge ${s.resize.longEdge} px · never enlarge`;
    case 'filter':
      return `${filterLabel(s.filter.name)} · ${s.filter.strength}%`;
    case 'watermark':
      return `“${s.watermark.text}” · ${['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'][s.watermark.pos]} · ${s.watermark.opacity}% opacity`;
    case 'frame':
      return s.frame.on ? `${s.frame.size} px` : 'Off';
    case 'convert':
      return `${s.convert.format.toUpperCase()}${s.convert.format !== 'png' ? ` · quality ${s.convert.quality}` : ''}`;
    case 'strip_gps':
      return 'Camera details stay';
    default:
      return s.rename.pattern;
  }
}

const STEP_META: Array<{ key: keyof BatchSteps; title: string; icon: string }> = [
  { key: 'resize', title: 'Resize', icon: 'scaling' },
  { key: 'filter', title: 'Filter preset', icon: 'blend' },
  { key: 'watermark', title: 'Watermark', icon: 'droplet' },
  { key: 'frame', title: 'Frame', icon: 'frame' },
  { key: 'convert', title: 'Convert format', icon: 'download' },
  { key: 'strip_gps', title: 'Remove GPS location', icon: 'map-pin' },
  { key: 'rename', title: 'Rename', icon: 'type' },
];

const field = 'h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary';

export function BatchDialog({ files, folderName, onClose, onStarted }: { files: DriveFile[]; folderName: string; onClose: () => void; onStarted: (job: { id: number | string; label: string; total: number }) => void }) {
  const [steps, setSteps] = useState<BatchSteps>(DEFAULT_STEPS);
  const [open, setOpen] = useState<keyof BatchSteps | null>(null);
  const [output, setOutput] = useState<'versions' | 'copies'>('versions');
  const [folder, setFolder] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const chosen = files.slice(0, BATCH_MAX);
  const skipped = output === 'versions' ? chosen.filter((f) => !can(f.access, 'upload_version') && !can(f.access, 'edit')) : [];
  const presetsQ = useQuery({ queryKey: ['files', 'image-presets', 'batch'], queryFn: () => listPresets('batch').catch(() => [] as Preset[]) });
  const treeQ = useQuery({ queryKey: ['files', 'tree'], queryFn: ({ signal }) => loadTree(signal), enabled: output === 'copies' });
  const set = <K extends keyof BatchSteps>(k: K, patch: Partial<BatchSteps[K]>) => setSteps((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  const first = chosen.slice(0, 5);
  const recipeKey = JSON.stringify(previewRecipe(steps));

  // The first five, drawn with the steps (BAT-03).
  useEffect(() => {
    let gone = false;
    const r = previewRecipe(steps);
    void (async () => {
      const out: Record<number, string> = {};
      for (const f of first) {
        try {
          const res = await fetch(thumbUrl(f.id));
          if (!res.ok) continue;
          const bmp = await createImageBitmap(await res.blob());
          const c = renderRecipe(bmp, bmp.width, bmp.height, r, { scale: Math.min(1, 160 / Math.max(bmp.width, bmp.height)) });
          out[f.id] = c.toDataURL('image/jpeg', 0.8);
        } catch {
          /* no thumbnail: the name alone */
        }
      }
      if (!gone) setPreviews(out);
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeKey, first.map((f) => f.id).join(',')]);

  const run = async () => {
    setRunning(true);
    try {
      const r = await startBatch({ file_ids: chosen.filter((f) => !skipped.includes(f)).map((f) => f.id), steps: toSteps(steps, output), output, folder_id: output === 'copies' ? (folder === '' ? null : Number(folder)) : null });
      const skippedServer = r.skipped_files?.length ?? 0;
      const renamedCount = r.renamed?.length ?? 0;
      if (renamedCount) toast('success', `Renamed ${renamedCount} ${renamedCount === 1 ? 'photo' : 'photos'}`);
      if (skippedServer) toast('info', `${skippedServer} skipped: ${r.skipped_files!.slice(0, 3).map((x) => `${x.name} (${x.reason})`).join(', ')}${skippedServer > 3 ? '…' : ''}`);
      if (r.job_id !== null && r.job_id !== undefined) onStarted({ id: r.job_id, label: `${chosen.length} photos`, total: chosen.length - skipped.length - skippedServer });
      else if (!renamedCount) toast('info', 'Nothing to do with those steps.');
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const folders = flatten(treeQ.data?.tree ?? []);
  return (
    <Modal
      title={`Batch edit ${chosen.length} ${chosen.length === 1 ? 'photo' : 'photos'}`}
      width={720}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto max-w-[330px] text-[12px] text-ink-3">Renaming happens now. Pixel changes run as a background job — you can keep working.</span>
          {naming === null ? (
            <Button onClick={() => setNaming('')}>Save as preset</Button>
          ) : (
            <span className="flex gap-1.5">
              <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} aria-label="Preset name" placeholder="Preset name" className={field} />
              <Button disabled={!naming.trim()} onClick={() => void savePreset({ kind: 'batch', name: naming.trim(), scope: 'personal', payload: { steps, output } }).then(() => (toast('success', 'Preset saved'), setNaming(null), void presetsQ.refetch()), (e) => toast('error', errorMessage(e)))}>
                Save
              </Button>
            </span>
          )}
          <Button variant="primary" loading={running} disabled={!toSteps(steps, output).length || chosen.length === skipped.length} onClick={() => void run()}>
            {`Run on ${chosen.length - skipped.length} ${chosen.length - skipped.length === 1 ? 'photo' : 'photos'}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <span className="text-[12.5px] text-ink-3">{folderName}</span>
        {files.length > BATCH_MAX ? <p className="rounded-[10px] bg-warning-bg px-3 py-2 text-warning">{`A batch takes up to ${BATCH_MAX} photos; the first ${BATCH_MAX} of ${files.length} are included.`}</p> : null}
        {presetsQ.data?.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-ink-3">Presets</span>
            {presetsQ.data.map((x) => (
              <button key={x.id} type="button" onClick={() => (setSteps({ ...DEFAULT_STEPS, ...(x.payload.steps as Partial<BatchSteps>) }), x.payload.output === 'copies' || x.payload.output === 'versions' ? setOutput(x.payload.output) : undefined)} className="h-7 rounded-full border border-line px-3 text-[12px] font-semibold hover:bg-subtle">
                {x.name}
              </button>
            ))}
          </div>
        ) : null}
        <span className="text-[11px] font-bold tracking-[0.06em] text-ink-2 uppercase">Steps · run in this order</span>
        <ol className="flex flex-col gap-2">
          {STEP_META.map((m) => {
            const on = steps[m.key].on;
            return (
              <li key={m.key} className="rounded-[12px] border border-line">
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-selection text-primary">
                    <Icon name={m.icon} size={15} />
                  </span>
                  <button type="button" aria-expanded={open === m.key} onClick={() => setOpen(open === m.key ? null : m.key)} className="flex min-w-0 flex-1 flex-col text-left">
                    <b>{m.title}</b>
                    <span className="truncate text-[12px] text-ink-3">{on ? summaryOf(m.key, steps) : 'Off'}</span>
                  </button>
                  <Switch checked={on} label={m.title} onChange={(v) => set(m.key, { on: v } as never)} />
                </div>
                {open === m.key ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5">
                    {m.key === 'resize' ? (
                      <label className="flex items-center gap-2">
                        Longest edge
                        <input type="number" min={64} max={12000} value={steps.resize.longEdge} onChange={(e) => set('resize', { longEdge: Math.max(64, Number(e.target.value) || 64) })} className={cx(field, 'w-24')} />
                        px
                      </label>
                    ) : null}
                    {m.key === 'filter' ? (
                      <>
                        <Select value={steps.filter.name} aria-label="Filter" options={FILTERS.filter((x) => x !== 'none').map((x) => ({ value: x, label: filterLabel(x) }))} onValueChange={(v) => set('filter', { name: v })} className="w-40" />
                        <label className="flex items-center gap-2">
                          Strength
                          <input type="range" min={0} max={100} value={steps.filter.strength} onChange={(e) => set('filter', { strength: Number(e.target.value) })} className="accent-[var(--color-primary)]" />
                          {`${steps.filter.strength}%`}
                        </label>
                      </>
                    ) : null}
                    {m.key === 'watermark' ? (
                      <>
                        <input value={steps.watermark.text} maxLength={120} onChange={(e) => set('watermark', { text: e.target.value })} aria-label="Watermark text" className={cx(field, 'w-48')} />
                        <Select value={String(steps.watermark.pos)} aria-label="Position" options={['Top left', 'Top', 'Top right', 'Left', 'Centre', 'Right', 'Bottom left', 'Bottom', 'Bottom right'].map((l, i) => ({ value: String(i), label: l }))} onValueChange={(v) => set('watermark', { pos: Number(v) })} className="w-36" />
                        <label className="flex items-center gap-2">
                          Opacity
                          <input type="range" min={10} max={100} value={steps.watermark.opacity} onChange={(e) => set('watermark', { opacity: Number(e.target.value) })} className="accent-[var(--color-primary)]" />
                        </label>
                      </>
                    ) : null}
                    {m.key === 'frame' ? (
                      <>
                        <label className="flex items-center gap-2">
                          Size
                          <input type="number" min={1} max={200} value={steps.frame.size} onChange={(e) => set('frame', { size: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} className={cx(field, 'w-20')} />
                          px
                        </label>
                        <input type="color" aria-label="Frame colour" value={steps.frame.colour} onChange={(e) => set('frame', { colour: e.target.value })} />
                      </>
                    ) : null}
                    {m.key === 'convert' && output === 'versions' ? <span className="text-[12px] text-ink-3">New versions keep each file’s own type; choose Copies to convert.</span> : null}
                    {m.key === 'convert' && output === 'copies' ? (
                      <>
                        <Select value={steps.convert.format} aria-label="Format" options={[{ value: 'jpg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} onValueChange={(v) => set('convert', { format: v })} className="w-28" />
                        {steps.convert.format !== 'png' ? (
                          <label className="flex items-center gap-2">
                            Quality
                            <input type="range" min={1} max={100} value={steps.convert.quality} onChange={(e) => set('convert', { quality: Number(e.target.value) })} className="accent-[var(--color-primary)]" />
                            {steps.convert.quality}
                          </label>
                        ) : null}
                      </>
                    ) : null}
                    {m.key === 'rename' ? (
                      <>
                        <input value={steps.rename.pattern} maxLength={120} onChange={(e) => set('rename', { pattern: e.target.value })} aria-label="Rename pattern" className={cx(field, 'w-56')} />
                        <span className="text-[12px] text-ink-3">{`{name} {n} {ext} {date} → ${chosen[0] ? renamed(steps.rename.pattern, chosen[0], 1, chosen.length, new Date(), steps.convert.on ? steps.convert.format : null) : ''}`}</span>
                      </>
                    ) : null}
                    {m.key === 'strip_gps' ? <span className="text-[12px] text-ink-3">The location is taken out of each picture; other camera details stay.</span> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <span className="text-[11px] font-bold tracking-[0.06em] text-ink-2 uppercase">Preview · first {first.length}</span>
        <div className="flex gap-2.5 overflow-x-auto">
          {first.map((f, n) => (
            <figure key={f.id} className="flex w-[104px] shrink-0 flex-col gap-1">
              <span className="flex h-[72px] items-center justify-center overflow-hidden rounded-[8px] bg-subtle">{previews[f.id] ? <img src={previews[f.id]} alt="" className="h-full w-full object-cover" /> : <Icon name="image" size={18} className="text-ink-3" />}</span>
              <figcaption className="truncate font-mono text-[10.5px] text-ink-3">{steps.rename.on ? renamed(steps.rename.pattern, f, n + 1, chosen.length, new Date(), steps.convert.on ? steps.convert.format : null) : f.name}</figcaption>
            </figure>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[11px] font-bold tracking-[0.06em] text-ink-2 uppercase">Save as</span>
          <label className="flex items-center gap-2">
            <input type="radio" name="batch-output" checked={output === 'versions'} onChange={() => setOutput('versions')} className="accent-[var(--color-primary)]" />
            New versions of each file
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="batch-output" checked={output === 'copies'} onChange={() => setOutput('copies')} className="accent-[var(--color-primary)]" />
            Copies in a folder
          </label>
        </div>
        {output === 'copies' ? (
          <div className="flex items-center gap-2">
            <Select value={folder} aria-label="Folder for the copies" options={[{ value: '', label: 'My Drive' }, ...folders.map((f) => ({ value: String(f.id), label: `${'  '.repeat(f.depth)}${f.name}${!f.access || can(f.access, 'add_files') || f.access.owner ? '' : ' — you cannot upload here'}`, disabled: !!f.access && !can(f.access, 'add_files') && !f.access.owner }))]} onValueChange={setFolder} className="w-64" searchable />
          </div>
        ) : null}
        {skipped.length ? (
          <details className="rounded-[10px] bg-warning-bg px-3 py-2 text-warning">
            <summary className="cursor-pointer">{`${skipped.length} ${skipped.length === 1 ? 'photo is' : 'photos are'} skipped — you cannot edit ${skipped.length === 1 ? 'it' : 'them'}`}</summary>
            <ul className="mt-1 list-disc pl-5 text-[12px]">
              {skipped.slice(0, 20).map((f) => (
                <li key={f.id}>{f.name}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <label className="flex items-center gap-2 text-[12px] text-ink-3">
          <Checkbox checked readOnly disabled />
          Files are never enlarged; a step that cannot apply to a file skips it and the job carries on.
        </label>
      </div>
    </Modal>
  );
}

/** The job tray (BAT-05): one running batch, followed until it is done. */
export function BatchTray({ job, onClose }: { job: { id: number | string; label: string; total: number }; onClose: () => void }) {
  const [state, setState] = useState<BatchJob | null>(null);
  const [failures, setFailures] = useState(false);
  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const s = await batchStatus(job.id);
        if (gone) return;
        setState(s);
        if (['done', 'failed', 'cancelled'].includes(s.state)) return;
      } catch {
        /* asked again shortly */
      }
      if (!gone) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => {
      gone = true;
      if (timer) clearTimeout(timer);
    };
  }, [job.id]);
  const total = state?.total ?? job.total;
  const done = (state?.done ?? 0) + (state?.skipped ?? 0) + (state?.failed ?? 0);
  const finished = !!state && ['done', 'failed', 'cancelled'].includes(state.state);
  const left = state?.eta_seconds ? (state.eta_seconds > 90 ? `about ${Math.round(state.eta_seconds / 60)} min left` : 'about a minute left') : null;
  return (
    <div role="status" aria-label="Batch edit" className="w-[360px] rounded-[14px] border border-line bg-surface p-3.5 text-[13px] shadow-xl">
      <div className="flex items-center gap-2">
        <Icon name="layers" size={15} className="text-primary" />
        <b className="flex-1 truncate">{`Batch edit · ${job.label}`}</b>
        <span className="text-[12px] text-ink-3">{`${done} of ${total}`}</span>
        {finished ? (
          <button type="button" aria-label="Close" onClick={onClose} className="text-ink-3 hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
        <span className="block h-full bg-primary transition-[width]" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-3">
        {finished ? (
          <span className="flex-1">{`${state!.state === 'cancelled' ? 'Cancelled' : 'Done'} · ${state!.done} done, ${state!.skipped} skipped, ${state!.failed} failed`}</span>
        ) : (
          <span className="flex-1">{state?.state === 'paused' ? 'Paused' : left ?? 'Working…'}</span>
        )}
        {!finished && state ? (
          <>
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void pauseBatch(job.id, state.state !== 'paused').then(() => setState({ ...state, state: state.state === 'paused' ? 'running' : 'paused' }), (e) => toast('error', errorMessage(e)))}>
              {state.state === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="font-semibold text-danger hover:underline" onClick={() => void cancelBatch(job.id).then(() => setState({ ...state, state: 'cancelled' }), (e) => toast('error', errorMessage(e)))}>
              Cancel
            </button>
          </>
        ) : null}
        {finished && ((state?.failures?.length ?? 0) || (state?.skipped_files?.length ?? 0)) ? (
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setFailures(!failures)}>
            {failures ? 'Hide' : 'What was skipped'}
          </button>
        ) : null}
      </div>
      {failures ? (
        <ul className="mt-2 max-h-40 overflow-y-auto text-[12px]">
          {[...(state?.failures ?? []), ...(state?.skipped_files ?? [])].map((x) => (
            <li key={`${x.file_id}-${x.reason}`} className="flex gap-2 py-0.5">
              <b className="truncate">{x.name}</b>
              <span className="text-ink-3">{x.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
