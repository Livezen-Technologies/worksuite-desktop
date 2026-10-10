import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Menu, type MenuSection } from '../../../components/Menu';
import { Button, Modal, Spinner, cx } from '../../../components/ui';
import { ApiError } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { bytes } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { can, extOf, type DriveFile } from '../api';
import {
  autosaveRecipe,
  deriveImage,
  editorOf,
  listPresets,
  newImage,
  openImage,
  requestEdit,
  restoreVersion,
  saveVersion,
  savePreset,
  sourceUrl,
  staleOf,
  versionBytes,
  versionRecipe,
  type EditorSettings,
  type ImageOpen,
  type ImageVersion,
  type Preset,
  type RailTool,
  type StaleSave,
} from './api';
import { AssetStore, loadBrandFonts, loadLibraries } from './assets';
import { AiPanel } from './AiPanel';
import { CompareView } from './Compare';
import { DarkButton } from './controls';
import { useHistory } from './history';
import { localBytes, localSave, offlineWords, prepareDrag, saveToComputer, startDrag, useLocalImage, useOffline } from './local';
import { AdjustPanel, AreaPanel, CropPanel, DrawPanel, ExportPanel, FiltersPanel, FramesPanel, LayersPanel, MarkPanel, RedactPanel, StickersPanel, TextPanel, type DrawStyle } from './Panels';
import {
  CROP_RATIOS,
  autoSummary,
  blankRecipe,
  checkLimits,
  contentSize,
  isBlank,
  newId,
  outputSize,
  parseRecipe,
  remapObjects,
  serialise,
  workingSize,
  type OverlayObject,
  type Recipe,
  type Rect,
  type TextObject,
} from './recipe';
import { assetKeys, renderRecipe, type Drawable } from './render';
import { SaveDialog, type SaveChoice, type SaveFormat, type SaveOptions } from './SaveDialog';
import { Stage } from './Stage';
import { missingFonts } from './text';

/**
 * The photo editor (Drive ENH-03; P02, P11): a top bar with the file, its version and how saving stands; the tool
 * rail in the SRS's order; the canvas; a 320 px panel for the tool (with Layers and Export beside it); and a strip of
 * the folder's pictures below. It edits a recipe drawn from the untouched original, so every save is a version that
 * reopens as layers.
 *
 * On this computer (DSK-02…07) it opens in the Files tab, edits a synced picture offline and saves it beside the
 * synced copy to go up later, takes pictures dropped from Finder or Explorer as layers, gives the canvas to a drag as
 * a PNG, and works on a proxy above 40 megapixels.
 */

export interface NewImageSpec {
  name: string;
  width: number;
  height: number;
  background: string | null;
  folderId: number | null;
  folderName: string;
}

export interface EditorProps {
  file: DriveFile | null;
  blank?: NewImageSpec | null;
  /** The folder's pictures, for the strip when the server sends no neighbours. */
  folderFiles?: DriveFile[];
  /** Reopen this version's layers instead of the current one's. */
  reopenVersion?: number | null;
  onClose: () => void;
  /** Another picture from the strip. */
  onSwitch: (f: { id: number; name: string }) => void;
  /** A file the editor made (a copy, or a new picture). */
  onCreated?: (fileId: number) => void;
  onOpenConflicts?: () => void;
  onReopenVersion?: (version: number) => void;
}

const RAIL: Array<{ id: RailTool; label: string; icon: string; key?: string }> = [
  { id: 'select', label: 'Select', icon: 'pointer', key: 'V' },
  { id: 'crop', label: 'Crop', icon: 'crop', key: 'C' },
  { id: 'adjust', label: 'Adjust', icon: 'sun' },
  { id: 'filters', label: 'Filters', icon: 'blend' },
  { id: 'area', label: 'Area', icon: 'wand' },
  { id: 'text', label: 'Text', icon: 'type', key: 'T' },
  { id: 'shapes', label: 'Shapes', icon: 'shapes', key: 'K' },
  { id: 'stickers', label: 'Stickers', icon: 'sticker', key: 'S' },
  { id: 'frames', label: 'Frames', icon: 'frame', key: 'F' },
  { id: 'draw', label: 'Draw', icon: 'pen' },
  { id: 'mark', label: 'Mark', icon: 'droplet' },
  { id: 'redact', label: 'Redact', icon: 'square-dashed' },
];

const KEYS: Record<string, RailTool> = { v: 'select', c: 'crop', t: 'text', k: 'shapes', s: 'stickers', f: 'frames' };

interface Picture {
  src: Drawable;
  W: number;
  H: number;
  proxy: boolean;
  /** The full picture's bytes, decoded again at full size to save (proxy only). */
  blob: Blob | null;
}

type Phase = { state: 'idle' } | { state: 'rendering' | 'uploading'; progress: number; what: string } | { state: 'failed'; message: string; retry: SaveOptions } | { state: 'saved'; version: number | null; where: string };

const draftKey = (fileId: number) => `ws.image.draft.${fileId}`;

function readDraft(fileId: number): { head: number; recipe: string; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(draftKey(fileId));
    return raw ? (JSON.parse(raw) as { head: number; recipe: string; savedAt: string }) : null;
  } catch {
    return null;
  }
}

function writeDraft(fileId: number, d: { head: number; recipe: string; savedAt: string } | null): void {
  try {
    if (d) localStorage.setItem(draftKey(fileId), JSON.stringify(d));
    else localStorage.removeItem(draftKey(fileId));
  } catch {
    /* storage full or off: the server's autosave still has it */
  }
}

async function decode(blob: Blob): Promise<{ src: Drawable; W: number; H: number; proxy: boolean }> {
  if (typeof createImageBitmap === 'function') {
    const full = await createImageBitmap(blob);
    const ws = workingSize(full.width, full.height);
    if (!ws.proxy) return { src: full, W: full.width, H: full.height, proxy: false };
    // Over 40 MP: a 4096 px proxy to edit (EDT-E-13), the full picture only when saving.
    const proxy = await createImageBitmap(full, { resizeWidth: ws.w, resizeHeight: ws.h, resizeQuality: 'high' });
    const W = full.width;
    const H = full.height;
    full.close();
    return { src: proxy, W, H, proxy: true };
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { src: img, W: img.naturalWidth || img.width, H: img.naturalHeight || img.height, proxy: false };
}

const clock = (d = new Date()) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function mimeOf(f: SaveFormat): string {
  return f === 'png' ? 'image/png' : f === 'webp' ? 'image/webp' : 'image/jpeg';
}

function toBlob(c: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('The picture could not be drawn.'))), mime, quality));
}

export default function Editor(props: EditorProps) {
  const { file, blank } = props;
  const fileId = file?.id ?? null;
  const qc = useQueryClient();
  const offline = useOffline();
  const { info: local, ready: localReady, refresh: refreshLocal } = useLocalImage(fileId);
  const q = useQuery({ queryKey: ['files', 'image', fileId], queryFn: ({ signal }) => openImage(fileId!, signal), enabled: !!fileId, retry: false, gcTime: 0 });
  const data: ImageOpen | null = q.data ?? null;
  const settings: EditorSettings = useMemo(() => editorOf(data?.editor), [data]);
  const ext = blank ? 'png' : extOf(file?.name ?? '', data?.file.extension ?? file?.extension);

  const history = useHistory(blankRecipe());
  const { recipe, commit, live, settle, undo, redo, canUndo, canRedo, reset } = history;
  const [pic, setPic] = useState<Picture | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [head, setHead] = useState(1);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [opened, setOpened] = useState<Recipe>(blankRecipe());
  const [saved, setSaved] = useState<string>(JSON.stringify(blankRecipe()));
  const [tool, setTool] = useState<RailTool>('adjust');
  const [tab, setTab] = useState<'tool' | 'layers' | 'export'>('tool');
  const [selected, setSelected] = useState<string[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [fitScale, setFitScale] = useState(1);
  const [compare, setCompare] = useState<'off' | 'peek' | 'split'>('off');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [unsavedUrl, setUnsavedUrl] = useState<string | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [cropRatio, setCropRatio] = useState<{ id: string; value: number | null }>({ id: 'free', value: null });
  const [grid, setGrid] = useState(false);
  const [drawStyle, setDrawStyle] = useState<DrawStyle>({ colour: '#E5484D', width: 8, highlighter: false, erase: false });
  const [dialog, setDialog] = useState<{ initial: SaveChoice; stale: StaleSave | null } | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ then: () => void } | null>(null);
  const [saveMenu, setSaveMenu] = useState(false);
  const [aiPreview, setAiPreview] = useState<Recipe | null>(null);
  const [aiCrops, setAiCrops] = useState<Rect[]>([]);
  const [shortcuts, setShortcuts] = useState(false);
  const [assetsRev, setAssetsRev] = useState(0);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const dragToken = useRef<string | null>(null);
  const lastAutosaved = useRef<string>('');
  const originalRecipe = useRef<string | null>(null);
  const recipeRef = useRef(recipe);
  useEffect(() => {
    recipeRef.current = recipe;
  });

  // ── libraries, presets, fonts ──────────────────────────────────────────
  const libsQ = useQuery({ queryKey: ['files', 'image-libraries'], queryFn: ({ signal }) => loadLibraries(signal), staleTime: 5 * 60_000 });
  const libraries = useMemo(() => libsQ.data?.libraries ?? { stickers: [], frames: [], fonts: [], logos: [] }, [libsQ.data]);
  const fontsQ = useQuery({ queryKey: ['files', 'image-fonts', libraries.fonts.map((f) => `${f.file_id}:${f.version}`).join(',')], queryFn: () => loadBrandFonts(libraries.fonts), enabled: libraries.fonts.length > 0, staleTime: Infinity });
  const brandFonts = fontsQ.data ?? [];
  const presetsQ = useQuery({
    queryKey: ['files', 'image-presets'],
    queryFn: async () => {
      const [filter, text, watermark] = await Promise.all((['filter', 'text', 'watermark'] as const).map((k) => listPresets(k).catch(() => [] as Preset[])));
      return { filter: filter!, text: text!, watermark: watermark! };
    },
    staleTime: 5 * 60_000,
    enabled: !offline,
  });
  const presets = presetsQ.data ?? { filter: [], text: [], watermark: [] };
  const [assets] = useState(() => new AssetStore(() => setAssetsRev((n) => n + 1)));
  useEffect(() => {
    assets.readData((id) => {
      const o = recipeRef.current.objects.find((x) => x.id === id);
      return o?.kind === 'image' ? o.data : null;
    });
  }, [assets]);
  useEffect(() => assets.setLibraries(libraries), [assets, libraries]);

  // ── opening the picture and its recipe ─────────────────────────────────
  const [attempt, setAttempt] = useState(0);
  // Opened once per file (a save that makes a new version keeps the editor as it is), again on Try again.
  const openKey = blank ? `new:${blank.width}x${blank.height}` : `${fileId}:${!!data}:${q.isError}:${q.isError ? String(local?.synced ?? '') : ''}:${props.reopenVersion ?? ''}:${attempt}`;
  const loaded = useRef<string>('');
  useEffect(() => {
    if (loaded.current === openKey) return;
    if (!blank && !data && !q.isError) return;
    if (!blank && q.isError && !localReady) return;
    loaded.current = openKey;
    let gone = false;
    void (async () => {
      setLoadError(null);
      try {
        if (blank) {
          const c = document.createElement('canvas');
          c.width = blank.width;
          c.height = blank.height;
          const ctx = c.getContext('2d');
          if (ctx && blank.background) {
            ctx.fillStyle = blank.background;
            ctx.fillRect(0, 0, c.width, c.height);
          }
          setPic({ src: c, W: blank.width, H: blank.height, proxy: false, blob: null });
          reset(blankRecipe(null));
          setSaved(JSON.stringify(blankRecipe(null)));
          setTool('text');
          return;
        }
        if (!data) {
          // Offline: the synced copy here, as it is.
          if (!local?.synced || !fileId) throw new Error(q.error ? errorMessage(q.error) : 'The picture could not be loaded.');
          const blob = await localBytes(fileId);
          const d = await decode(blob);
          if (gone) return;
          setPic({ ...d, blob: d.proxy ? blob : null });
          setHead(local.version ?? file?.version ?? 1);
          setBaseVersion(local.version ?? null);
          const draft = readDraft(fileId);
          const parsed = draft && draft.head === local.version ? parseRecipe(draft.recipe) : null;
          const r = parsed?.kind === 'ok' && parsed.recipe.base_version === local.version ? parsed.recipe : blankRecipe(local.version ?? null);
          reset(r);
          setOpened(blankRecipe(local.version ?? null));
          setSaved(JSON.stringify(blankRecipe(local.version ?? null)));
          setNotice(parsed?.kind === 'ok' && r !== parsed.recipe ? null : draft && parsed?.kind === 'ok' ? `Restored unsaved edits from ${clock(new Date(draft.savedAt))}` : 'Offline: editing the synced copy on this computer.');
          return;
        }
        const version = data.file.version;
        setHead(version);
        // Which recipe: a version asked for, else the current version's.
        let stored = data.recipe;
        if (props.reopenVersion && props.reopenVersion !== version) stored = (await versionRecipe(data.file.id, props.reopenVersion)).recipe;
        const parsed = stored ? parseRecipe(stored.recipe) : null;
        let next = blankRecipe(version);
        let base = version;
        let note: string | null = null;
        let restoredDraft = false;
        if (parsed?.kind === 'ok') {
          next = parsed.recipe;
          // Schema 1 was saved with the version it made, from the one before it.
          const v = stored!.version;
          base = parsed.recipe.base_version ?? (parsed.schema === 1 ? Math.max(1, v - 1) : v);
          if (!data.versions.some((x) => x.version === base) && base !== version) base = version;
          if (base === version && parsed.schema === 1 && v === version) {
            // The base is gone from the history: open the picture as it is.
            next = blankRecipe(version);
          }
          next = { ...next, base_version: base };
          restoredDraft = !!parsed.recipe.draft;
          note = restoredDraft ? `Restored unsaved edits from ${clock(new Date(parsed.recipe.draft!.saved_at))}` : stored!.version !== version ? `Reopened v${stored!.version}’s layers.` : null;
        } else if (parsed?.kind === 'foreign' || parsed?.kind === 'bad') note = parsed.reason;
        // A newer draft on this computer wins (it may never have reached the server).
        const draft = readDraft(data.file.id);
        if (draft && draft.head === version && (!parsed || parsed.kind !== 'ok' || !parsed.recipe.draft || draft.savedAt > parsed.recipe.draft.saved_at)) {
          const dp = parseRecipe(draft.recipe);
          if (dp.kind === 'ok' && (dp.recipe.base_version === version || data.versions.some((x) => x.version === dp.recipe.base_version))) {
            next = dp.recipe;
            base = dp.recipe.base_version ?? version;
            restoredDraft = true;
            note = `Restored unsaved edits from ${clock(new Date(draft.savedAt))}`;
          }
        }
        originalRecipe.current = data.recipe?.recipe ?? null;
        // The pixels the recipe is drawn on.
        let blob: Blob;
        const row = data.versions.find((x) => x.version === base);
        if (base !== version && row) blob = await versionBytes(data.file.id, row.id);
        else {
          const src = sourceUrl(data.source);
          if (!src) throw new Error(data.needs ? 'This picture needs a viewable copy before it can be edited.' : 'The picture could not be loaded.');
          const res = await fetch(src, { cache: 'no-store' });
          if (!res.ok) throw new Error('The picture could not be loaded.');
          blob = await res.blob();
        }
        const d = await decode(blob);
        if (gone) return;
        setPic({ ...d, blob: d.proxy ? blob : null });
        setBaseVersion(base);
        const { draft: _draft, ...clean } = next;
        reset(clean);
        const openedRecipe = restoredDraft ? blankRecipe(base) : clean;
        setOpened(base === version ? blankRecipe(base) : openedRecipe);
        setSaved(restoredDraft ? JSON.stringify(openedRecipe) : JSON.stringify(clean));
        lastAutosaved.current = JSON.stringify(clean);
        const notes = [note, d.proxy ? `A large picture: you are editing a ${Math.max(d.src.width, d.src.height)} px preview; it is saved full size.` : null, data.image?.frames && data.image.frames > 1 ? 'Only the first frame of this animation is edited.' : data.image?.pages && data.image.pages > 1 ? 'Only the first page of this file is edited.' : null].filter(Boolean);
        setNotice(notes.length ? notes.join(' ') : null);
      } catch (e) {
        if (!gone) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  // ── what can be done ───────────────────────────────────────────────────
  const access = file?.access;
  const canEditFile = !!data?.editable && (data?.can?.edit ?? can(access, 'upload_version'));
  const editReason = !data ? null : (data.edit_reason ?? (!data.editable ? `A ${ext.toUpperCase()} is saved as a copy (PNG).` : !canEditFile ? 'You have View access only.' : null));
  const canCopy = data?.can?.download ?? can(access, 'download');
  const isNew = !!blank;
  const content = pic ? contentSize(pic.W, pic.H, recipe) : { w: 0, h: 0 };
  const out = pic ? outputSize(pic.W, pic.H, recipe) : { w: 0, h: 0 };
  const dirty = JSON.stringify(recipe) !== saved;
  const aiOn = settings.ai?.available === true;
  const rail = RAIL.filter((r) => settings.tools?.[r.id] !== false);
  const localWords = offlineWords(local, offline, head);
  const missing = missingFonts(recipe.objects.filter((o): o is TextObject => o.kind === 'text').map((o) => o.font), brandFonts);

  // ── autosave (EDT-E-10) ────────────────────────────────────────────────
  const autosave = useCallback(() => {
    const r = recipeRef.current;
    const text = JSON.stringify(r);
    if (!fileId || !dirty || text === lastAutosaved.current || isBlank(r)) return;
    lastAutosaved.current = text;
    const at = new Date().toISOString();
    const json = serialise(r, baseVersion, at);
    writeDraft(fileId, { head, recipe: json, savedAt: at });
    setAutosavedAt(clock());
    if (!offline && pic) void autosaveRecipe(fileId, json, autoSummary(r), pic.W, pic.H).catch(() => undefined);
  }, [fileId, dirty, baseVersion, head, offline, pic]);
  useEffect(() => {
    const id = setInterval(autosave, 30_000);
    const hide = () => document.visibilityState === 'hidden' && autosave();
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [autosave]);

  // ── rendering the full picture ─────────────────────────────────────────
  const renderFull = async (r: Recipe, format: SaveFormat, quality: number, longEdge: number | null = null): Promise<Blob> => {
    if (!pic) throw new Error('The picture is not loaded yet.');
    setPhase({ state: 'rendering', progress: 0, what: 'Drawing the picture' });
    await assets.ensure(assetKeys(r));
    if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
    let src: Drawable = pic.src;
    if (pic.proxy && pic.blob && typeof createImageBitmap === 'function') src = await createImageBitmap(pic.blob);
    const o = outputSize(pic.W, pic.H, r);
    const scale = longEdge && Math.max(o.w, o.h) > longEdge ? longEdge / Math.max(o.w, o.h) : 1;
    let c = renderRecipe(src, pic.W, pic.H, r, { scale, assets, onProgress: (f) => setPhase({ state: 'rendering', progress: f * 0.9, what: 'Drawing the picture' }) });
    if (src !== pic.src && 'close' in src && typeof src.close === 'function') src.close();
    if (format === 'jpg' && r.corners > 0) {
      const flat = document.createElement('canvas');
      flat.width = c.width;
      flat.height = c.height;
      const ctx = flat.getContext('2d')!;
      ctx.fillStyle = r.corners_fill ?? r.frame?.colour ?? '#FFFFFF';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(c, 0, 0);
      c = flat;
    }
    const blob = await toBlob(c, mimeOf(format), quality / 100);
    setPhase({ state: 'rendering', progress: 1, what: 'Drawing the picture' });
    return blob;
  };

  const estimate = async (format: SaveFormat, quality: number): Promise<number> => {
    if (!pic) return 0;
    const o = outputSize(pic.W, pic.H, recipe);
    const scale = Math.min(1, 640 / Math.max(o.w, o.h));
    const c = renderRecipe(pic.src, pic.W, pic.H, recipe, { scale, assets });
    const b = await toBlob(c, mimeOf(format), quality / 100);
    return Math.round((b.size * (o.w * o.h)) / Math.max(1, c.width * c.height));
  };

  // ── saving (SAV-01…13, DSK-02) ─────────────────────────────────────────
  const save = async (o: SaveOptions, againstHead = head) => {
    setDialog(null);
    try {
      const blob = await renderFull(recipe, o.format, o.quality);
      const recipeText = o.keepLayers && o.choice !== 'download' ? serialise({ ...recipe, base_version: baseVersion }, baseVersion) : null;
      const limit = checkLimits(blob.size, recipeText ? new Blob([recipeText]).size : 0, out, settings.limits);
      if (limit) throw new Error(limit);
      const summary = autoSummary(recipe);
      if (o.choice === 'download') {
        const r = await saveToComputer(o.name, new Uint8Array(await blob.arrayBuffer()));
        setPhase(r ? { state: 'saved', version: null, where: `Saved to ${r.name}` } : { state: 'idle' });
        return;
      }
      // Offline, a synced picture is saved here and goes up with its layers when sync next can (DSK-02).
      if ((offline || q.isError) && fileId && local?.synced) {
        setPhase({ state: 'uploading', progress: 0.95, what: 'Saving on this computer' });
        const r = await localSave({ fileId, bytes: new Uint8Array(await blob.arrayBuffer()), recipe: recipeText ?? serialise({ ...recipe, base_version: baseVersion }, baseVersion), summary, note: o.note || summary, width: out.w, height: out.h, copyName: o.choice === 'copy' ? o.name : null });
        setSaved(JSON.stringify(recipe));
        writeDraft(fileId, null);
        refreshLocal();
        setPhase({ state: 'saved', version: o.choice === 'version' ? r.willBe : null, where: o.choice === 'version' ? `Offline · will upload as v${r.willBe}` : `Saved “${r.name}” here · will upload` });
        return;
      }
      const progress = (f: number) => setPhase({ state: 'uploading', progress: f, what: 'Uploading' });
      if (o.choice === 'version' && fileId && !isNew) {
        const r = await saveVersion(fileId, { blob, fileName: file?.name ?? 'picture', recipe: recipeText, summary, note: o.note || summary, baseVersion: againstHead, stripGps: o.stripGps, notify: o.notify, aiApplied: recipe.ai_steps.length > 0 }, progress);
        setHead(r.version);
        setSaved(JSON.stringify(recipe));
        writeDraft(fileId, null);
        lastAutosaved.current = JSON.stringify(recipe);
        originalRecipe.current = null;
        setPhase({ state: 'saved', version: r.version, where: `Saved as v${r.version}` });
        void qc.invalidateQueries({ queryKey: ['files'] });
        return;
      }
      // A copy, or a new picture's first save.
      if (isNew && blank) {
        const made = await newImage({ folder_id: o.folderId, name: o.name, width: out.w, height: out.h, background: blank.background ?? 'transparent' });
        const r = await saveVersion(made.file_id, { blob, fileName: made.name, recipe: recipeText, summary, note: o.note || summary, baseVersion: made.version ?? 1, stripGps: o.stripGps, notify: false }, progress);
        setSaved(JSON.stringify(recipe));
        setPhase({ state: 'saved', version: r.version, where: `Saved “${made.name}”` });
        void qc.invalidateQueries({ queryKey: ['files'] });
        props.onCreated?.(made.file_id);
        return;
      }
      const r = await deriveImage({ blob, sourceId: fileId, name: o.name, folderId: o.folderId, format: o.format, quality: o.quality, stripGps: o.stripGps, recipe: recipeText, summary }, progress);
      setSaved(JSON.stringify(recipe));
      setPhase({ state: 'saved', version: null, where: `Saved “${r.name}” as a copy` });
      toast('success', `Saved “${r.name}”`, props.onCreated ? { label: 'Open', run: () => props.onCreated!(r.file_id) } : undefined);
      void qc.invalidateQueries({ queryKey: ['files'] });
    } catch (e) {
      const stale = staleOf(e);
      if (stale) {
        setPhase({ state: 'idle' });
        setDialog({ initial: 'version', stale });
        return;
      }
      setPhase({ state: 'failed', message: e instanceof ApiError && e.offline ? 'You are offline. Your edit is still here, and autosaved.' : errorMessage(e), retry: o });
    }
  };

  const stale = dialog?.stale ?? null;
  const exportCopy = async (format: SaveFormat, quality: number, longEdge: number | null) => {
    try {
      const blob = await renderFull(recipe, format, quality, longEdge);
      const name = `${(file?.name ?? blank?.name ?? 'Picture').replace(/\.[^.]+$/, '')}.${format}`;
      const r = await saveToComputer(name, new Uint8Array(await blob.arrayBuffer()));
      setPhase(r ? { state: 'saved', version: null, where: `Saved to ${r.name}` } : { state: 'idle' });
    } catch (e) {
      setPhase({ state: 'idle' });
      toast('error', errorMessage(e));
    }
  };

  // ── leaving ────────────────────────────────────────────────────────────
  const discardDraft = () => {
    if (!fileId) return;
    writeDraft(fileId, null);
    // The server's copy of the draft goes back to what the version was saved with.
    if (lastAutosaved.current && originalRecipe.current !== null && !offline && pic) void autosaveRecipe(fileId, originalRecipe.current, '', pic.W, pic.H).catch(() => undefined);
  };
  const guard = (then: () => void) => {
    if (dirty && phase.state !== 'saved') setAsking({ then });
    else then();
  };
  const close = () => guard(() => (discardDraft(), props.onClose()));

  // ── layers ─────────────────────────────────────────────────────────────
  const addObject = (o: OverlayObject) => {
    commit({ ...recipe, objects: [...recipe.objects, o] });
    setSelected([o.id]);
  };
  const dropFiles = async (files: File[], at: { x: number; y: number }) => {
    for (const f of files.slice(0, 4)) {
      try {
        const bmp = typeof createImageBitmap === 'function' ? await createImageBitmap(f) : null;
        if (!bmp) continue;
        const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * k));
        c.height = Math.max(1, Math.round(bmp.height * k));
        c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/webp', 0.9);
        const w = Math.min(0.5, 0.35);
        const h = (w * content.w * (bmp.height / bmp.width)) / content.h;
        const id = newId('i');
        assets.put(`data:${id}`, c);
        addObject({ id, kind: 'image', data, name: f.name, x: Math.max(0, Math.min(1 - w, at.x - w / 2)), y: Math.max(0, Math.min(1 - h, at.y - h / 2)), w, h, rotation: 0, opacity: 1, shadow: { on: false, blur: 14, dx: 0, dy: 4, colour: '#000000', opacity: 40 } });
      } catch {
        toast('error', `${f.name} could not be read as a picture.`);
      }
    }
  };

  // ── crop ───────────────────────────────────────────────────────────────
  const chooseTool = (t: RailTool) => {
    settle();
    if (t === 'crop') {
      setCropDraft(recipe.crop ?? { x: 0, y: 0, w: 1, h: 1 });
      const known = CROP_RATIOS.find((c) => c.id === recipe.crop_ratio);
      setCropRatio({ id: recipe.crop_ratio ?? 'free', value: known?.ratio ?? null });
    }
    if (t !== 'ai') {
      setAiPreview(null);
      setAiCrops([]);
    }
    setTool(t);
    setTab('tool');
    setEditingText(null);
  };
  const applyCrop = () => {
    const d = cropDraft ?? { x: 0, y: 0, w: 1, h: 1 };
    const full = d.x <= 0.0005 && d.y <= 0.0005 && d.w >= 0.999 && d.h >= 0.999;
    const crop = full ? null : d;
    commit({ ...recipe, crop, crop_ratio: crop ? cropRatio.id : null, resize: null, objects: remapObjects(recipe.objects, recipe.crop, crop) });
    setTool('select');
  };

  // ── keys (EDT-E-12) ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y' && !typing) {
        e.preventDefault();
        redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        setDialog({ initial: e.shiftKey ? 'copy' : canEditFile ? 'version' : 'copy', stale: null });
      } else if (typing || mod || e.altKey) return;
      else if (e.key === 'Escape') {
        e.preventDefault();
        if (selected.length) setSelected([]);
        else if (compare !== 'off') setCompare('off');
        else close();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault();
        commit({ ...recipe, objects: recipe.objects.filter((o) => !selected.includes(o.id) || o.locked) });
        setSelected([]);
      } else if (e.key.startsWith('Arrow') && selected.length) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) / Math.max(1, Math.min(content.w, content.h));
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        live({ ...recipe, objects: recipe.objects.map((o) => (selected.includes(o.id) && !o.locked ? { ...o, x: o.x + dx, y: o.y + dy } : o)) });
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcuts(true);
      } else if (KEYS[k] && rail.some((r) => r.id === KEYS[k])) {
        e.preventDefault();
        chooseTool(KEYS[k]!);
      } else if (k === '+' || k === '=') setZoom(Math.min(16, (zoom === 'fit' ? fitScale : zoom) * 1.25));
      else if (k === '-') setZoom(Math.max(0.05, (zoom === 'fit' ? fitScale : zoom) / 1.25));
      else if (k === '0') setZoom('fit');
      else if (k === '1') setZoom(1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ── the strip ──────────────────────────────────────────────────────────
  const strip = (data?.neighbours?.length ? data.neighbours.map((n) => ({ id: n.id, name: n.name, url: sourceUrl(n.url), edited: n.edited ? (n.version ?? null) : null })) : (props.folderFiles ?? []).map((f) => ({ id: f.id, name: f.name, url: null as string | null, edited: null as number | null }))).slice(0, 60);
  const position = fileId ? strip.findIndex((s) => s.id === fileId) : -1;

  // ── the drag out (DSK-05) ──────────────────────────────────────────────
  const prepareOut = async () => {
    dragToken.current = null;
    try {
      if (!pic) return;
      const o = outputSize(pic.W, pic.H, recipe);
      const c = renderRecipe(pic.src, pic.W, pic.H, recipe, { scale: Math.min(1, 4096 / Math.max(o.w, o.h)), assets });
      dragToken.current = await prepareDrag(await toBlob(c, 'image/png', 1), file?.name ?? blank?.name ?? 'Picture');
    } catch {
      dragToken.current = null;
    }
  };

  // ── compare versions (SAV-09) ──────────────────────────────────────────
  const openVersions = async () => {
    if (!pic || !data) return;
    try {
      const c = renderRecipe(pic.src, pic.W, pic.H, recipe, { scale: Math.min(1, 1600 / Math.max(out.w, out.h)), assets });
      const b = await toBlob(c, 'image/jpeg', 0.9);
      setUnsavedUrl((old) => (old && URL.revokeObjectURL(old), dirty ? URL.createObjectURL(b) : null));
    } catch {
      setUnsavedUrl(null);
    }
    setVersionsOpen(true);
  };

  const statusText = phase.state === 'rendering' || phase.state === 'uploading' ? `${phase.what}… ${Math.round(phase.progress * 100)}%` : phase.state === 'failed' ? phase.message : phase.state === 'saved' && !dirty ? phase.where : localWords && (offline || local?.pending) ? localWords : dirty ? `Unsaved changes${autosavedAt ? ` · recipe autosaved ${autosavedAt}` : ''}` : '';

  const saveSections: MenuSection[] = [
    {
      id: 'save',
      items: [
        { id: 'version', label: 'Save as new version', icon: 'history', disabled: !canEditFile || isNew, reason: editReason ?? undefined, onSelect: () => setDialog({ initial: 'version', stale: null }), shortcut: '⌘S' },
        { id: 'copy', label: isNew ? 'Save to Drive' : 'Save as copy', icon: 'copy', disabled: !canCopy && !isNew, onSelect: () => setDialog({ initial: 'copy', stale: null }), shortcut: '⇧⌘S' },
        { id: 'download', label: 'Download', icon: 'download', onSelect: () => setDialog({ initial: 'download', stale: null }) },
      ],
    },
    ...(data && data.versions.length > 1 ? [{ id: 'more', items: [{ id: 'versions', label: 'Compare versions…', icon: 'layout-side', onSelect: () => void openVersions() }] }] : []),
  ];

  const shownRecipe = aiPreview ?? recipe;
  const name = file?.name ?? blank?.name ?? 'New picture';
  const folderPath = data?.file.folder_path ?? file?.folder_path ?? null;
  const folderLabel = folderPath ? folderPath.replace(/\//g, ' › ') : (file?.folder_name || blank?.folderName || 'My Drive');
  const panelProps = { recipe, commit, live, settle, W: pic?.W ?? 1, H: pic?.H ?? 1, src: pic?.src ?? null, ext, selected, onSelect: setSelected };
  const toolLabel = tool === 'ai' ? 'AI' : (RAIL.find((r) => r.id === tool)?.label ?? 'Tool');
  const busy = phase.state === 'rendering' || phase.state === 'uploading';

  return (
    <div role="region" aria-label={`Photo editor — ${name}`} className="no-drag absolute inset-0 z-30 flex flex-col bg-[#0B1120] text-[13px] text-[#E6ECFA]">
      {/* ── top bar (EDT-E-02) ── */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[#1E2A4A] bg-[#0F1629] px-3.5">
        <button type="button" aria-label="Back" onClick={close} className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-[#2A3A66] hover:bg-white/10">
          <Icon name="chevron-left" size={17} />
        </button>
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#E8E4FF] text-[9.5px] font-extrabold text-[#5B3FD9]">{(ext || 'img').slice(0, 4).toUpperCase()}</span>
        <div className="flex min-w-0 flex-col leading-tight">
          <b className="truncate text-[14px] text-white">{name}</b>
          <span className="truncate text-[11.5px] text-[#AFC0E8]">{folderLabel}</span>
        </div>
        {!isNew ? (
          <button type="button" title="Compare versions" aria-label={`Version ${head} · compare versions`} onClick={() => void openVersions()} disabled={!data || data.versions.length < 2} className="rounded-[8px] bg-[#1E2A4A] px-2 py-0.5 text-[12px] font-bold text-white disabled:cursor-default">
            {`v${head}`}
          </button>
        ) : null}
        {statusText ? (
          <span role="status" className={cx('flex min-w-0 items-center gap-1.5 truncate text-[12.5px]', phase.state === 'failed' ? 'text-[#FFB4A3]' : 'text-[#C9D4FF]')}>
            <span className={cx('h-2 w-2 shrink-0 rounded-full', phase.state === 'failed' ? 'bg-[#FF6B6B]' : phase.state === 'saved' && !dirty ? 'bg-[#3DD68C]' : 'bg-[#F59E0B]')} />
            <span className="truncate">{statusText}</span>
            {phase.state === 'failed' ? (
              <button type="button" onClick={() => void save(phase.retry)} className="font-bold text-white underline">
                Retry
              </button>
            ) : null}
            {local?.pending?.state === 'conflict' && props.onOpenConflicts ? (
              <button type="button" onClick={props.onOpenConflicts} className="font-bold text-white underline">
                Sync conflicts
              </button>
            ) : null}
          </span>
        ) : null}
        {busy ? (
          <span aria-hidden className="h-1.5 w-28 overflow-hidden rounded-full bg-[#1E2A4A]">
            <span className="block h-full bg-[#5B7BFF]" style={{ width: `${Math.round((phase.state === 'rendering' || phase.state === 'uploading' ? phase.progress : 0) * 100)}%` }} />
          </span>
        ) : null}
        <span className="flex-1" />
        <DarkButton aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo} icon={<Icon name="undo-edit" size={15} />}>
          {''}
        </DarkButton>
        <DarkButton aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo} icon={<Icon name="redo-edit" size={15} />}>
          {''}
        </DarkButton>
        <button
          type="button"
          aria-pressed={compare !== 'off'}
          disabled={!pic}
          title="Hold to see the opened picture; click to pin a before/after split"
          onPointerDown={() => compare === 'off' && setCompare('peek')}
          onPointerUp={() => setCompare((c) => (c === 'peek' ? 'split' : 'off'))}
          onPointerLeave={() => setCompare((c) => (c === 'peek' ? 'off' : c))}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setCompare((c) => (c === 'off' ? 'split' : 'off')))}
          className={cx('inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border px-3 font-semibold disabled:opacity-40', compare !== 'off' ? 'border-[#5B7BFF] bg-[#1A2650] text-white' : 'border-[#2A3A66] hover:bg-white/10')}
        >
          <Icon name="split-square" size={15} />
          Compare
        </button>
        <DarkButton onClick={close}>Cancel</DarkButton>
        <div className="flex">
          <button type="button" disabled={!pic || busy} onClick={() => setDialog({ initial: canEditFile && !isNew ? 'version' : 'copy', stale: null })} className="h-[34px] rounded-l-[9px] bg-[#3B5BDB] px-3.5 font-bold text-white hover:bg-[#4C6EF5] disabled:opacity-40">
            Save to Drive
          </button>
          <button ref={saveBtn} type="button" aria-label="More ways to save" aria-haspopup="menu" aria-expanded={saveMenu} disabled={!pic || busy} onClick={() => setSaveMenu(true)} className="h-[34px] rounded-r-[9px] border-l border-[#2F4AC0] bg-[#3B5BDB] px-2 text-white hover:bg-[#4C6EF5] disabled:opacity-40">
            <Icon name="chevron-down" size={15} />
          </button>
        </div>
        {saveMenu ? <Menu sections={saveSections} label="Save" anchor={saveBtn} prefer="bottom" align="end" onClose={() => setSaveMenu(false)} width={260} /> : null}
      </div>
      {notice ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#1E2A4A] bg-[#121B33] px-4 py-2 text-[12.5px] text-[#C9D4FF]">
          <Icon name="info" size={14} />
          <span className="flex-1">{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-[#8C9BC0] hover:text-white">
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : null}
      {versionsOpen && data && fileId ? (
        <CompareView
          fileId={fileId}
          versions={data.versions}
          current={head}
          unsaved={unsavedUrl ? { url: unsavedUrl, label: 'Your unsaved edit' } : null}
          canRestore={canEditFile && (data.can?.restore ?? true)}
          onClose={() => setVersionsOpen(false)}
          onReopen={(v: ImageVersion) => guard(() => (setVersionsOpen(false), props.onReopenVersion?.(v.version)))}
          onRestore={(v: ImageVersion) =>
            void restoreVersion(fileId, v.id).then(
              () => (toast('success', `v${v.version} restored as a new version`), setVersionsOpen(false), void qc.invalidateQueries({ queryKey: ['files'] })),
              (e) => toast('error', errorMessage(e)),
            )
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* ── the rail (EDT-E-03) ── */}
          <nav aria-label="Tools" className="flex w-[68px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-[#1E2A4A] bg-[#0F1629] py-2.5 scroll-thin">
            {rail.map((r) => (
              <button key={r.id} type="button" aria-pressed={tool === r.id} aria-keyshortcuts={r.key} title={r.id === 'redact' ? 'Redact — destroys the pixels underneath; it cannot be removed after saving' : r.key ? `${r.label} (${r.key})` : r.label} onClick={() => chooseTool(r.id)} className={cx('flex h-[50px] w-[54px] shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] text-[10.5px] font-bold', tool === r.id ? 'border border-[#5B7BFF] bg-[#1A2650] text-white' : 'text-[#AFC0E8] hover:bg-white/5 hover:text-white')}>
                <Icon name={r.icon} size={17} />
                {r.label}
              </button>
            ))}
            <span className="flex-1" />
            {aiOn ? (
              <button type="button" aria-pressed={tool === 'ai'} onClick={() => chooseTool('ai')} className={cx('flex h-[50px] w-[54px] shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] text-[10.5px] font-bold', tool === 'ai' ? 'border border-[#5B7BFF] bg-[#1A2650] text-white' : 'text-[#AFC6FF] hover:bg-white/5')}>
                <Icon name="sparkles" size={17} />
                AI
              </button>
            ) : null}
          </nav>
          {/* ── the canvas and the strip (EDT-E-05) ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            {loadError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <Icon name="image-off" size={36} className="text-[#5E6B8C]" />
                <span className="text-[#FFB4A3]">{loadError}</span>
                <DarkButton onClick={() => (setAttempt((n) => n + 1), void q.refetch())}>Try again</DarkButton>
              </div>
            ) : !pic ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner label="Opening the picture…" />
              </div>
            ) : (
              <Stage
                src={pic.src}
                W={pic.W}
                H={pic.H}
                recipe={shownRecipe}
                before={opened}
                compare={compare}
                tool={tool}
                assets={assets}
                assetsRev={assetsRev}
                zoom={zoom}
                onFitScale={setFitScale}
                selected={selected}
                onSelect={setSelected}
                onLive={live}
                onSettle={settle}
                cropDraft={cropDraft}
                cropRatio={cropRatio.value}
                onCropDraft={setCropDraft}
                showGrid={grid}
                onAreaPick={(pt, add) => commit({ ...recipe, area: { seeds: add && recipe.area ? [...recipe.area.seeds, pt].slice(-64) : [pt], tolerance: recipe.area?.tolerance ?? 32 } })}
                onRedact={(r) => commit({ ...recipe, redactions: [...recipe.redactions, r] })}
                draw={tool === 'draw' ? drawStyle : null}
                onStroke={(pts) => {
                  const xs = pts.filter((_, i) => i % 2 === 0);
                  const ys = pts.filter((_, i) => i % 2 === 1);
                  const x = Math.min(...xs);
                  const y = Math.min(...ys);
                  addObject({ id: newId('d'), kind: 'shape', shape: 'path', points: pts, highlighter: drawStyle.highlighter, x, y, w: Math.max(0.005, Math.max(...xs) - x), h: Math.max(0.005, Math.max(...ys) - y), rotation: 0, opacity: drawStyle.highlighter ? 0.45 : 1, fill: { style: 'outline', colour: drawStyle.colour, colour2: drawStyle.colour, angle: 0 }, stroke: { width: (drawStyle.width / Math.max(1, content.h)) * 1000, colour: drawStyle.colour, dash: 'solid' }, radius: 0 });
                  setSelected([]);
                }}
                onErase={(id) => commit({ ...recipe, objects: recipe.objects.filter((o) => o.id !== id) })}
                editingText={editingText}
                onEditText={setEditingText}
                onDropFiles={(f, at) => void dropFiles(f, at)}
                badge={aiPreview ? 'Preview — not applied' : null}
                suggestions={tool === 'ai' ? aiCrops : []}
                onUseSuggestion={(r) => {
                  commit({ ...recipe, crop: r, crop_ratio: null, objects: remapObjects(recipe.objects, recipe.crop, r), ai_steps: [...recipe.ai_steps, { action: 'crop', provider: settings.ai?.provider_label ?? null, at: new Date().toISOString(), summary: 'Suggested crop' }] });
                  setAiCrops([]);
                }}
              />
            )}
            <div className="flex h-[64px] shrink-0 items-center gap-2 border-t border-[#1E2A4A] bg-[#0F1629] px-3">
              <div role="list" aria-label="Pictures in this folder" className="flex min-w-0 max-w-[45%] items-center gap-1.5 overflow-x-auto scroll-thin">
                {strip.map((s) => (
                  <button key={s.id} type="button" role="listitem" aria-current={s.id === fileId ? 'true' : undefined} title={s.name} onClick={() => s.id !== fileId && guard(() => (discardDraft(), props.onSwitch({ id: s.id, name: s.name })))} className={cx('relative h-[44px] w-[56px] shrink-0 overflow-hidden rounded-[6px] bg-[#1A2440]', s.id === fileId ? 'outline-2 outline-offset-1 outline-[#7FA2FF]' : 'opacity-70 hover:opacity-100')}>
                    {s.url ? <img src={s.url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Icon name="image" size={16} className="m-auto text-[#5E6B8C]" />}
                    {s.edited ? <span className="absolute right-0.5 bottom-0.5 rounded-[3px] bg-black/70 px-1 text-[8.5px] font-bold text-white">{`v${s.edited}`}</span> : null}
                  </button>
                ))}
              </div>
              {strip.length && position >= 0 ? <span className="shrink-0 text-[12px] text-[#AFC0E8]">{`${position + 1} of ${strip.length} in folder`}</span> : null}
              <span className="flex-1" />
              <button
                type="button"
                draggable={!!pic}
                title="Drag out to Finder, Explorer or another app as a PNG"
                onPointerDown={() => void prepareOut()}
                onDragStart={(e) => {
                  e.preventDefault();
                  if (dragToken.current) void startDrag(dragToken.current).catch(() => undefined);
                  else toast('info', 'Getting the picture ready — drag again in a moment.');
                }}
                className="flex h-8 shrink-0 cursor-grab items-center gap-1.5 rounded-[8px] border border-[#2A3A66] px-2.5 text-[12px] font-semibold text-[#C9D4FF] hover:bg-white/5"
              >
                <Icon name="grip-horizontal" size={14} />
                Drag out
              </button>
              <span className="shrink-0 text-[12px] text-[#AFC0E8]">{pic ? `${out.w} × ${out.h} px${file ? ` · ${bytes(data?.file.size ?? file.size)}` : ''}` : ''}</span>
              <DarkButton aria-label="Zoom out" onClick={() => setZoom(Math.max(0.05, (zoom === 'fit' ? fitScale : zoom) / 1.25))} icon={<Icon name="zoom-out" size={15} />} className="h-8 w-8 px-0">
                {''}
              </DarkButton>
              <span className="w-11 shrink-0 text-center font-mono text-[12px]">{`${Math.round((zoom === 'fit' ? fitScale : zoom) * 100)}%`}</span>
              <DarkButton aria-label="Zoom in" onClick={() => setZoom(Math.min(16, (zoom === 'fit' ? fitScale : zoom) * 1.25))} icon={<Icon name="zoom-in" size={15} />} className="h-8 w-8 px-0">
                {''}
              </DarkButton>
              <DarkButton aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')} className="h-8">
                Fit
              </DarkButton>
            </div>
          </div>
          {/* ── the panel (EDT-E-04: 320 px) ── */}
          <aside aria-label={`${toolLabel} options`} className="flex w-[320px] shrink-0 flex-col border-l border-[#1E2A4A] bg-[#0F1629]">
            {tool !== 'ai' ? (
              <div role="tablist" aria-label="Panel" className="flex shrink-0 border-b border-[#1E2A4A] px-2">
                {(
                  [
                    ['tool', toolLabel],
                    ['layers', 'Layers'],
                    ['export', 'Export'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('h-10 px-3 text-[12.5px] font-bold', tab === id ? 'border-b-2 border-[#7FA2FF] text-white' : 'text-[#8C9BC0] hover:text-white')}>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 scroll-thin">
              {tab === 'layers' && tool !== 'ai' ? <LayersPanel {...panelProps} /> : null}
              {tab === 'export' && tool !== 'ai' ? <ExportPanel ext={ext} busy={busy} onExport={(f, qy, edge) => void exportCopy(f, qy, edge)} /> : null}
              {tab === 'tool' || tool === 'ai' ? (
                <>
                  {tool === 'select' ? <SelectHelp count={recipe.objects.length} selected={selected.length} onLayers={() => setTab('layers')} /> : null}
                  {tool === 'crop' && pic ? <CropPanel {...panelProps} draft={cropDraft} setDraft={setCropDraft} ratio={cropRatio.id} setRatio={(id, value) => setCropRatio({ id, value })} onApply={applyCrop} onGrid={setGrid} /> : null}
                  {tool === 'adjust' ? <AdjustPanel {...panelProps} /> : null}
                  {tool === 'filters' ? <FiltersPanel {...panelProps} presets={presets.filter} hasArea={!!recipe.area?.seeds.length} onSavePreset={(n) => void savePreset({ kind: 'filter', name: n, scope: 'personal', payload: { base: recipe.filter.name, strength: recipe.filter.strength, adjust: recipe.adjust } }).then(() => (toast('success', `Saved “${n}” to your presets`), void presetsQ.refetch()), (e) => toast('error', errorMessage(e)))} /> : null}
                  {tool === 'area' ? <AreaPanel {...panelProps} /> : null}
                  {tool === 'text' ? <TextPanel {...panelProps} brandFonts={brandFonts} orgPresets={presets.text} missing={missing} /> : null}
                  {tool === 'stickers' || tool === 'shapes' ? <StickersPanel {...panelProps} start={tool === 'shapes' ? 'shapes' : 'stickers'} libraries={libraries} libraryOffline={!!libsQ.data?.offline} folders={libsQ.data?.folders ?? {}} /> : null}
                  {tool === 'frames' ? <FramesPanel {...panelProps} libraries={libraries} /> : null}
                  {tool === 'draw' ? <DrawPanel style={drawStyle} setStyle={setDrawStyle} /> : null}
                  {tool === 'mark' ? <MarkPanel {...panelProps} presets={presets.watermark} libraries={libraries} /> : null}
                  {tool === 'redact' ? <RedactPanel {...panelProps} /> : null}
                  {tool === 'ai' && aiOn && pic ? (
                    <AiPanel
                      fileId={fileId}
                      ai={settings.ai!}
                      recipe={recipe}
                      picture={{ w: pic.W, h: pic.H }}
                      makeImage={async () => {
                        const o = outputSize(pic.W, pic.H, recipe);
                        const c = renderRecipe(pic.src, pic.W, pic.H, recipe, { scale: Math.min(1, 1536 / Math.max(o.w, o.h)), assets });
                        return toBlob(c, 'image/jpeg', 0.85);
                      }}
                      onPreview={(r, crops) => (setAiPreview(r), setAiCrops(crops))}
                      onApply={(r, summary) => {
                        commit({ ...r, ai_steps: [...recipe.ai_steps, { action: 'suggest', provider: settings.ai?.provider_label ?? null, at: new Date().toISOString(), summary }] });
                        setAiPreview(null);
                      }}
                      onEditPanel={(t) => chooseTool(t)}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
            {!canEditFile && data && !isNew ? <p className="m-3 rounded-[10px] border border-[#6B4E12] bg-[#2A2210] p-2.5 text-[12px] text-[#FDE68A]">{editReason ?? 'You can save a copy of this picture, not a new version of it.'}</p> : null}
            {local?.synced ? (
              <div className="m-3 mt-0 flex flex-col gap-1 rounded-[10px] border border-[#1E4D3D] bg-[#10261F] p-3 text-[12px]">
                <span className="flex items-center gap-1.5 font-semibold text-[#9EE6C3]">
                  <Icon name="check" size={13} />
                  Available offline · synced copy on this computer
                </span>
                <span className="text-[#AFC0E8]">Edits made offline save to the copy here first, with their layers, and upload as a new version when you are back online.</span>
              </div>
            ) : null}
          </aside>
        </div>
      )}
      {dialog && pic ? (
        <SaveDialog
          name={name}
          ext={ext}
          version={head}
          folderId={blank?.folderId ?? data?.file.folder_id ?? file?.folder_id ?? null}
          folderName={folderLabel}
          canEdit={canEditFile || isNew}
          editReason={editReason}
          canCopy={canCopy || isNew}
          isNew={isNew}
          defaults={settings.save_defaults}
          followers={data?.followers ?? 0}
          autoNote={autoSummary(recipe)}
          hasGps={!!data?.exif?.gps}
          hasTransparency={recipe.corners > 0 && !recipe.corners_fill}
          initial={isNew && dialog.initial === 'version' ? 'copy' : dialog.initial}
          stale={stale}
          offline={(offline || q.isError) && local?.synced ? { willBe: (local.version ?? head) + 1 } : null}
          sizeFor={() => out}
          estimate={estimate}
          onSave={(o) => void save(o, stale ? stale.version : head)}
          onCompare={() => (setDialog(null), void openVersions())}
          onRequestEdit={fileId ? () => void requestEdit(fileId).then(() => toast('success', 'Asked the owner for Edit access'), (e) => toast('error', errorMessage(e))) : null}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {asking ? (
        <Modal
          title="Save your changes?"
          width={440}
          onClose={() => setAsking(null)}
          footer={
            <>
              <Button onClick={() => setAsking(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => (setAsking(null), asking.then())}>
                Discard
              </Button>
              <Button variant="primary" onClick={() => (setAsking(null), setDialog({ initial: canEditFile && !isNew ? 'version' : 'copy', stale: null }))}>
                Save…
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">Your edits to this picture are not saved yet. The recipe is autosaved, so Discard can still be undone by reopening the picture soon.</p>
        </Modal>
      ) : null}
      {shortcuts ? <Shortcuts onClose={() => setShortcuts(false)} /> : null}
    </div>
  );
}

function SelectHelp({ count, selected, onLayers }: { count: number; selected: number; onLayers: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[15px] font-bold text-white">Select</h2>
      <span className="text-[12.5px] text-[#AFC0E8]">Click a layer to select it; Shift-click adds more. Drag to move, use the corners to resize and the round handle to turn. Arrow keys nudge; Delete removes.</span>
      <span className="text-[12px] text-[#8C9BC0]">{`${count} ${count === 1 ? 'layer' : 'layers'}${selected ? ` · ${selected} selected` : ''}`}</span>
      <DarkButton onClick={onLayers} icon={<Icon name="layers" size={14} />}>
        Layers, align and order
      </DarkButton>
      <span className="text-[12px] text-[#8C9BC0]">Drop a picture from Finder or Explorer onto the canvas to place it as a layer.</span>
    </div>
  );
}

export const EDITOR_SHORTCUTS: Array<[string, string]> = [
  ['V', 'Select'],
  ['C', 'Crop'],
  ['T', 'Text'],
  ['K', 'Shapes'],
  ['S', 'Stickers'],
  ['F', 'Frames'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['⌘S', 'Save to Drive'],
  ['⇧⌘S', 'Save as a copy'],
  ['+ / − / 0 / 1', 'Zoom in, out, fit, 100%'],
  ['Arrows', 'Nudge the selection (Shift: 10 px)'],
  ['Delete', 'Remove the selection'],
  ['Esc', 'Deselect, or close'],
  ['?', 'These shortcuts'],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" width={420} onClose={onClose}>
      <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-[13px]">
        {EDITOR_SHORTCUTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-[12px] text-ink-2">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
