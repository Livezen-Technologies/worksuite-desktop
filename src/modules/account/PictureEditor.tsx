import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { request } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useMe } from '../../components/UserPicture';
import { btn, btnPrimary } from '../hr/parts';
import { abilities, K, usePictures, useRefreshMe, type Pictures } from './api';
import { avatarPng, avatarSvg, BACKGROUNDS, LOOKS, normalise, svgUrl, TONES, type AvatarBorder, type AvatarStyle } from './avatarArt';
import { MAX_ZOOM, clamp, draw, exportType, initial, minScale, rotate, transform, type Crop } from './crop';
import { Note } from './parts';
import { VisibilitySelect } from './visibility';

/**
 * Edit profile picture (AcctPhoto, AcctAvatar): a photo moved, zoomed and
 * turned inside a round frame, or an avatar made from a few choices. Either
 * way what goes up is a 1024-pixel square drawn here — never the original
 * file — and the server cleans and sizes it like any upload. When the
 * company reviews pictures the new one waits, and people keep seeing the
 * current one until it is approved.
 */
export type EditorTab = 'photo' | 'avatar';

/** The frame's side on screen. */
const STAGE = 300;
/** What is sent: a square this wide. */
const OUT = 1024;
const FILE_NAMES: Record<string, string> = { 'image/jpeg': 'profile.jpg', 'image/png': 'profile.png', 'image/webp': 'profile.webp' };
const KIND: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' };
const TYPE_NAMES: Record<string, string> = { jpg: 'JPG', png: 'PNG', webp: 'WebP' };
const SENT_FOR_REVIEW = 'Sent for review. It will show once an administrator approves it.';

/** Send a picture; it becomes current unless new pictures are reviewed, when `pending` says it waits. */
export async function sendPicture(image: Blob, made?: AvatarStyle): Promise<{ avatar: string | null; pending: boolean }> {
  const form = new FormData();
  // The server checks that the name's extension and the bytes agree.
  form.append('image', image, FILE_NAMES[image.type] ?? 'profile.webp');
  if (made) {
    form.append('type', 'generated_avatar');
    form.append('style', JSON.stringify(made));
  }
  const r = await request<{ avatar?: string | null; pending?: boolean }>('POST', '/api/users/me/pictures', { body: form });
  return { avatar: r.data?.avatar ?? null, pending: r.data?.pending === true };
}

export function typeList(types: string[]): string {
  const names = types.map((t) => TYPE_NAMES[t] ?? t.toUpperCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? 'JPG');
}

/** Why a chosen file cannot be a picture, before anything is sent — or null. */
export function refusal(file: { name: string; type: string; size: number }, limits: Pictures['limits'] | undefined): string | null {
  const ext = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  const allowed = limits?.types ?? ['jpg', 'png', 'webp'];
  const kind = KIND[file.type] ?? KIND[ext];
  if (!kind || !allowed.includes(kind)) return `A profile picture has to be a ${typeList(allowed)}.`;
  if (file.size <= 0) return 'That file is empty.';
  const max = limits?.max_bytes ?? 8 * 1048576;
  if (file.size > max) return `That picture is larger than ${Math.round(max / 1048576)} MB. Choose a smaller one.`;
  return null;
}

function acceptList(limits: Pictures['limits'] | undefined): string {
  const mime: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  return (limits?.types ?? ['jpg', 'png', 'webp']).flatMap((t) => [...(t === 'jpg' ? ['.jpg', '.jpeg'] : [`.${t}`]), mime[t] ?? '']).filter(Boolean).join(',');
}

/** A picture made here and handed back unsent, for a screen that sends it itself (the required-picture screen, #46). */
export type PickPicture = (image: Blob, made?: AvatarStyle) => void;

export function PictureEditor({ tab, onTab, onClose, style, onPick }: { tab: EditorTab; onTab: (t: EditorTab) => void; onClose: () => void; style?: Partial<AvatarStyle> | null; onPick?: PickPicture }) {
  const pics = usePictures();
  const can = abilities(pics.data);
  const [busy, setBusy] = useState(false);
  const tabs = ([['photo', 'Photo', can.upload], ['avatar', 'Avatar', can.avatar]] as const).filter(([, , ok]) => ok);
  const shown: EditorTab = tabs.some(([id]) => id === tab) ? tab : (tabs[0]?.[0] ?? 'photo');

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,27,61,.45)] p-6" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section role="dialog" aria-modal="true" aria-label="Edit profile picture" className="animate-in flex max-h-full w-[760px] max-w-full flex-col overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.3)]">
        <div className="flex items-center px-6 pt-5 pb-3">
          <h2 className="m-0 flex-1 text-[18px] font-bold text-ink">Edit profile picture</h2>
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </div>
        {tabs.length > 1 ? (
          <nav aria-label="Picture type" className="flex gap-1 border-b border-line px-6">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" aria-current={shown === id ? 'page' : undefined} disabled={busy} onClick={() => onTab(id)} className={cx('-mb-px h-10 border-b-2 px-3 text-[13.5px] font-semibold', shown === id ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
                {label}
              </button>
            ))}
          </nav>
        ) : null}
        {tabs.length === 0 ? (
          <p className="m-0 px-6 py-10 text-center text-[13px] text-ink-3">Your organisation does not let you change your picture.</p>
        ) : shown === 'photo' ? (
          <PhotoTab pics={pics.data} busy={busy} setBusy={setBusy} onClose={onClose} onPick={onPick} />
        ) : (
          <AvatarTab pics={pics.data} busy={busy} setBusy={setBusy} onClose={onClose} start={style ?? null} onPick={onPick} />
        )}
      </section>
    </div>
  );
}

function useSaved(onClose: () => void) {
  const refresh = useRefreshMe();
  return async (r: { pending: boolean }, what: string) => {
    await refresh([K.pictures, K.profile]);
    toast('success', r.pending ? SENT_FOR_REVIEW : `${what} saved.`);
    onClose();
  };
}

function ReviewNote({ pics }: { pics: Pictures | undefined }) {
  if (!pics?.policy?.moderation || abilities(pics).skip_review) return null;
  return <Note>New pictures are reviewed. Until an administrator approves this one, people keep seeing your current picture.</Note>;
}

function Footer({ left, busy, onClose, onSave, saveLabel, canSave }: { left: string; busy: boolean; onClose: () => void; onSave: () => void; saveLabel: string; canSave: boolean }) {
  return (
    <div className="flex items-center gap-2 border-t border-line bg-[#FAFBFD] px-6 py-3.5 dark:bg-well">
      <span className="min-w-0 flex-1 text-[12px] text-ink-3">{left}</span>
      <button type="button" className={btn} disabled={busy} onClick={onClose}>
        Cancel
      </button>
      <button type="button" className={btnPrimary} disabled={!canSave || busy} onClick={onSave}>
        {busy ? 'Saving…' : saveLabel}
      </button>
    </div>
  );
}

function PhotoTab({ pics, busy, setBusy, onClose, onPick }: { pics: Pictures | undefined; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; onPick?: PickPicture }) {
  const me = useMe();
  const saved = useSaved(onClose);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [failed, setFailed] = useState(false);
  const [over, setOver] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; scale: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      setUrl(u);
      setImg(i);
      setCrop(initial(i.naturalWidth, i.naturalHeight, STAGE));
    };
    i.onerror = () => setFailed(true);
    i.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const choose = (f: File | null | undefined) => {
    if (!f) return;
    const why = refusal(f, pics?.limits);
    if (why) return void toast('error', why);
    setFailed(false);
    setImg(null);
    setCrop(null);
    setFile(f);
  };

  const w = img?.naturalWidth ?? 1;
  const h = img?.naturalHeight ?? 1;
  const set = (c: Crop) => setCrop(clamp(c, w, h, STAGE));
  const min = crop ? minScale(w, h, crop.rotation, STAGE) : 1;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && crop) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: crop.scale };
    }
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const was = pointers.current.get(e.pointerId);
    if (!was || !crop) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      return set({ ...crop, scale: pinch.current.scale * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.current.d) });
    }
    set({ ...crop, x: crop.x + (e.clientX - was.x), y: crop.y + (e.clientY - was.y) });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const wheel = (e: WheelEvent<HTMLDivElement>) => crop && set({ ...crop, scale: crop.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06) });
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!crop) return;
    const step = e.shiftKey ? 20 : 5;
    const moves: Record<string, Partial<Crop>> = {
      ArrowLeft: { x: crop.x - step },
      ArrowRight: { x: crop.x + step },
      ArrowUp: { y: crop.y - step },
      ArrowDown: { y: crop.y + step },
      '+': { scale: crop.scale * 1.06 },
      '=': { scale: crop.scale * 1.06 },
      '-': { scale: crop.scale / 1.06 },
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      set({ ...crop, ...m });
    }
  };
  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    choose(e.dataTransfer.files?.[0]);
  };

  const save = async () => {
    if (!img || !crop || !file) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This computer could not draw the picture.');
      // The same kind of file as was chosen, so an installation that allows only some types refuses exactly what it says.
      const as = exportType(file.type);
      draw(ctx, img, w, h, crop, STAGE, OUT, as === 'image/jpeg' ? '#ffffff' : undefined);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, as, 0.92));
      if (!blob) throw new Error('This computer could not draw the picture.');
      if (onPick) {
        onPick(blob);
        onClose();
      } else await saved(await sendPicture(blob), 'Profile picture');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const view = (k: number) =>
    crop && img && url ? <img src={url} alt="" draggable={false} style={{ width: w, height: h, transform: transform(crop, k), maxWidth: 'none' }} className="pointer-events-none absolute top-1/2 left-1/2 origin-center select-none" /> : null;
  const limits = pics?.limits;
  const types = typeList(limits?.types ?? ['jpg', 'png', 'webp']);

  return (
    <>
      <input ref={input} type="file" hidden accept={acceptList(limits)} data-testid="picture-input" onChange={(e) => (choose(e.target.files?.[0]), (e.target.value = ''))} />
      <div className="flex min-h-0 gap-6 overflow-y-auto px-6 py-5 scroll-thin">
        <div className="flex shrink-0 flex-col items-center gap-3" style={{ width: STAGE + 80 }}>
          {!file || failed ? (
            <div
              onDragOver={(e) => (e.preventDefault(), setOver(true))}
              onDragLeave={() => setOver(false)}
              onDrop={drop}
              className={cx('flex flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed text-center', over ? 'border-primary bg-selection' : 'border-line bg-well')}
              style={{ width: STAGE + 80, height: STAGE + 40 }}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-primary shadow-[0_1px_3px_rgb(var(--ws-shadow-rgb)/.12)]">
                <Icon name="upload" size={20} />
              </span>
              <b className="text-[14px] text-ink">{failed ? 'That file could not be opened as a picture' : 'Drag a photo here'}</b>
              <span className="max-w-[260px] text-[12.5px] text-ink-3">{failed ? `Try a ${types}.` : 'A clear photo of your face works best. You can move and zoom it next.'}</span>
              <button type="button" className={btnPrimary} onClick={() => input.current?.click()}>
                Choose a file
              </button>
            </div>
          ) : (
            <>
              <div
                role="application"
                aria-label="Crop area. Drag to move, scroll to zoom; arrow keys move, plus and minus zoom."
                tabIndex={0}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onWheel={wheel}
                onKeyDown={key}
                style={{ width: STAGE + 80, height: STAGE + 40, touchAction: 'none' }}
                className="relative cursor-grab overflow-hidden rounded-[14px] bg-[#0F1830] outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
              >
                <div className="absolute overflow-visible" style={{ width: STAGE, height: STAGE, left: 40, top: 20 }}>
                  {view(1)}
                </div>
                {!crop ? <span aria-hidden className="absolute inset-0 animate-pulse bg-[#1a2440]" /> : null}
                <span aria-hidden className="pointer-events-none absolute rounded-full ring-2 ring-white/85" style={{ width: STAGE, height: STAGE, left: 40, top: 20, boxShadow: '0 0 0 9999px rgba(15,24,48,.62)' }} />
                <span aria-hidden className="pointer-events-none absolute right-0 bottom-2 left-0 text-center text-[11.5px] font-semibold text-white/80">
                  Drag to move · scroll to zoom
                </span>
              </div>
              <div className="flex w-full items-center gap-2 px-1">
                <Icon name="zoom-out" size={16} className="shrink-0 text-ink-3" />
                <input type="range" aria-label="Zoom" min={min} max={min * MAX_ZOOM} step={min / 100} value={crop?.scale ?? min} disabled={!crop} onChange={(e) => crop && set({ ...crop, scale: Number(e.target.value) })} className="h-1.5 w-full cursor-pointer accent-primary" />
                <Icon name="zoom-in" size={16} className="shrink-0 text-ink-3" />
                <button type="button" aria-label="Rotate left" title="Rotate left" disabled={!crop} onClick={() => crop && setCrop(rotate(crop, -1, w, h, STAGE))} className="ml-2 flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
                  <Icon name="undo" size={15} />
                </button>
                <button type="button" aria-label="Rotate right" title="Rotate right" disabled={!crop} onClick={() => crop && setCrop(rotate(crop, 1, w, h, STAGE))} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
                  <Icon name="rotate-cw" size={15} />
                </button>
              </div>
              <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => input.current?.click()}>
                Choose another file
              </button>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[11.5px] font-bold tracking-[.3px] text-ink-3 uppercase">Preview</span>
            <div className="flex items-end gap-3 rounded-[12px] bg-well p-3">
              {[96, 48, 32].map((px) => (
                <span key={px} className="relative block overflow-hidden rounded-full bg-subtle ring-1 ring-line" style={{ width: px, height: px }}>
                  {view(px / STAGE)}
                </span>
              ))}
            </div>
            <div className="flex items-start gap-2.5 rounded-[12px] bg-[#F3F1EC] p-3 dark:bg-well">
              <span className="relative block shrink-0 overflow-hidden rounded-full bg-subtle" style={{ width: 32, height: 32 }}>
                {view(32 / STAGE)}
              </span>
              <div className="min-w-0 rounded-[10px] bg-surface px-3 py-2 shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.08)]">
                <div className="flex items-baseline gap-2">
                  <b className="truncate text-[12.5px] text-ink">{me?.name}</b>
                  <span className="text-[11px] text-ink-3">{timeLabel(new Date().toISOString())}</span>
                </div>
                <span className="text-[12.5px] text-ink-2">How it looks in chat</span>
              </div>
            </div>
          </div>
          {pics?.visibility ? (
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
              Who sees it
              <VisibilitySelect value={pics.visibility} canEdit={abilities(pics).edit} />
            </label>
          ) : null}
          <ReviewNote pics={pics} />
        </div>
      </div>
      <Footer left={`${types} · up to ${Math.round((limits?.max_bytes ?? 8 * 1048576) / 1048576)} MB`} busy={busy} onClose={onClose} onSave={() => void save()} saveLabel={onPick ? 'Use photo' : 'Save photo'} canSave={!!crop && !failed} />
    </>
  );
}

const SKINS = Object.entries(TONES);
const BORDERS: Array<{ id: AvatarBorder; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'thin', label: 'Thin' },
  { id: 'bold', label: 'Bold' },
];

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit gap-1 rounded-[11px] bg-[#F1F3F8] p-1 dark:bg-subtle">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} onClick={() => onChange(o.id)} className={cx('h-[34px] rounded-[9px] px-3.5 text-[13px] font-bold whitespace-nowrap', o.id === value ? 'bg-surface text-primary shadow-[0_1px_3px_rgb(var(--ws-shadow-rgb)/.12)]' : 'text-ink-2 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AvatarTab({ pics, busy, setBusy, onClose, start, onPick }: { pics: Pictures | undefined; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; start: Partial<AvatarStyle> | null; onPick?: PickPicture }) {
  const me = useMe();
  const saved = useSaved(onClose);
  const [style, setStyle] = useState<AvatarStyle>(() => normalise(start ?? { look: pics?.policy?.default_look ?? 'initials' }, me?.name ?? ''));
  const set = (patch: Partial<AvatarStyle>) => setStyle((s) => normalise({ ...s, ...patch }, me?.name ?? ''));
  const src = svgUrl(avatarSvg(style, 360));

  const save = async () => {
    setBusy(true);
    try {
      const image = await avatarPng(style);
      if (onPick) {
        onPick(image, style);
        onClose();
      } else await saved(await sendPicture(image, style), 'Avatar');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const illustrated = style.look === 'illustrated';
  return (
    <>
      <div className="flex min-h-0 gap-6 overflow-y-auto px-6 py-5 scroll-thin">
        <div className="flex w-[300px] shrink-0 flex-col items-center gap-3 rounded-[14px] bg-well px-4 py-6">
          <img src={src} alt="Your avatar" width={180} height={180} className="rounded-full shadow-[0_8px_24px_rgb(var(--ws-shadow-rgb)/.18)]" />
          <div className="flex items-end gap-3">
            <img src={src} alt="" width={48} height={48} className="rounded-full" />
            <img src={src} alt="" width={32} height={32} className="rounded-full" />
          </div>
          <span className="text-[12px] text-ink-3">Made without uploading anything.</span>
          {style.look !== 'initials' ? (
            <button type="button" className={btn} onClick={() => set({ seed: Math.floor(Math.random() * 99_999) + 1 })}>
              <Icon name="dice" size={15} /> Shuffle
            </button>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink">Style</span>
            <Segmented label="Style" value={style.look} options={LOOKS.map((l) => ({ id: l.id, label: l.label }))} onChange={(look) => set({ look })} />
          </div>
          {!illustrated ? (
            <div className="flex items-end gap-3">
              <label className="flex flex-col gap-1 text-[12.5px] font-bold text-ink">
                Initials
                <input
                  aria-label="Initials"
                  value={style.initials}
                  maxLength={3}
                  onChange={(e) => set({ initials: e.target.value })}
                  className="h-[34px] w-[92px] rounded-[8px] border border-line bg-surface px-2.5 text-[14px] font-bold tracking-[1px] text-ink uppercase outline-none focus:border-primary"
                />
              </label>
              {style.look === 'abstract' ? (
                <label className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                  <input type="checkbox" checked={style.showInitials !== false} onChange={(e) => set({ showInitials: e.target.checked })} className="accent-primary" />
                  Show them over the pattern
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink">Background</span>
            <div role="radiogroup" aria-label="Background" className="grid w-fit grid-cols-[repeat(5,40px)] gap-2.5">
              {Object.entries(BACKGROUNDS).map(([id, b]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-label={b.label}
                  title={b.label}
                  aria-checked={style.background === id}
                  onClick={() => set({ background: id })}
                  className="h-10 w-10 rounded-full"
                  style={{ background: `linear-gradient(135deg, ${b.from}, ${b.to})`, boxShadow: style.background === id ? `0 0 0 3px var(--color-surface), 0 0 0 5px ${b.from}` : 'none' }}
                />
              ))}
            </div>
            <span className="text-[12px] text-ink-3">{BACKGROUNDS[style.background]?.label}</span>
          </div>
          <div className={cx('flex flex-col gap-1.5', !illustrated && 'opacity-45')}>
            <span className="text-[12.5px] font-bold text-ink">
              Skin tone <span className="font-medium text-ink-3">· for Illustrated</span>
            </span>
            <div role="radiogroup" aria-label="Skin tone" className="flex gap-2.5">
              {SKINS.map(([id, t]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-label={t.label}
                  title={t.label}
                  aria-checked={style.tone === id}
                  disabled={!illustrated}
                  onClick={() => set({ tone: id })}
                  className="h-[34px] w-[34px] rounded-full"
                  style={{ background: t.skin, boxShadow: style.tone === id && illustrated ? '0 0 0 3px var(--color-surface), 0 0 0 5px var(--color-primary)' : 'inset 0 0 0 1px rgba(0,0,0,.08)' }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink">Border</span>
            <Segmented label="Border" value={style.border} options={BORDERS} onChange={(border) => set({ border })} />
          </div>
          <ReviewNote pics={pics} />
        </div>
      </div>
      <Footer left="Saved avatars stay in Profile pictures, so you can switch back." busy={busy} onClose={onClose} onSave={() => void save()} saveLabel="Use avatar" canSave />
    </>
  );
}
