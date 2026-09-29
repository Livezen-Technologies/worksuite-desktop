import { useState, type DragEvent, type ReactNode } from 'react';
import { apiUrl } from '../../../core/api';
import { bytes } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { FileBadge, cx } from '../../../components/ui';
import { CameraCapture } from '../../chat/attach';
import { MAX_UPLOAD_BYTES, mediaPath, OFFLINE_WRITE, refusalOf, tempId, uploadMedia, type Media } from '../api';

/**
 * Files onto a job: dropped on the window from this computer, chosen with the
 * file picker, or taken with the camera. Each goes up on its own with a
 * `client_temp_id`, so a second press after a dropped connection is the same
 * file. The server sniffs the type from the bytes and keeps it in WorkSuite
 * Files; every file arrives internal, and only someone who may publish media
 * shows one to the customer.
 */
export interface UploadMeta {
  context: string;
  /** The item, diagnostic or work order the file is of (`inspection`, `diagnostic`, `work_order` contexts). */
  context_id?: number | null;
  slot?: string | null;
  caption?: string | null;
}

export function useJobUpload(jobId: number, online: boolean, onDone: () => void) {
  const [busy, setBusy] = useState(0);
  const send = async (files: Array<{ blob: Blob; name: string }>, meta: UploadMeta) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    const ok = files.filter((f) => {
      if (f.blob.size <= MAX_UPLOAD_BYTES) return true;
      toast('error', `${f.name} is ${bytes(f.blob.size)}; the desktop sends up to ${bytes(MAX_UPLOAD_BYTES)} at a time. Add it from the web or the phone.`);
      return false;
    });
    if (!ok.length) return;
    setBusy((n) => n + ok.length);
    let sent = 0;
    for (const f of ok) {
      try {
        await uploadMedia(jobId, f.blob, f.name, { ...meta, clientTempId: tempId() });
        sent++;
      } catch (e) {
        toast('error', `${f.name}: ${refusalOf(e).message}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (sent) {
      toast('success', sent === 1 ? `${ok.length === 1 ? ok[0]!.name : 'A file'} added.` : `${sent} files added.`);
      onDone();
    }
  };
  return { busy, send };
}

/** A place files can be dropped on: highlighted while files are over it, quiet when it may not take them. */
export function DropZone({ enabled, onFiles, children, className, label }: { enabled: boolean; onFiles: (files: File[]) => void; children: ReactNode; className?: string; label: string }) {
  const [over, setOver] = useState(false);
  const props = enabled
    ? {
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
      }
    : {};
  return (
    <div aria-label={label} {...props} className={cx(className, over && 'ring-2 ring-primary ring-offset-1')}>
      {children}
    </div>
  );
}

/** "Choose files…" and "Camera", beside a drop zone. */
export function AddFiles({ disabled, accept, onFiles, onPhoto, label = 'Choose files…', small }: { disabled: boolean; accept?: string; onFiles: (files: File[]) => void; onPhoto: (blob: Blob, name: string) => void; label?: string; small?: boolean }) {
  const [camera, setCamera] = useState(false);
  const cls = cx('inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border border-line bg-surface font-semibold whitespace-nowrap text-ink hover:bg-subtle', small ? 'h-[28px] px-2 text-[12px]' : 'h-[30px] px-2.5 text-[12.5px]', disabled && 'pointer-events-none opacity-50');
  return (
    <>
      <label className={cls}>
        <Icon name="upload" size={14} /> {label}
        <input
          type="file"
          hidden
          multiple
          disabled={disabled}
          accept={accept}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onFiles(files);
          }}
        />
      </label>
      <button type="button" className={cls} disabled={disabled} onClick={() => setCamera(true)}>
        <Icon name="camera" size={14} /> Camera
      </button>
      {camera ? <CameraCapture onTaken={onPhoto} onClose={() => setCamera(false)} /> : null}
    </>
  );
}

/** A photo as a thumbnail (read through the proxy), anything else as its badge. */
export function Thumb({ m, size = 88, onOpen }: { m: Media; size?: number; onOpen?: () => void }) {
  const name = m.name ?? `${m.kind}-${m.id}`;
  return (
    <button type="button" onClick={onOpen} title={`${name}${m.bytes ? ` · ${bytes(m.bytes)}` : ''}`} className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-line bg-subtle" style={{ width: size, height: size }}>
      {m.kind === 'photo' ? <img src={apiUrl(mediaPath(m))} alt={m.caption ?? name} loading="lazy" className="h-full w-full object-cover" /> : <FileBadge name={name} size={Math.round(size * 0.45)} />}
      {m.visibility === 'customer' ? (
        <span className="absolute right-1 bottom-1 rounded-[5px] bg-[#145C39] px-1 text-[9.5px] font-bold text-white" title="The customer can see this">
          Customer
        </span>
      ) : null}
    </button>
  );
}
