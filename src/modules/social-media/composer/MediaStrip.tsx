/**
 * W02 / D02 Create post — media (SMM-MED-001..004, SMM-CMP-015, SMM-DSK-003): pictures and videos come from Drive or
 * from this computer (the file picker, or a drop from the desktop onto the composer); uploads land in the brand's
 * Drive folder first, so media never live outside Drive. Each tile opens a small dialog for its alt text and crop.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { DriveFilePicker, type DriveFileRow } from '../../../components/DriveFilePicker';
import { Icon } from '../../../components/Icon';
import { Button, cx, Modal } from '../../../components/ui';
import { app } from '../../../core/app-state';
import { call, errorMessage, registerDropped } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import type { PostMedia } from '../api';
import { INPUT, MediaTile, NativeSelect, TEXTAREA } from '../parts';
import { kindOfName } from './state';

export const CROP_RATIOS = ['original', '1:1', '4:5', '1.91:1', '9:16', '16:9'] as const;

export function mediaFromDrive(f: DriveFileRow): PostMedia {
  return { file_id: Number(f.id), name: f.name, kind: kindOfName(f.name, f.extension), bytes: f.size };
}

/**
 * Adding media: Drive, the file input, or a drop. An upload is a transfer (the app's Transfers panel shows it); once it
 * is done and Drive has given it an id, it becomes a tile.
 */
export function useMediaSources(folderId: number | null, onAdd: (m: PostMedia[]) => void) {
  const [drive, setDrive] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const add = useRef(onAdd);
  useEffect(() => {
    add.current = onAdd;
  });
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    const check = () => {
      const waiting = pendingRef.current;
      const ids = Object.keys(waiting);
      if (!ids.length) return;
      const finished = app.get().transfers.filter((t) => ids.includes(t.id) && (t.state === 'done' || t.state === 'failed' || t.state === 'cancelled'));
      if (!finished.length) return;
      const done = finished.filter((t) => t.state === 'done' && t.fileId);
      if (done.length) add.current(done.map((t) => ({ file_id: Number(t.fileId), name: t.name, kind: kindOfName(t.name), bytes: t.total || null })));
      for (const t of finished) if (t.state === 'failed') toast('error', `${t.name} didn’t upload: ${t.error ?? 'the transfer failed'}.`);
      setPending((p) => {
        const next = { ...p };
        for (const t of finished) delete next[t.id];
        return next;
      });
    };
    // A transfer may have finished before its id was recorded: look once more, after this render.
    const once = setTimeout(check, 0);
    const off = app.subscribe(check);
    return () => {
      clearTimeout(once);
      off();
    };
  }, [pending]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    try {
      const handles = await registerDropped(files);
      if (!handles.length) {
        toast('info', 'Uploading from this computer needs WorkSuite Desktop.');
        return;
      }
      const started = await call('transfers:upload', { handles: handles.map((h) => h.handle), target: { kind: 'files', folderId: folderId !== null ? String(folderId) : null } });
      setPending((p) => ({ ...p, ...Object.fromEntries(started.map((t) => [t.id, t.name])) }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const picker = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        accept="image/*,video/*,application/pdf"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void upload(files);
        }}
      />
      {drive ? (
        <DriveFilePicker
          title="Media from Drive"
          confirmLabel="Add"
          onClose={() => setDrive(false)}
          onChoose={(rows) => {
            setDrive(false);
            add.current(rows.map(mediaFromDrive));
          }}
        />
      ) : null}
    </>
  );

  return {
    picker,
    uploading: Object.values(pending),
    openDrive: () => setDrive(true),
    openFiles: () => input.current?.click(),
    upload,
  };
}

/** The composer is a drop target for files from the desktop (DSK-003). */
export function useDrop(enabled: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const props = enabled
    ? {
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (e.currentTarget === e.target) setOver(false);
        },
        onDrop: (e: DragEvent) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setOver(false);
          onFiles(Array.from(e.dataTransfer.files));
        },
      }
    : {};
  return { over: enabled && over, props };
}

export function MediaStrip({ media, uploading, readOnly, onChange, onAdd, onEdit }: { media: PostMedia[]; uploading: string[]; readOnly?: boolean; onChange: (m: PostMedia[]) => void; onAdd: () => void; onEdit: (index: number) => void }) {
  if (!media.length && !uploading.length && readOnly) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Media">
      {media.map((m, i) => (
        <div key={`${m.file_id}-${i}`} className="relative">
          <button type="button" onClick={() => onEdit(i)} disabled={readOnly} aria-label={`${m.name}: alt text and crop`} className="block rounded-[10px] focus-visible:outline-2 focus-visible:outline-primary">
            <MediaTile media={m} className="h-[86px] w-[72px]" />
          </button>
          {m.crop ? <span className="absolute top-1 left-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">{m.crop.ratio}</span> : null}
          {m.kind === 'image' && !m.alt_text?.trim() ? <span className="absolute right-1 bottom-1 rounded bg-warning-bg px-1 text-[10px] font-semibold text-warning">No alt</span> : null}
          {!readOnly ? (
            <button type="button" aria-label={`Remove ${m.name}`} onClick={() => onChange(media.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-ink-3 hover:text-danger">
              <Icon name="x" size={11} />
            </button>
          ) : null}
        </div>
      ))}
      {uploading.map((name, i) => (
        <div key={`up-${i}`} className="flex h-[86px] w-[72px] flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line bg-subtle p-1 text-center text-[10.5px] text-ink-3" title={name}>
          <Icon name="upload" size={15} />
          <span className="line-clamp-2 break-all">Uploading {name}</span>
        </div>
      ))}
      {!readOnly ? (
        <button type="button" onClick={onAdd} className="flex h-[86px] w-[72px] flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line text-[12px] font-semibold text-ink-3 hover:border-primary hover:text-primary">
          <Icon name="plus" size={16} />
          Add
        </button>
      ) : null}
    </div>
  );
}

/** Alt text (CMP-015) and the crop the networks get (MED-003). */
export function MediaDialog({ media, aiEnabled, onAltAi, onSave, onClose }: { media: PostMedia; aiEnabled: boolean; onAltAi: () => void; onSave: (m: PostMedia) => void; onClose: () => void }) {
  const [alt, setAlt] = useState(media.alt_text ?? '');
  const [crop, setCrop] = useState(media.crop?.ratio ?? 'original');
  return (
    <Modal
      title={media.name}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave({ ...media, alt_text: alt.trim() || null, crop: crop === 'original' ? null : { ratio: crop } })}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <MediaTile media={media} className="h-[120px] w-[100px] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Alt text</span>
            <textarea className={cx(TEXTAREA, 'min-h-[72px]')} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the picture for people who can’t see it" />
          </label>
          {aiEnabled && media.kind === 'image' ? (
            <Button size="sm" variant="ghost" icon="sparkles" onClick={onAltAi} className="self-start">
              Suggest alt text
            </Button>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Crop</span>
            <NativeSelect label="Crop ratio" value={crop} onChange={setCrop} className={INPUT}>
              {CROP_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r === 'original' ? 'Original shape' : r}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      </div>
    </Modal>
  );
}
