import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Menu, type MenuSection } from '../../../components/Menu';
import { Button, IconButton, Modal, Spinner, cx } from '../../../components/ui';
import { canOpen } from '../../../core/access';
import { errorMessage } from '../../../core/bridge';
import { bytes, dateLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { openPdf } from '../../pdf/open';
import { IMAGE_EDIT_EXTS, can, extOf, opened, type DriveFile } from '../api';
import { useDrive } from '../ctx';
import { FileIcon } from '../Thumb';
import { openImage, prepareImage, regionComment, restoreVersion, rotateImage, setRating, setTags, sourceUrl, stripLocation, type ImageOpen } from './api';
import { CompareView } from './Compare';
import { openInSystemEditor, saveToComputer, useLocalImage } from './local';

/**
 * The image viewer (Drive ENH-03 VWR-E; W12, P01): the picture as big as it goes, zoomed and panned, turned and
 * flipped for a look (and saved that way as a version on request), with the folder's filmstrip, a slideshow, the
 * information panel (camera, place, rating, tags), versions to compare, comments pinned to an area, and every way on
 * from here: Edit photo, Open with, Share, Send to Chat, copy and export. It follows the app's light or dark theme;
 * the editor stays dark.
 */
export interface ViewerProps {
  files: DriveFile[];
  start: number;
  onClose: () => void;
  onEdit: (f: DriveFile, version?: number) => void;
}

type Fit = 'fit' | 'width' | number;

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 16;

export const VIEWER_SHORTCUTS: Array<[string, string]> = [
  ['← → / PgUp PgDn', 'Previous / next'],
  ['+ / −', 'Zoom in / out'],
  ['0 / 1 / W', 'Fit / actual size / fit width'],
  ['R / ⇧R', 'Turn right / left'],
  ['H / V', 'Flip across / down'],
  ['F', 'Full screen'],
  ['E', 'Edit photo'],
  ['I', 'Information'],
  ['Space', 'Slideshow'],
  ['⌥0 … ⌥5', 'Rate'],
  ['Z', 'Look at 100% under the pointer'],
  ['Esc', 'Close'],
  ['?', 'These shortcuts'],
];

export function ImageViewer({ files, start, onClose, onEdit }: ViewerProps) {
  const d = useDrive();
  const qc = useQueryClient();
  const [i, setI] = useState(Math.max(0, Math.min(files.length - 1, start)));
  const f = files[i]!;
  const q = useQuery({ queryKey: ['files', 'image', f.id], queryFn: ({ signal }) => openImage(f.id, signal), retry: false });
  const o: ImageOpen | null = q.data ?? null;
  const { info: local } = useLocalImage(f.id);
  const [fit, setFit] = useState<Fit>('fit');
  const [view, setView] = useState({ rotate: 0, flipH: false, flipV: false });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [info, setInfo] = useState(true);
  const [tab, setTab] = useState<'info' | 'versions' | 'comments'>('info');
  const [show, setShow] = useState<{ on: boolean; interval: number; loop: boolean; shuffle: boolean; fade: boolean; hideUi: boolean }>({ on: false, interval: 4, loop: true, shuffle: false, fade: true, hideUi: true });
  const [showOptions, setShowOptions] = useState(false);
  const [paused, setPaused] = useState<string | null>(null);
  const [menu, setMenu] = useState<'open' | 'export' | null>(null);
  const [compare, setCompare] = useState(false);
  const [help, setHelp] = useState(false);
  const [loupe, setLoupe] = useState(false);
  const [region, setRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const openBtn = useRef<HTMLButtonElement>(null);
  const exportBtn = useRef<HTMLButtonElement>(null);
  const panFrom = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const ext = extOf(f.name, o?.file.extension ?? f.extension);
  const src = sourceUrl(o?.source ?? null);
  const W = o?.image?.width ?? 0;
  const H = o?.image?.height ?? 0;
  const turnedWH = view.rotate % 180 ? { w: H, h: W } : { w: W, h: H };
  const fitScale = W && H ? Math.min(box.w / turnedWH.w, box.h / turnedWH.h, 1) : 1;
  const scale = fit === 'fit' ? fitScale : fit === 'width' ? (turnedWH.w ? box.w / turnedWH.w : 1) : fit;
  const canEdit = !!o?.editable && (o?.can?.edit ?? can(f.access, 'upload_version'));
  const canRate = o?.can?.rate ?? o?.can?.edit ?? can(f.access, 'edit');
  const canTag = o?.can?.tag ?? canRate;
  const canComment = o?.can?.comment ?? can(f.access, 'comment');
  const canDownload = o?.can?.download ?? can(f.access, 'download');
  const editable = IMAGE_EDIT_EXTS.includes(ext);
  const editWhy = !editable ? `A ${ext.toUpperCase() || 'file'} like this cannot be edited.` : !canEdit && !canDownload ? 'You can view this picture, not edit or copy it.' : null;
  const turnedView = view.rotate !== 0 || view.flipH || view.flipV;

  // Opening counts as opening; a new picture starts fitted.
  const [seen, setSeen] = useState<number | null>(null);
  if (seen !== f.id) {
    setSeen(f.id);
    setFit('fit');
    setPan({ x: 0, y: 0 });
    setView({ rotate: 0, flipH: false, flipV: false });
    setPaused(null);
    setRegion(null);
  }
  useEffect(() => void opened(f.id), [f.id]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ w: Math.max(100, el.clientWidth - 48), h: Math.max(100, el.clientHeight - 48) });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The neighbours load ahead, one each way (NFR-01).
  useEffect(() => {
    for (const n of [files[i + 1], files[i - 1]]) if (n) void qc.prefetchQuery({ queryKey: ['files', 'image', n.id], queryFn: ({ signal }) => openImage(n.id, signal), staleTime: 60_000 });
  }, [i, files, qc]);

  const go = (to: number) => {
    if (!files.length) return;
    setI(((to % files.length) + files.length) % files.length);
  };

  // The slideshow (VWR-E-09).
  useEffect(() => {
    if (!show.on) return;
    const t = setTimeout(() => {
      if (show.shuffle && files.length > 1) {
        let n = i;
        while (n === i) n = Math.floor(Math.random() * files.length);
        go(n);
      } else if (i < files.length - 1 || show.loop) go(i + 1);
      else setShow((s) => ({ ...s, on: false }));
    }, show.interval * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, i]);

  const zoomBy = (k: number) => setFit(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale * k)));
  const rate = (stars: number) => {
    if (!canRate) return;
    void setRating(f.id, stars).then(
      () => (toast('success', stars ? `Rated ${stars} ${stars === 1 ? 'star' : 'stars'}` : 'Rating removed'), void qc.invalidateQueries({ queryKey: ['files', 'image', f.id] })),
      (e) => toast('error', errorMessage(e)),
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (document.querySelector('[role="menu"]') || (document.querySelector('[aria-modal="true"]') && !help)) return;
      const k = e.key;
      if (e.altKey && /^[0-5]$/.test(k)) rate(Number(k));
      else if (k === 'Escape') {
        if (help) setHelp(false);
        else if (show.on) setShow((s) => ({ ...s, on: false }));
        else if (commentMode) setCommentMode(false);
        else onClose();
      } else if (k === 'ArrowRight' || k === 'PageDown') go(i + 1);
      else if (k === 'ArrowLeft' || k === 'PageUp') go(i - 1);
      else if (k === '+' || k === '=') zoomBy(1.25);
      else if (k === '-') zoomBy(1 / 1.25);
      else if (k === '0') {
        setFit('fit');
        setPan({ x: 0, y: 0 });
      }
      else if (k === '1') setFit(1);
      else if (k === 'w' || k === 'W') setFit('width');
      else if (k === 'r') setView((v) => ({ ...v, rotate: (v.rotate + 90) % 360 }));
      else if (k === 'R') setView((v) => ({ ...v, rotate: (v.rotate + 270) % 360 }));
      else if (k === 'h' || k === 'H') setView((v) => ({ ...v, flipH: !v.flipH }));
      else if (k === 'v' || k === 'V') setView((v) => ({ ...v, flipV: !v.flipV }));
      else if (k === 'f' || k === 'F') void (document.fullscreenElement ? document.exitFullscreen() : stage.current?.parentElement?.requestFullscreen())?.catch?.(() => undefined);
      else if ((k === 'e' || k === 'E') && !editWhy) onEdit(f);
      else if (k === 'i' || k === 'I') setInfo((x) => !x);
      else if (k === ' ') setShow((s) => ({ ...s, on: !s.on }));
      else if (k === 'z' || k === 'Z') {
        setFit(loupe ? 'fit' : 1);
        setLoupe(!loupe);
      }
      else if (k === '?') setHelp(true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const onWheel = (e: ReactWheelEvent) => {
    if (!W) return;
    const k = Math.exp(-e.deltaY * 0.0015);
    setFit(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale * k)));
  };
  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (commentMode) {
      const r = img.current?.getBoundingClientRect();
      if (!r) return;
      const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      setDrawing(p);
      setRegion({ ...p, w: 0, h: 0 });
      return;
    }
    panFrom.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const move = (e: ReactPointerEvent) => {
    if (commentMode && drawing) {
      const r = img.current?.getBoundingClientRect();
      if (!r) return;
      const p = { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
      setRegion({ x: Math.min(p.x, drawing.x), y: Math.min(p.y, drawing.y), w: Math.abs(p.x - drawing.x), h: Math.abs(p.y - drawing.y) });
      return;
    }
    const from = panFrom.current;
    if (from) setPan({ x: from.px + e.clientX - from.x, y: from.py + e.clientY - from.y });
  };
  const up = () => {
    panFrom.current = null;
    setDrawing(null);
  };

  const freezeFrame = () => {
    const el = img.current;
    if (!el) return;
    if (paused) return setPaused(null);
    try {
      const c = document.createElement('canvas');
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      c.getContext('2d')!.drawImage(el, 0, 0);
      setPaused(c.toDataURL());
    } catch {
      toast('error', 'This animation cannot be paused here.');
    }
  };

  const pictureBlob = async (format: 'image/png' | 'image/jpeg' | 'image/webp', longEdge: number | null, quality = 0.92): Promise<Blob> => {
    const el = img.current;
    if (!el || !el.naturalWidth) throw new Error('The picture is not loaded yet.');
    const k = longEdge && Math.max(el.naturalWidth, el.naturalHeight) > longEdge ? longEdge / Math.max(el.naturalWidth, el.naturalHeight) : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(el.naturalWidth * k);
    c.height = Math.round(el.naturalHeight * k);
    const ctx = c.getContext('2d')!;
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.drawImage(el, 0, 0, c.width, c.height);
    return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('The picture could not be drawn.'))), format, quality));
  };

  const copy = async () => {
    try {
      const png = await pictureBlob('image/png', null);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('success', 'Picture copied');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const exportAs = async (format: 'png' | 'jpg' | 'webp', longEdge: number | null) => {
    try {
      const b = await pictureBlob(format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg', longEdge);
      const r = await saveToComputer(`${f.name.replace(/\.[^.]+$/, '')}${longEdge ? `-${longEdge}` : ''}.${format}`, new Uint8Array(await b.arrayBuffer()));
      if (r) toast('success', `Saved ${r.name}`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const saveTurn = () =>
    void rotateImage(f.id, { rotate: view.rotate as 0 | 90 | 180 | 270, flip_h: view.flipH, flip_v: view.flipV, base_version: o?.file.version ?? f.version ?? 1 }).then(
      (r) => (toast('success', `Saved as v${r.version}${r.method === 'lossless' ? ' — turned without re-encoding' : ''}`), setView({ rotate: 0, flipH: false, flipV: false }), void qc.invalidateQueries({ queryKey: ['files'] })),
      (e) => toast('error', errorMessage(e)),
    );

  const openSections: MenuSection[] = [
    {
      id: 'open',
      items: [
        { id: 'editor', label: 'Photo editor', badge: 'Default', icon: 'compose', disabled: !!editWhy, reason: editWhy ?? undefined, onSelect: () => onEdit(f) },
        ...(o?.editor?.quick_design ? [{ id: 'quick', label: 'Quick design', description: 'Needs internet · no editable layers', icon: 'sticker', disabled: true, reason: 'Quick design opens on the web.' }] : []),
        ...(canOpen('pdf') ? [{ id: 'pdf', label: 'PDF Studio', icon: 'file-text', onSelect: () => openPdf({ kind: 'drive', fileId: f.id }, f.name) }] : []),
        {
          id: 'system',
          label: 'System editor',
          description: local?.synced ? 'The synced copy on this computer; the change syncs back as a version' : undefined,
          icon: 'laptop',
          disabled: !local?.synced,
          reason: local?.synced ? undefined : 'Keep this folder on this computer (Sync devices) to open it in another app.',
          onSelect: () => void openInSystemEditor(f.id).catch((e) => toast('error', errorMessage(e))),
        },
      ],
    },
  ];
  const exportSections: MenuSection[] = [
    { id: 'copy', items: [{ id: 'clip', label: 'Copy picture', icon: 'copy', onSelect: () => void copy() }] },
    {
      id: 'export',
      label: 'Download',
      items: [
        { id: 'orig', label: 'Original', icon: 'download', onSelect: () => d.download([f]) },
        ...(['jpg', 'png', 'webp'] as const).flatMap((fmt) => [
          { id: `${fmt}-full`, label: `${fmt.toUpperCase()} · original size`, onSelect: () => void exportAs(fmt, null) },
          { id: `${fmt}-2048`, label: `${fmt.toUpperCase()} · large (2048 px)`, onSelect: () => void exportAs(fmt, 2048) },
          { id: `${fmt}-1024`, label: `${fmt.toUpperCase()} · small (1024 px)`, onSelect: () => void exportAs(fmt, 1024) },
        ]),
      ],
    },
  ];

  const ui = !(show.on && show.hideUi);
  const t = `translate(${pan.x}px, ${pan.y}px) rotate(${view.rotate}deg) scale(${view.flipH ? -1 : 1}, ${view.flipV ? -1 : 1})`;
  const animated = ext === 'gif' || (ext === 'webp' && (o?.image?.frames ?? 0) > 1);

  if (compare && o) {
    return (
      <div role="region" aria-label={`Compare versions of ${f.name}`} className="no-drag absolute inset-0 z-30 flex flex-col bg-[#0B1120]">
        <CompareView fileId={f.id} versions={o.versions} current={o.file.version} canRestore={canEdit} onClose={() => setCompare(false)} onReopen={(v) => (setCompare(false), onEdit(f, v.version))} onRestore={(v) => void restoreVersion(f.id, v.id).then(() => (toast('success', `v${v.version} restored as a new version`), setCompare(false), void qc.invalidateQueries({ queryKey: ['files'] })), (e) => toast('error', errorMessage(e)))} />
      </div>
    );
  }

  return (
    <div role="region" aria-label={`Viewer — ${f.name}`} className="no-drag absolute inset-0 z-30 flex flex-col bg-ground text-[13px] text-ink">
      {ui ? (
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface px-3.5">
          <IconButton icon="chevron-left" label="Back to the folder" onClick={onClose} />
          <span className="rounded-[6px] bg-subtle px-2 py-0.5 text-[10.5px] font-bold text-ink-2">{ext.toUpperCase() || 'IMG'}</span>
          <div className="flex min-w-0 flex-col leading-tight">
            <b className="truncate text-[14px]">{f.name}</b>
            <span className="truncate text-[11.5px] text-ink-3">{(o?.file.folder_path ?? f.folder_path)?.replace(/\//g, ' › ') ?? (f.folder_name || 'My Drive')}</span>
          </div>
          {o ? (
            <button type="button" title="Versions" onClick={() => (setInfo(true), setTab('versions'))} className="rounded-[8px] bg-subtle px-2 py-0.5 text-[12px] font-bold">
              {`v${o.file.version}`}
            </button>
          ) : null}
          <span className="flex-1" />
          <IconButton icon="chevron-left" label="Previous (←)" disabled={files.length < 2} onClick={() => go(i - 1)} />
          <span className="text-[12px] text-ink-3">{`${i + 1} of ${files.length}`}</span>
          <IconButton icon="chevron-right" label="Next (→)" disabled={files.length < 2} onClick={() => go(i + 1)} />
          <Button size="sm" icon={show.on ? 'pause' : 'play'} onClick={() => setShow((s) => ({ ...s, on: !s.on }))}>
            {show.on ? 'Stop' : 'Slideshow'}
          </Button>
          <IconButton icon="settings-2" label="Slideshow options" onClick={() => setShowOptions(true)} />
          <span title={editWhy ?? undefined}>
            <Button size="sm" variant="primary" icon="compose" disabled={!!editWhy} onClick={() => onEdit(f)} aria-keyshortcuts="E">
              Edit photo
            </Button>
          </span>
          <button ref={openBtn} type="button" aria-haspopup="menu" onClick={() => setMenu('open')} className="flex h-7 items-center gap-1 rounded-[8px] border border-line px-2.5 text-[12px] font-semibold hover:bg-subtle">
            Open with <Icon name="chevron-down" size={13} />
          </button>
          {can(f.access, 'share') ? <Button size="sm" icon="users" onClick={() => d.share({ type: 'file', f })}>Share</Button> : null}
          {can(f.access, 'chat_share') && canOpen('chat') ? <Button size="sm" icon="send" onClick={() => d.sendToChat({ type: 'file', f })}>Send to Chat</Button> : null}
          {canDownload ? (
            <button ref={exportBtn} type="button" aria-label="Copy and download" aria-haspopup="menu" onClick={() => setMenu('export')} className="flex h-7 items-center gap-1 rounded-[8px] border border-line px-2.5 text-[12px] font-semibold hover:bg-subtle">
              <Icon name="download" size={14} />
              <Icon name="chevron-down" size={13} />
            </button>
          ) : null}
          <IconButton icon="info" label="Information (I)" active={info} onClick={() => setInfo((x) => !x)} />
          <IconButton icon="help" label="Keyboard shortcuts (?)" onClick={() => setHelp(true)} />
          <IconButton icon="x" label="Close viewer" onClick={onClose} />
          {menu === 'open' ? <Menu sections={openSections} label="Open with" anchor={openBtn} prefer="bottom" align="end" onClose={() => setMenu(null)} width={300} /> : null}
          {menu === 'export' ? <Menu sections={exportSections} label="Copy and download" anchor={exportBtn} prefer="bottom" align="end" onClose={() => setMenu(null)} width={260} /> : null}
        </div>
      ) : null}
      {turnedView && ui ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-selection px-4 py-2 text-[12.5px] text-primary">
          <Icon name="rotate-cw" size={14} />
          <span className="flex-1">Turned for viewing only.</span>
          {canEdit ? <Button size="sm" variant="primary" onClick={saveTurn}>Save as new version</Button> : null}
          <Button size="sm" onClick={() => setView({ rotate: 0, flipH: false, flipV: false })}>Undo</Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={stage}
            onWheel={onWheel}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onDoubleClick={() => setFit(fit === 'fit' ? 1 : 'fit')}
            className={cx('relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden bg-subtle', commentMode ? 'cursor-crosshair' : scale > fitScale ? 'cursor-grab' : 'cursor-zoom-in')}
          >
            {q.isLoading ? <Spinner /> : null}
            {q.error ? <span className="text-danger">{errorMessage(q.error)}</span> : null}
            {o && !o.source ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <FileIcon f={f} size={72} />
                <span className="text-ink-2">{o.needs ? 'This kind of picture needs a viewable copy first. The original is not changed.' : 'This picture cannot be shown here.'}</span>
                {o.needs ? <Button variant="primary" onClick={() => void prepareImage(f.id).then(() => (toast('info', 'Preparing a viewable copy…'), setTimeout(() => void q.refetch(), 3000)), (e) => toast('error', errorMessage(e)))}>Prepare it</Button> : null}
              </div>
            ) : null}
            {src ? (
              <div className={cx('relative', show.on && show.fade && 'animate-in')} style={{ width: W ? W * scale : undefined, height: H ? H * scale : undefined, transform: t, transition: show.on && show.fade ? 'opacity .5s' : undefined }}>
                <img ref={img} key={src} src={paused ?? src} alt={o?.file.alt_text || o?.file.description || f.name} draggable={false} className="block h-full w-full select-none" style={!W ? { maxWidth: box.w, maxHeight: box.h } : undefined} />
                {tab === 'comments' && info
                  ? (o?.region_comments ?? []).map((c) => (
                      <span key={c.comment_id} title={c.excerpt ? `${c.author?.name ?? 'Comment'}: ${c.excerpt}` : 'Comment'} className="absolute border-2 border-[#F59E0B] bg-[#F59E0B]/10" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }} />
                    ))
                  : null}
                {region && region.w > 0.005 ? <span className="absolute border-2 border-dashed border-primary bg-primary/10" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }} /> : null}
              </div>
            ) : null}
            {loupe && src ? <span className="absolute top-3 left-3 rounded-[6px] bg-black/60 px-2 py-0.5 text-[11.5px] font-bold text-white">100% — Z to leave</span> : null}
            {animated && src ? (
              <button type="button" onClick={freezeFrame} className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-[8px] bg-black/60 px-2.5 py-1 text-[12px] font-semibold text-white">
                <Icon name={paused ? 'play' : 'pause'} size={13} />
                {paused ? 'Play' : 'Pause'}
              </button>
            ) : null}
          </div>
          {ui ? (
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line bg-surface px-3 text-[12px] text-ink-2">
              <span>{W && H ? `${W} × ${H} px · ${bytes(o?.file.size ?? f.size)}` : bytes(f.size)}</span>
              <span className="flex-1" />
              <IconButton icon="undo" label="Turn left (⇧R)" size={15} onClick={() => setView((v) => ({ ...v, rotate: (v.rotate + 270) % 360 }))} />
              <IconButton icon="rotate-cw" label="Turn right (R)" size={15} onClick={() => setView((v) => ({ ...v, rotate: (v.rotate + 90) % 360 }))} />
              <IconButton icon="flip" label="Flip across (H)" size={15} onClick={() => setView((v) => ({ ...v, flipH: !v.flipH }))} />
              <IconButton icon="flip-v" label="Flip down (V)" size={15} onClick={() => setView((v) => ({ ...v, flipV: !v.flipV }))} />
              <IconButton icon="zoom-out" label="Zoom out (−)" size={15} onClick={() => zoomBy(1 / 1.25)} />
              <span className="w-12 text-center font-mono">{`${Math.round(scale * 100)}%`}</span>
              <IconButton icon="zoom-in" label="Zoom in (+)" size={15} onClick={() => zoomBy(1.25)} />
              <button type="button" aria-pressed={fit === 'fit'} onClick={() => (setFit('fit'), setPan({ x: 0, y: 0 }))} className={cx('rounded-[6px] px-2 py-0.5', fit === 'fit' ? 'bg-selection text-primary' : 'hover:bg-subtle')}>Fit</button>
              <button type="button" aria-pressed={fit === 'width'} onClick={() => setFit('width')} className={cx('rounded-[6px] px-2 py-0.5', fit === 'width' ? 'bg-selection text-primary' : 'hover:bg-subtle')}>Width</button>
              <button type="button" aria-pressed={fit === 1} onClick={() => setFit(1)} className={cx('rounded-[6px] px-2 py-0.5', fit === 1 ? 'bg-selection text-primary' : 'hover:bg-subtle')}>100%</button>
              <IconButton icon="fullscreen" label="Full screen (F)" size={15} onClick={() => void stage.current?.parentElement?.requestFullscreen?.().catch(() => undefined)} />
            </div>
          ) : null}
          {ui && files.length > 1 ? (
            <div role="list" aria-label="Pictures in this folder" className="flex h-[78px] shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-surface px-3 scroll-thin">
              {files.map((x, n) => {
                const nb = o?.neighbours?.find((y) => y.id === x.id);
                return (
                  <button key={x.id} type="button" role="listitem" aria-current={n === i ? 'true' : undefined} title={x.name} onClick={() => setI(n)} className={cx('relative flex h-[56px] w-[78px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-subtle', n === i ? 'outline-2 outline-offset-2 outline-primary' : 'opacity-70 hover:opacity-100')}>
                    {nb?.url ? <img src={sourceUrl(nb.url) ?? undefined} alt="" loading="lazy" className="h-full w-full object-cover" /> : <FileIcon f={x} size={40} />}
                    {nb?.edited ? <span className="absolute right-0.5 bottom-0.5 rounded-[4px] bg-black/70 px-1 text-[9px] font-bold text-white">{`Edited · v${nb.version ?? ''}`}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {info && ui && o ? (
          <aside aria-label="Information" className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface">
            <div role="tablist" aria-label="Information" className="flex shrink-0 border-b border-line px-2">
              {(['info', 'versions', 'comments'] as const).map((x) => (
                <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={cx('h-10 px-3 text-[12.5px] font-bold', tab === x ? 'border-b-2 border-primary text-ink' : 'text-ink-3 hover:text-ink')}>
                  {x === 'info' ? 'Information' : x === 'versions' ? 'Versions' : 'Comments'}
                </button>
              ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 scroll-thin">
              {tab === 'info' ? <InfoTab o={o} fileId={f.id} canRate={canRate} canTag={canTag} onRate={rate} /> : null}
              {tab === 'versions' ? (
                <>
                  {o.versions.length > 1 ? <Button icon="layout-side" onClick={() => setCompare(true)}>Compare versions</Button> : null}
                  <ul className="flex flex-col gap-1.5">
                    {[...o.versions].sort((a, b) => b.version - a.version).map((v) => (
                      <li key={v.id} className="flex flex-col rounded-[10px] border border-line px-3 py-2">
                        <span className="flex items-center gap-2">
                          <b>{`v${v.version}`}</b>
                          {v.editable ? <span className="rounded-[4px] bg-selection px-1.5 text-[10px] font-bold text-primary">EDITABLE</span> : null}
                          <span className="ml-auto text-[11.5px] text-ink-3">{v.created_at ? dateLabel(v.created_at) : ''}</span>
                        </span>
                        <span className="text-[12.5px] text-ink-2">{v.note || v.summary || '—'}</span>
                        {v.author ? <span className="text-[11.5px] text-ink-3">{v.author}</span> : null}
                        {v.editable && canEdit ? (
                          <button type="button" onClick={() => onEdit(f, v.version)} className="mt-1 self-start text-[12px] font-semibold text-primary hover:underline">
                            Reopen in editor
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {tab === 'comments' ? (
                <CommentsTab
                  canComment={canComment}
                  drawing={commentMode}
                  region={region}
                  onStart={() => (setCommentMode(true), setRegion(null))}
                  onCancel={() => (setCommentMode(false), setRegion(null))}
                  onPost={(body) =>
                    region &&
                    void regionComment(f.id, body, { ...region, version: o.file.version }).then(
                      () => (toast('success', 'Comment added'), setCommentMode(false), setRegion(null), void q.refetch()),
                      (e) => toast('error', errorMessage(e)),
                    )
                  }
                  count={o.region_comments?.length ?? 0}
                  onAll={() => d.details({ type: 'file', f }, 'comments')}
                />
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
      {showOptions ? (
        <Modal title="Slideshow" width={380} onClose={() => setShowOptions(false)} footer={<Button variant="primary" onClick={() => (setShowOptions(false), setShow((s) => ({ ...s, on: true })))}>Start</Button>}>
          <div className="flex flex-col gap-3 text-[13px]">
            <label className="flex flex-col gap-1">
              <span className="flex">
                <span className="flex-1">Each picture for</span>
                <span className="font-mono">{`${show.interval} s`}</span>
              </span>
              <input type="range" min={2} max={30} value={show.interval} onChange={(e) => setShow((s) => ({ ...s, interval: Number(e.target.value) }))} aria-label="Seconds each picture shows" className="accent-[var(--color-primary)]" />
            </label>
            {(
              [
                ['loop', 'Start again after the last'],
                ['shuffle', 'Shuffle'],
                ['fade', 'Fade between pictures'],
                ['hideUi', 'Hide everything but the picture'],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2">
                <Checkbox checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />
                {l}
              </label>
            ))}
            <span className="text-[12px] text-ink-3">Space starts and stops it; Esc stops it.</span>
          </div>
        </Modal>
      ) : null}
      {help ? (
        <Modal title="Keyboard shortcuts" width={420} onClose={() => setHelp(false)}>
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5 text-[13px]">
            {VIEWER_SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[12px] text-ink-2">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      ) : null}
    </div>
  );
}

function InfoTab({ o, fileId, canRate, canTag, onRate }: { o: ImageOpen; fileId: number; canRate: boolean; canTag: boolean; onRate: (n: number) => void }) {
  const mine = o.rating?.mine ?? 0;
  const qc = useQueryClient();
  const [tag, setTag] = useState('');
  const tags = o.tags ?? o.file.tags ?? [];
  const e = o.exif ?? {};
  const rows: Array<[string, string | null | undefined]> = [
    ['Size', o.image?.width && o.image.height ? `${o.image.width} × ${o.image.height} px${o.image.megapixels ? ` · ${o.image.megapixels} MP` : ''}` : null],
    ['File size', bytes(o.file.size)],
    ['Taken', e.taken_at ? dateLabel(e.taken_at) : null],
    ['Camera', e.camera],
    ['Lens', e.lens],
    ['Exposure', [e.exposure, e.aperture, e.iso ? `ISO ${e.iso}` : null, e.focal_length].filter(Boolean).join(' · ') || null],
    ['Software', e.software],
  ];
  const saveTags = (next: string[]) =>
    void setTags(fileId, next).then(
      () => void qc.invalidateQueries({ queryKey: ['files', 'image', fileId] }),
      (err) => toast('error', errorMessage(err)),
    );
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold tracking-[0.06em] text-ink-2 uppercase">Rating</span>
        <div role="radiogroup" aria-label="Rating" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={mine === n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'} (Alt+${n})`} disabled={!canRate} onClick={() => onRate(mine === n ? 0 : n)} className={cx('text-[20px] leading-none disabled:cursor-default', mine >= n ? 'text-[#F5B400]' : 'text-line')}>
              ★
            </button>
          ))}
        </div>
        {o.rating?.count ? <span className="text-[11.5px] text-ink-3">{`Average ${(o.rating.average ?? 0).toFixed(1)} from ${o.rating.count} ${o.rating.count === 1 ? 'person' : 'people'}`}</span> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold tracking-[0.06em] text-ink-2 uppercase">Tags</span>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-full bg-subtle px-2.5 py-0.5 text-[12px]">
              {t}
              {canTag ? (
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => saveTags(tags.filter((x) => x !== t))} className="text-ink-3 hover:text-ink">
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {!tags.length ? <span className="text-[12px] text-ink-3">No tags.</span> : null}
        </div>
        {canTag ? (
          <input value={tag} onChange={(ev) => setTag(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && tag.trim() && (saveTags([...new Set([...tags, tag.trim()])]), setTag(''))} placeholder="Add a tag" aria-label="Add a tag" maxLength={60} className="h-8 rounded-[8px] border border-line bg-surface px-2.5 outline-none focus:border-primary" />
        ) : null}
      </div>
      <dl className="flex flex-col gap-1.5 text-[12.5px]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex gap-2.5">
              <dt className="w-[78px] shrink-0 text-ink-3">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
      </dl>
      {e.gps ? (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-line p-3">
          <span className="flex items-center gap-1.5 font-semibold">
            <Icon name="map-pin" size={14} />
            {e.gps.place ?? 'Location'}
          </span>
          <span className="font-mono text-[12px] text-ink-2">{`${e.gps.lat.toFixed(5)}, ${e.gps.lng.toFixed(5)}`}</span>
          {canRate ? (
            <Button size="sm" onClick={() => void stripLocation(fileId, o.file.version).then((r) => (toast('success', `Saved as v${r.version} without its location`), void qc.invalidateQueries({ queryKey: ['files'] })), (err) => toast('error', errorMessage(err)))}>
              Remove location
            </Button>
          ) : null}
          <span className="text-[11.5px] text-ink-3">Makes a new version without GPS tags; other camera details stay.</span>
        </div>
      ) : null}
      {o.file.description ? <p className="rounded-[8px] bg-subtle p-2.5 text-[12.5px] leading-[1.5]">{o.file.description}</p> : null}
    </>
  );
}

function CommentsTab({ canComment, drawing, region, onStart, onCancel, onPost, count, onAll }: { canComment: boolean; drawing: boolean; region: { w: number; h: number } | null; onStart: () => void; onCancel: () => void; onPost: (body: string) => void; count: number; onAll: () => void }) {
  const [body, setBody] = useState('');
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[12.5px] text-ink-2">{count ? `${count} ${count === 1 ? 'comment is' : 'comments are'} pinned to areas of this picture; they show on it while this tab is open.` : 'No comments are pinned to this picture yet.'}</span>
      {canComment ? (
        drawing ? (
          <>
            <span className="text-[12.5px]">{region && region.w > 0.005 ? 'Now say what it is about.' : 'Drag a box on the picture around what the comment is about.'}</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} aria-label="Comment" className="rounded-[8px] border border-line bg-surface p-2 outline-none focus:border-primary" />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={!body.trim() || !region || region.w < 0.005} onClick={() => (onPost(body.trim()), setBody(''))}>
                Post
              </Button>
              <Button size="sm" onClick={onCancel}>Cancel</Button>
            </div>
          </>
        ) : (
          <Button icon="message-square-plus" onClick={onStart}>Comment on an area</Button>
        )
      ) : null}
      <button type="button" onClick={onAll} className="self-start text-[12.5px] font-semibold text-primary hover:underline">
        All comments…
      </button>
    </div>
  );
}
