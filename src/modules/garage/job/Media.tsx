import { useState } from 'react';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { FileViewer } from '../../../components/FileViewer';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Modal, Switch } from '../../../components/ui';
import { Panel } from '../../hr/parts';
import { mediaPath, OFFLINE_WRITE, refusalOf, removeMedia, setMediaVisibility, type Media as MediaRow } from '../api';
import type { JobTabProps } from '../registry';
import { AddFiles, DropZone, Thumb, useJobUpload } from './media-kit';

/**
 * Every file on the job (FR-MED): check-in, inspection and repair photos,
 * videos and documents. Files arrive internal; someone who may publish media
 * shows one to the customer (audited on the server). Drop files on the list,
 * choose them, or take a photo; a finished job takes no more files.
 */
export default function Media({ job, company, options, online, onChanged }: JobTabProps) {
  const [context, setContext] = useState('other');
  const [open, setOpen] = useState<MediaRow | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const me = useStore(app, (s) => s.auth?.user?.id ?? null);
  const upload = useJobUpload(job.id, online, () => onChanged());
  const finished = job.status === 'completed' || job.status === 'cancelled';
  const mayAdd = !finished && !!(company?.can.edit || company?.can.work || company?.can.checkin);
  const mayPublish = job.can.publish_media;
  const byContext = Object.entries(options.media_contexts)
    .map(([k, label]) => ({ k, label, rows: job.media.filter((m) => m.context === k) }))
    .filter((g) => g.rows.length);

  const act = async (id: number, fn: () => Promise<unknown>, done: string) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(id);
    try {
      await fn();
      toast('success', done);
      onChanged();
    } catch (e) {
      toast('error', refusalOf(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropZone label="Job files" enabled={mayAdd && online} onFiles={(files) => void upload.send(files.map((f) => ({ blob: f, name: f.name })), { context })} className="flex flex-col gap-3 rounded-[12px]">
      {mayAdd ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-dashed border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-ink-2">
          <Icon name="upload" size={16} className="text-ink-3" />
          <span className="flex-1">{upload.busy ? `Sending ${upload.busy}…` : 'Drop photos, videos or PDFs here, or'}</span>
          <Select aria-label="What the files are of" value={context} onValueChange={setContext} options={Object.entries(options.media_contexts).map(([value, label]) => ({ value, label }))} />
          <AddFiles disabled={!online || !!upload.busy} accept="image/*,video/*,application/pdf" onFiles={(files) => void upload.send(files.map((f) => ({ blob: f, name: f.name })), { context })} onPhoto={(blob, name) => void upload.send([{ blob, name }], { context })} />
        </div>
      ) : null}
      {!job.media.length ? <p className="m-0 px-1 text-[12.5px] text-ink-3">No files on this job yet.</p> : null}
      {byContext.map((g) => (
        <Panel key={g.k} title={g.label} sub={`${g.rows.length} ${g.rows.length === 1 ? 'file' : 'files'}`}>
          {g.rows.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 last:border-b-0">
              <Thumb m={m} size={52} onOpen={() => setOpen(m)} />
              <span className="flex min-w-0 flex-1 flex-col text-[12.5px]">
                <b className="truncate text-ink">{m.caption ?? m.name ?? `${m.kind} ${m.id}`}</b>
                <span className="truncate text-ink-3">{[m.slot ? (options.checkin.photo_slots[m.slot] ?? m.slot) : null, m.by?.name, m.created_at ? `${dateLabel(m.created_at)} ${timeLabel(m.created_at)}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              {mayPublish ? (
                <label className="flex shrink-0 items-center gap-2 text-[12px] text-ink-2">
                  Customer sees it
                  <Switch label={`Show ${m.name ?? 'the file'} to the customer`} checked={m.visibility === 'customer'} disabled={!online || busy === m.id} onChange={(v) => void act(m.id, () => setMediaVisibility(m.id, v ? 'customer' : 'internal'), v ? 'The customer can see it now.' : 'Internal again.')} />
                </label>
              ) : (
                <span className="shrink-0 text-[12px] text-ink-3">{m.visibility === 'customer' ? 'Customer sees it' : 'Internal'}</span>
              )}
              {!finished && (company?.can.edit || (me !== null && String(m.by?.id) === String(me))) && !(m.context === 'checkin' && job.status !== 'draft') ? (
                <button type="button" aria-label={`Remove ${m.name ?? 'the file'}`} disabled={!online || busy === m.id} onClick={() => void act(m.id, () => removeMedia(m.id), 'Removed from the job.')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-danger disabled:opacity-40">
                  <Icon name="trash" size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </Panel>
      ))}
      {open ? (
        <Modal title={open.caption ?? open.name ?? 'File'} width={960} onClose={() => setOpen(null)}>
          <div className="h-[68vh]">
            <FileViewer key={open.id} path={mediaPath(open)} name={open.name ?? `file-${open.id}`} />
          </div>
        </Modal>
      ) : null}
    </DropZone>
  );
}
