import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { UploadTarget } from '@shared/ipc/contract';
import { app } from '../../core/app-state';
import { call, errorMessage, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
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
  const [ids, setIds] = useState<string[]>([]);
  // Each finished upload is reported once; the list of ids started here only grows.
  const handled = useRef(new Set<string>());
  const mine = useMemo(() => transfers.filter((t) => ids.includes(t.id)), [transfers, ids]);
  const live = mine.filter((t) => t.state !== 'done' && t.state !== 'cancelled' && t.state !== 'failed');
  const ended = useMemo(() => mine.filter((t) => t.state === 'done' || t.state === 'cancelled' || t.state === 'failed'), [mine]);
  useEffect(() => {
    const fresh = ended.filter((t) => !handled.current.has(t.id));
    if (!fresh.length) return;
    for (const t of fresh) {
      handled.current.add(t.id);
      if (t.state === 'failed') toast('error', `${t.name}: ${t.error ?? 'it could not be filed.'}`);
    }
    onSettled();
  }, [ended, onSettled]);
  const pick = async (target: TenderTarget, title: string, multiple = false) => {
    try {
      const files = await call('files:pickFiles', { multiple, title: title.slice(0, 100) });
      if (!files.length) return;
      const out = await call('transfers:upload', { handles: files.map((f) => f.handle), target: { kind: 'tender', tenderId, ...target } });
      setIds((x) => [...x, ...out.map((o) => o.id)]);
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
      const out = await call('transfers:upload', { handles: handles.map((f) => f.handle), target: { kind: 'tender', tenderId, ...target } });
      setIds((x) => [...x, ...out.map((o) => o.id)]);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return { live, pick, drop };
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

/** "Attach" with its two sources: this computer, or a file already in Drive. */
export function AttachMenu({ label = 'Attach', disabled, onComputer, onDrive, small }: { label?: string; disabled?: boolean; onComputer: () => void; onDrive: (files: DriveFileRow[]) => Promise<void>; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [drive, setDrive] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'inline-flex shrink-0 items-center gap-1 rounded-[7px] border border-line bg-surface font-semibold whitespace-nowrap text-ink hover:bg-subtle disabled:opacity-50',
          small ? 'h-7 px-2 text-[12px]' : 'h-[30px] px-2.5 text-[12.5px]',
        )}
      >
        <Icon name="paperclip" size={13} /> {label}
      </button>
      {open ? (
        <>
          <span className="fixed inset-0 z-30" onMouseDown={() => setOpen(false)} />
          <span role="menu" className="absolute top-full right-0 z-40 mt-1 flex w-[190px] flex-col rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.18)]">
            <button type="button" role="menuitem" onClick={() => (setOpen(false), onComputer())} className="flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-subtle">
              <Icon name="upload" size={14} className="text-ink-3" /> From this computer…
            </button>
            <button type="button" role="menuitem" onClick={() => (setOpen(false), setDrive(true))} className="flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-subtle">
              <Icon name="folder" size={14} className="text-ink-3" /> From Drive…
            </button>
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

/** Downloads a tender's file through the transfer manager, and opens it when asked. */
export async function saveTenderFile(source: Source, name: string, open = false) {
  try {
    await call('transfers:download', { ...source, name: name.replace(/[/\\]/g, '-').slice(0, 255) || 'document', open });
    toast('success', open ? `Opening ${name}…` : `Saving ${name} to your downloads.`);
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/** The uploads still going, as a line under whatever started them. */
export function Uploading({ live }: { live: Array<{ id: string; name: string; bytes: number; total: number }> }) {
  if (!live.length) return null;
  return (
    <div className="flex flex-col gap-1" aria-label="Uploading">
      {live.map((t) => (
        <span key={t.id} className="flex items-center gap-2 text-[12px] text-ink-2">
          <Icon name="upload" size={12} className="text-primary" />
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
          <span className="tabular-nums">{t.total ? Math.round((t.bytes / t.total) * 100) : 0}%</span>
        </span>
      ))}
    </div>
  );
}
