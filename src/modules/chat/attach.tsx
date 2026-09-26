import { useEffect, useRef, useState } from 'react';
import type { PickedFile } from '@shared/ipc/contract';
import type { Transfer } from '@shared/types';
import { ApiError, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { DriveFilePicker, type DriveFileRow } from '../../components/DriveFilePicker';
import { Button, FileBadge, Modal, cx } from '../../components/ui';

/** What the paperclip offers (ChatComposer, "Attach"). */
export type AttachChoice = 'document' | 'image' | 'video' | 'audio' | 'any' | 'drive' | 'camera' | 'voice';

const CHOICES: Array<{ id: AttachChoice; icon: string; label: string; hint: string; tone: string }> = [
  { id: 'document', icon: 'file-text', label: 'Document', hint: 'PDF, Word, Excel…', tone: 'bg-[#E6ECFF] text-[#23349E]' },
  { id: 'image', icon: 'file-image', label: 'Image', hint: 'PNG, JPG, GIF…', tone: 'bg-[#E3F4EC] text-[#1F7A4D]' },
  { id: 'video', icon: 'film', label: 'Video', hint: 'MP4, MOV, WEBM', tone: 'bg-[#F1E8FB] text-[#6B3FB5]' },
  { id: 'audio', icon: 'music', label: 'Audio', hint: 'MP3, WAV, OGG', tone: 'bg-[#FDEEDC] text-[#9A4A06]' },
  { id: 'any', icon: 'paperclip', label: 'Any file', hint: 'Browse everything', tone: 'bg-subtle text-ink-2' },
  { id: 'drive', icon: 'disk', label: 'From Drive', hint: 'Share from Drive', tone: 'bg-[#E1F2F4] text-[#0E7C86]' },
  { id: 'camera', icon: 'camera', label: 'Camera / Photo', hint: 'Take a picture', tone: 'bg-[#FCE7EF] text-[#B83280]' },
  { id: 'voice', icon: 'mic', label: 'Voice message', hint: 'Record and send', tone: 'bg-danger-bg text-danger' },
];

export function AttachMenu({ onPick, onClose, compact }: { onPick: (c: AttachChoice) => void; onClose: () => void; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  const move = (n: number) => {
    const next = (at + n + CHOICES.length) % CHOICES.length;
    setAt(next);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[next]?.focus();
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Attach"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
        else move(e.key === 'ArrowDown' ? 1 : -1);
      }}
      className={cx('absolute bottom-full left-0 z-40 mb-2 rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_12px_32px_rgba(15,27,61,.18)]', compact ? 'w-[230px]' : 'w-[264px]')}
    >
      {CHOICES.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="menuitem"
          tabIndex={i === at ? 0 : -1}
          onClick={() => onPick(c.id)}
          className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left outline-none hover:bg-subtle focus:bg-subtle"
        >
          <span className={cx('flex shrink-0 items-center justify-center rounded-[8px]', c.tone, compact ? 'h-7 w-7' : 'h-8 w-8')}>
            <Icon name={c.icon} size={compact ? 14 : 16} />
          </span>
          <span className="flex min-w-0 flex-col">
            <b className="text-[12.5px] text-ink">{c.label}</b>
            <span className="truncate text-[11.5px] text-ink-3">{c.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** A file waiting in the tray: one on disk (sent by the transfer manager) or one made here (a paste, a photo). */
export type Staged =
  | { key: string; kind: 'disk'; file: PickedFile; transfer: string | null }
  | { key: string; kind: 'blob'; blob: Blob; name: string; state: 'ready' | 'sending' | 'failed'; progress: number; error: string | null; extra: { caption?: string; replyTo?: number } | null };

export function stagedName(s: Staged): string {
  return s.kind === 'disk' ? s.file.name : s.name;
}

type Look = { label: string; tone: 'ready' | 'sending' | 'failed' | 'waiting'; progress: number | null; error: string | null };

function lookOf(s: Staged, t: Transfer | undefined): Look {
  if (s.kind === 'blob') {
    if (s.state === 'failed') return { label: 'Failed', tone: 'failed', progress: null, error: s.error };
    if (s.state === 'sending') return { label: `Sending… ${Math.round(s.progress * 100)}%`, tone: 'sending', progress: s.progress, error: null };
    return { label: 'Ready to send', tone: 'ready', progress: null, error: null };
  }
  if (!s.transfer) return { label: 'Ready to send', tone: 'ready', progress: null, error: null };
  if (!t || t.state === 'queued' || t.state === 'paused') return { label: 'Waiting', tone: 'waiting', progress: null, error: null };
  if (t.state === 'failed' || t.state === 'cancelled') return { label: t.state === 'cancelled' ? 'Cancelled' : 'Failed', tone: 'failed', progress: null, error: t.error };
  const p = t.total ? t.bytes / t.total : 0;
  return { label: `Sending… ${Math.round(p * 100)}%`, tone: 'sending', progress: p, error: null };
}

/** The files ready to send, each with how it is getting on (ChatComposer, "Files ready to send"). */
export function Tray({ items, transfers, onRemove, onRetry, compact }: { items: Staged[]; transfers: Transfer[]; onRemove: (s: Staged) => void; onRetry: (s: Staged) => void; compact?: boolean }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scroll-thin" role="list" aria-label="Files ready to send">
      {items.map((s) => {
        const t = s.kind === 'disk' && s.transfer ? transfers.find((x) => x.id === s.transfer) : undefined;
        const look = lookOf(s, t);
        const size = s.kind === 'disk' ? s.file.size : s.blob.size;
        return (
          <div key={s.key} role="listitem" className={cx('relative flex shrink-0 items-center gap-2 rounded-[10px] border bg-surface px-2.5 py-2', look.tone === 'failed' ? 'border-[#F1B8A8]' : 'border-line', compact ? 'w-[200px]' : 'w-[232px]')}>
            <FileBadge name={stagedName(s)} size={compact ? 28 : 32} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <b className="truncate text-[12px] text-ink" title={stagedName(s)}>{stagedName(s)}</b>
              <span className={cx('flex items-center gap-1 truncate text-[11px]', look.tone === 'failed' ? 'text-danger' : look.tone === 'sending' ? 'text-primary' : 'text-ink-3')} title={look.error ?? undefined}>
                {bytes(size)} · {look.label}
                {look.tone === 'failed' ? (
                  <>
                    {' · '}
                    <button type="button" aria-label={`Try sending ${stagedName(s)} again`} title="Try again" onClick={() => onRetry(s)} className="font-bold hover:underline">↻</button>
                  </>
                ) : null}
              </span>
              {look.progress !== null ? (
                <span className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-subtle" aria-hidden>
                  <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(look.progress * 100)}%` }} />
                </span>
              ) : null}
            </span>
            {look.tone !== 'sending' ? (
              <button type="button" aria-label={`Remove ${stagedName(s)}`} title="Remove" onClick={() => onRemove(s)} className="flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
                <Icon name="x" size={13} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** What the server says when somebody in the conversation could not open a Drive file. */
interface NeedsAccess {
  needs_access: true;
  people: Array<{ id: number; name: string }>;
  more: number;
  can_grant: boolean;
  can_link?: boolean;
  levels: Array<'view' | 'edit' | 'link'>;
  link_lifetimes?: number[];
}


const LIFETIME_LABEL: Record<number, string> = { 86400: '1 day', 604800: '7 days', 2592000: '30 days' };

/**
 * Share files from Drive into the conversation, each as a card. The server
 * first checks that everybody in the conversation can open the file; when
 * somebody cannot, sending stops at that file and the sender chooses: give
 * view or edit access, send a secure link, or cancel. It is never answered
 * for them, and files already sent stay sent.
 */
export function DrivePicker({ roomId, onClose, onSent }: { roomId: string; onClose: () => void; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<{ files: DriveFileRow[]; why: string; need: NeedsAccess } | null>(null);
  const [lifetime, setLifetime] = useState(604800);

  const sendAll = async (files: DriveFileRow[], grant?: 'view' | 'edit' | 'link', life?: number) => {
    let sent = 0;
    setBusy(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        try {
          const answer = i === 0 && grant ? { grant, ...(grant === 'link' ? { link_lifetime: life } : {}) } : {};
          await apiPost(`/api/drive/chat/share/file/${f.id}`, { room_id: Number(roomId), ...answer });
          sent++;
        } catch (e) {
          const need = e instanceof ApiError && e.status === 409 ? ((e.data as NeedsAccess | null) ?? null) : null;
          if (need?.needs_access) {
            const lifetimes = need.link_lifetimes?.length ? need.link_lifetimes : [604800];
            setLifetime(lifetimes.includes(604800) ? 604800 : lifetimes[0]!);
            setAsked({ files: files.slice(i), why: (e as Error).message, need });
            return;
          }
          toast('error', `“${f.name}” was not sent: ${errorMessage(e)}`);
        }
      }
      onClose();
    } finally {
      if (sent > 0) onSent();
      setBusy(false);
    }
  };

  if (asked) {
    const { need } = asked;
    const canLink = need.levels.includes('link');
    const lifetimes = need.link_lifetimes?.length ? need.link_lifetimes : [604800];
    return (
      <Modal
        title="Share from Drive"
        onClose={onClose}
        width={480}
        footer={
          <>
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            {canLink ? <Button onClick={() => void sendAll(asked.files, 'link', lifetime)} disabled={busy}>Send secure link</Button> : null}
            {need.levels.includes('view') ? <Button onClick={() => void sendAll(asked.files, 'view')} disabled={busy}>Grant view</Button> : null}
            {need.levels.includes('edit') ? <Button variant="primary" onClick={() => void sendAll(asked.files, 'edit')} disabled={busy}>Grant edit</Button> : null}
          </>
        }
      >
        <div role="alertdialog" aria-label="Somebody cannot open this file" className="flex flex-col gap-2.5 text-[13px]">
          <b className="text-ink">{asked.files[0]?.name}</b>
          <p className="text-ink">{asked.why}</p>
          <p className="text-[12.5px] text-ink-3">
            {need.can_grant
              ? canLink ? 'Nothing has been sent. Give them access, send a secure link, or cancel.' : 'Nothing has been sent. Give them access and send it, or cancel.'
              : canLink ? 'Nothing has been sent. You cannot give access to this yourself, but you can send a secure link.' : 'Nothing has been sent. You cannot give access to this yourself; ask somebody who can share it.'}
          </p>
          {canLink ? (
            <label className="flex items-center gap-2 rounded-[9px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">
              A secure link lasts
              <select value={lifetime} onChange={(e) => setLifetime(Number(e.target.value))} disabled={busy} className="rounded-[6px] border border-line bg-surface px-1.5 py-0.5 text-[12.5px] text-ink">
                {lifetimes.map((s) => <option key={s} value={s}>{LIFETIME_LABEL[s] ?? `${Math.round(s / 86400)} days`}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </Modal>
    );
  }

  return <DriveFilePicker title="Share from Drive" confirmLabel="Send" busy={busy} onChoose={(files) => void sendAll(files)} onClose={onClose} />;
}

/** Take a picture with the camera; it joins the tray like any other file. */
export function CameraCapture({ onTaken, onClose }: { onTaken: (blob: Blob, name: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'live' | 'taken' | 'failed'>('starting');
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const { granted } = await call('media:access', { kind: 'camera' });
        if (!granted) throw new Error('WorkSuite is not allowed to use the camera. Allow it in System Settings → Privacy & Security → Camera.');
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setState('live');
      } catch (e) {
        if (gone) return;
        setState('failed');
        toast('error', errorMessage(e));
      }
    })();
    return () => {
      gone = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      setShot({ blob: b, url: URL.createObjectURL(b) });
      setState('taken');
    }, 'image/jpeg', 0.9);
  };
  const use = () => {
    if (!shot) return;
    onTaken(shot.blob, `Photo ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}.jpg`);
    onClose();
  };

  return (
    <Modal
      title="Take a picture"
      onClose={onClose}
      width={600}
      footer={
        state === 'taken' ? (
          <>
            <Button onClick={() => (setShot(null), setState('live'))}>Retake</Button>
            <Button variant="primary" onClick={use}>Use photo</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="camera" disabled={state !== 'live'} onClick={take}>Take picture</Button>
          </>
        )
      }
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[10px] bg-[#0F1B3D]">
        <video ref={video} muted playsInline className={cx('h-full w-full -scale-x-100 object-cover', state === 'taken' && 'hidden')} aria-label="Camera preview" />
        {shot && state === 'taken' ? <img src={shot.url} alt="The picture taken" className="h-full w-full object-contain" /> : null}
        {state === 'starting' ? <span className="absolute text-[13px] text-white/80">Starting the camera…</span> : null}
        {state === 'failed' ? <span className="absolute px-6 text-center text-[13px] text-white/80">The camera could not start.</span> : null}
      </div>
    </Modal>
  );
}
