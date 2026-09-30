import { useState } from 'react';
import { Button, IconButton, Modal } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { bytes } from '../../../core/time';
import { CameraCapture } from '../../chat/attach';
import { errorText, gDelete, gPost, gUpload, MAX_UPLOAD, nice, OFFLINE, shrinkPhoto, when, type JobView, type MediaItem } from '../api';
import { ChooseFiles, DropZone, Section, Thumb, useGarage } from '../parts';

/**
 * A job's photos, videos and documents (FR-MED-01..03): dropped on the
 * window, chosen, or taken with the camera. Everything starts visible to
 * staff only; someone who may publish shows an item to the customer.
 * Whoever added a file, or may edit the job, takes it off.
 */
export default function MediaTab({ d, onChange }: { d: JobView; onChange: () => void }) {
  const g = useGarage();
  const [busy, setBusy] = useState(0);
  const [camera, setCamera] = useState(false);
  const [removing, setRemoving] = useState<MediaItem | null>(null);
  const media = d.media ?? [];
  const publish = d.can.publish ?? false;
  const open = d.job.status !== 'CANCELLED';

  const upload = async (files: Array<{ blob: Blob; name: string }>) => {
    if (!g.online) return toast('error', OFFLINE);
    let sent = 0;
    for (const f of files) {
      if (f.blob.size > MAX_UPLOAD) {
        toast('error', `${f.name} is ${bytes(f.blob.size)}; the desktop sends up to ${bytes(MAX_UPLOAD)} at a time. Add it from the web or a phone.`);
        continue;
      }
      setBusy((n) => n + 1);
      try {
        await gUpload(d.job.id, await shrinkPhoto(f.blob), f.name, { subject: 'job' });
        sent++;
      } catch (e) {
        toast('error', `${f.name}: ${errorText(e, 'not kept.')}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (sent) {
      toast('success', sent === 1 ? 'Added to the job.' : `${sent} files added to the job.`);
      onChange();
    }
  };

  const visibility = async (m: MediaItem) => {
    try {
      const r = await gPost(`/media/${m.id}/visibility`, { visibility: m.visibility === 'CUSTOMER' ? 'INTERNAL' : 'CUSTOMER' });
      toast('success', r.message);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  const remove = async (m: MediaItem) => {
    try {
      const r = await gDelete(`/media/${m.id}`);
      toast('success', r.message);
      setRemoving(null);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  const files = (fs: File[]) => void upload(fs.map((f) => ({ blob: f, name: f.name })));

  return (
    <DropZone enabled={open && g.online} onFiles={files} label="Photos, videos and documents">
      <Section
        title="Photos, videos and documents"
        action={
          open ? (
            <span className="flex items-center gap-2">
              {busy > 0 ? <span className="text-[12px] text-ink-3">Sending {busy}…</span> : null}
              <ChooseFiles small disabled={!g.online} accept="image/*,video/*,application/pdf" label="Add…" onFiles={files} />
              <Button size="sm" variant="ghost" icon="camera" disabled={!g.online} onClick={() => setCamera(true)}>
                Camera
              </Button>
            </span>
          ) : null
        }
      >
        {media.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">Nothing yet. Drop files here. Everything starts visible to staff only; someone allowed to can show it to the customer.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {media.map((m) => (
              <li key={m.id} className="rounded-[10px] border border-line p-2">
                <Thumb id={m.id} mime={m.mime} alt={m.caption ?? m.slot ?? 'photo'} className="aspect-video w-full" />
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <span className="min-w-0 truncate text-[11px] text-ink-3" title={`${nice(m.slot) || nice(m.subject_type)} · ${m.by ?? ''} · ${when(m.at)}`}>
                    {nice(m.slot) || nice(m.subject_type)} · {m.by ?? '—'}
                  </span>
                  <span className="flex items-center">
                    {publish ? (
                      <IconButton
                        icon="eye"
                        size={15}
                        active={m.visibility === 'CUSTOMER'}
                        disabled={!g.online}
                        label={m.visibility === 'CUSTOMER' ? 'Visible to the customer — make it staff only' : 'Staff only — show it to the customer'}
                        onClick={() => void visibility(m)}
                      />
                    ) : m.visibility === 'CUSTOMER' ? (
                      <span className="text-[10px] font-bold text-success">Customer</span>
                    ) : null}
                    <IconButton icon="trash" size={15} label="Remove" disabled={!g.online} onClick={() => setRemoving(m)} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {camera ? (
        <CameraCapture
          onTaken={(blob, name) => {
            setCamera(false);
            void upload([{ blob, name }]);
          }}
          onClose={() => setCamera(false)}
        />
      ) : null}
      {removing ? (
        <Modal
          title="Remove this file?"
          onClose={() => setRemoving(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Keep it
              </Button>
              <Button variant="danger" onClick={() => void remove(removing)}>
                Remove
              </Button>
            </div>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">It is taken off the job. A completed check-in's photos cannot be removed.</p>
        </Modal>
      ) : null}
    </DropZone>
  );
}
