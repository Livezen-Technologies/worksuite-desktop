import { isOfficeFile, openInOffice } from '../../core/open-document';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { UploadTarget } from '@shared/ipc/contract';
import type { Transfer } from '@shared/types';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { call, errorMessage, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { bytes } from '../../core/time';
import { uploadPercent } from '@shared/uploads';
import { DriveFilePicker, type DriveFileRow } from '../../components/DriveFilePicker';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * Files onto a tender: from this computer, through the transfer manager —
 * which stores the file in Drive and then files it where it was asked (a
 * document, a checklist line, a replacement, a bond) — or straight from
 * Drive. A filing the server refuses (the same file that was sent back, a
 * file that is not yours to attach) is said, by name.
 */
type TenderTarget = Omit<Extract<UploadTarget, { kind: 'tender' }>, 'kind' | 'tenderId'>;

export function useTenderUploads(tenderId: number, onSettled: () => void) {
  const transfers = useStore(app, (s) => s.transfers);
  // This tender's uploads, from the transfer manager itself (#249): they show the moment they are asked for,
  // keep showing after the tab is left and opened again, and after WorkSuite restarts mid-upload.
  const mine = useMemo(() => transfers.filter((t) => t.direction === 'upload' && t.tender?.tenderId === tenderId), [transfers, tenderId]);
  const live: LiveUpload[] = mine
    .filter((t) => t.state !== 'done' && t.state !== 'cancelled')
    .map((t) => {
      const { tenderId: _tender, ...target } = t.tender!;
      return { ...t, target };
    });
  const ended = useMemo(() => mine.filter((t) => t.state === 'done' || t.state === 'cancelled' || t.state === 'failed'), [mine]);
  // Each finished upload is reported once. What had already ended before this screen opened is not news.
  const handled = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (handled.current === null) {
      handled.current = new Set(ended.map((t) => t.id));
      return;
    }
    const seen = handled.current;
    const fresh = ended.filter((t) => !seen.has(t.id));
    if (!fresh.length) return;
    for (const t of fresh) {
      seen.add(t.id);
      if (t.state === 'failed') toast('error', `${t.name}: ${t.error ?? 'it could not be filed.'}`);
    }
    onSettled();
  }, [ended, onSettled]);
  const pick = async (target: TenderTarget, title: string, multiple = false) => {
    try {
      const files = await call('files:pickFiles', { multiple, title: title.slice(0, 100) });
      if (!files.length) return;
      await call('transfers:upload', { handles: files.map((f) => f.handle), target: { kind: 'tender', tenderId, ...target } });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  /** Files dropped on the window from the desktop: registered by the main process, then sent the same way. */
  const drop = async (files: File[], target: TenderTarget) => {
    if (!files.length) return;
    try {
      const handles = await registerDropped(files);
      if (!handles.length) return;
      await call('transfers:upload', { handles: handles.map((f) => f.handle), target: { kind: 'tender', tenderId, ...target } });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return { live, pick, drop };
}

export type LiveUpload = Transfer & { target: TenderTarget };

/** The uploads going to one place — a checklist line, a bond — for it to show under itself. */
export function uploadsFor(live: LiveUpload[], into: TenderTarget['into'], id: number): LiveUpload[] {
  return live.filter((t) => t.target.into === into && 'id' in t.target && t.target.id === id);
}

/** A place files can be dropped on: highlighted while something is over it, and quiet when it is not allowed. */
export function useDropZone(enabled: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  if (!enabled) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}

const MENU = { width: 190, height: 76, gap: 4, margin: 8 };

/** Where the Attach menu goes for a button at `r`: right-aligned under it, or above it when there is no room below. */
export function menuPlace(r: { top: number; bottom: number; right: number }, view: { width: number; height: number }): { top: number; left: number } {
  const below = r.bottom + MENU.gap;
  const top = below + MENU.height + MENU.margin <= view.height ? below : Math.max(MENU.margin, r.top - MENU.gap - MENU.height);
  const left = Math.min(Math.max(MENU.margin, r.right - MENU.width), view.width - MENU.width - MENU.margin);
  return { top, left };
}

/** "Attach" with its two sources: this computer, or a file already in Drive. */
export function AttachMenu({ label = 'Attach', disabled, onComputer, onDrive, small }: { label?: string; disabled?: boolean; onComputer: () => void; onDrive: (files: DriveFileRow[]) => Promise<void>; small?: boolean }) {
  // Where the menu opens, against the window: under the button, or above it when the window ends first —
  // inside a card it was cut off at the card's edge on the last lines.
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const [drive, setDrive] = useState(false);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  const toggle = () => {
    if (open) return setOpen(null);
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    setOpen(menuPlace(r, { width: window.innerWidth, height: window.innerHeight }));
  };
  // "From Drive" browses Files: only for whoever has it.
  const files = useCanOpen('files');
  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={toggle}
        className={cx(
          'inline-flex shrink-0 items-center gap-1 rounded-[7px] border border-line bg-surface font-semibold whitespace-nowrap text-ink hover:bg-subtle disabled:opacity-50',
          small ? 'h-7 px-2 text-[12px]' : 'h-[30px] px-2.5 text-[12.5px]',
        )}
      >
        <Icon name="paperclip" size={13} /> {label}
      </button>
      {open ? (
        <>
          <span className="fixed inset-0 z-30" onMouseDown={() => setOpen(null)} />
          <span role="menu" style={{ top: open.top, left: open.left, width: MENU.width }} className="fixed z-40 flex flex-col rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.18)]">
            <button type="button" role="menuitem" onClick={() => (setOpen(null), onComputer())} className="flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-subtle">
              <Icon name="upload" size={14} className="text-ink-3" /> From this computer…
            </button>
            {files ? (
              <button type="button" role="menuitem" onClick={() => (setOpen(null), setDrive(true))} className="flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-subtle">
                <Icon name="folder" size={14} className="text-ink-3" /> From Drive…
              </button>
            ) : null}
          </span>
        </>
      ) : null}
      {drive ? (
        <DriveFilePicker
          title="Attach from Drive"
          confirmLabel="Attach"
          busy={busy}
          onChoose={(f) => {
            setBusy(true);
            void onDrive(f).finally(() => (setBusy(false), setDrive(false)));
          }}
          onClose={() => setDrive(false)}
        />
      ) : null}
    </span>
  );
}

type Source = { tenderDocument: number } | { tenderLine: { line: number; version?: number } } | { tenderLetter: { tender: number; letter: number } } | { tenderLibrary: number };

/** Where this server serves a tender's file (the same paths the download manager fetches). */
export function tenderFilePath(source: Source): string {
  if ('tenderDocument' in source) return `/api/tenders/documents/${source.tenderDocument}/file`;
  if ('tenderLine' in source) return `/api/tenders/checklist/${source.tenderLine.line}/download${source.tenderLine.version ? `?v=${source.tenderLine.version}` : ''}`;
  if ('tenderLetter' in source) return `/api/tenders/${source.tenderLetter.tender}/letters/${source.tenderLetter.letter}/download`;
  return `/api/tender/library/${source.tenderLibrary}/file`;
}

/**
 * Downloads a tender's file through the transfer manager, and opens it when asked: a Word, Excel or PowerPoint
 * file in a WorkSuite DOC / Sheet / Slides tab, anything else as the download manager opens it (PDFs in PDF Studio).
 */
export async function saveTenderFile(source: Source, name: string, open = false) {
  if (open && isOfficeFile(name)) return openInOffice({ kind: 'api', path: tenderFilePath(source), name });
  try {
    await call('transfers:download', { ...source, name: name.replace(/[/\\]/g, '-').slice(0, 255) || 'document', open });
    toast('success', open ? `Opening ${name}…` : `Saving ${name} to your downloads.`);
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/**
 * Where an upload is, in words: waiting its turn, getting ready (checked and announced), "Uploading 42%",
 * being filed — or paused, or failed, at the share it had reached.
 */
export function uploadStage(t: Pick<Transfer, 'state' | 'bytes' | 'total'> & { retryAt?: string | null }): { label: string; pct: number | null } {
  const reached = uploadPercent(t.bytes, t.total);
  if (t.state === 'failed') return { label: 'Failed', pct: reached };
  if (t.state === 'paused') return { label: `Paused ${reached}%`, pct: reached };
  if (t.state === 'queued') return t.retryAt ? { label: `Waiting ${reached}%`, pct: reached } : { label: 'Waiting…', pct: null };
  if (t.bytes <= 0) return { label: 'Preparing…', pct: null };
  if (t.total && t.bytes >= t.total) return { label: 'Filing…', pct: null };
  const pct = Math.min(99, reached);
  return { label: `Uploading ${pct}%`, pct };
}

/** One upload with its progress bar, and Cancel. */
export function UploadBar({ t }: { t: Transfer }) {
  const st = uploadStage(t);
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={`Uploading ${t.name}`}>
      <span className="flex items-center gap-2 text-[12px] text-ink-2">
        <Icon name="upload" size={12} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">{t.name}</span>
        <span className="shrink-0 text-ink-3 tabular-nums">{t.total ? `${bytes(t.bytes)} of ${bytes(t.total)}` : ''}</span>
        <b className={cx('w-[104px] shrink-0 text-right font-semibold tabular-nums', t.state === 'failed' ? 'text-danger' : 'text-ink')}>{st.label}</b>
        {t.state === 'failed' || t.state === 'paused' ? (
          <button type="button" aria-label={`${t.state === 'failed' ? 'Retry' : 'Resume'} uploading ${t.name}`} title={t.state === 'failed' ? 'Retry — continues from where it stopped' : 'Resume'} onClick={() => void call(t.state === 'failed' ? 'transfers:retry' : 'transfers:resume', { id: t.id }).catch((e) => toast('error', errorMessage(e)))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name={t.state === 'failed' ? 'refresh' : 'play'} size={12} />
          </button>
        ) : null}
        <button type="button" aria-label={`Cancel uploading ${t.name}`} title="Cancel" onClick={() => void call('transfers:cancel', { id: t.id }).catch(() => undefined)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={12} />
        </button>
      </span>
      {(t.state === 'failed' || t.state === 'paused' || t.retryAt) && t.error ? <span className={cx('text-[11.5px]', t.state === 'failed' ? 'text-danger' : 'text-warning')}>{t.error}</span> : null}
      <span
        role="progressbar"
        aria-label={`${t.name} upload`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={st.pct ?? undefined}
        aria-valuetext={st.label}
        className="relative h-1.5 overflow-hidden rounded-full bg-subtle"
      >
        {st.pct === null ? (
          <span className="absolute inset-y-0 w-1/3 rounded-full bg-primary/70 motion-safe:animate-[ws-indeterminate_1.2s_ease-in-out_infinite]" />
        ) : (
          <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300" style={{ width: `${st.pct}%` }} />
        )}
      </span>
    </div>
  );
}

/** The uploads still going, each with its bar, under whatever started them. */
export function Uploading({ live }: { live: Transfer[] }) {
  if (!live.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface px-3 py-2" aria-label="Uploading">
      {live.map((t) => (
        <UploadBar key={t.id} t={t} />
      ))}
    </div>
  );
}
