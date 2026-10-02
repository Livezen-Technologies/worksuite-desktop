import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { canOpenDesktopRoute, useVisibleIds } from '../../core/access';
import { call, errorMessage } from '../../core/bridge';
import { mediaToken, openDocument } from '../../core/open-document';
import { openRouteInWindow } from '../../core/tab-context';
import { bytes, dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Empty, ErrorNote, FileBadge, Modal, Spinner } from '../../components/ui';
import { DrivePicker } from '../chat/attach';
import { documentRoute, type SharedDocument } from './documents';

interface SharedFiles {
  files: SharedDocument[];
  media: SharedDocument[];
  drive?: SharedDocument[];
}

/** Uses the meeting's existing conversation. Drive grants are always explicit. */
export function MeetingFiles({ roomId, mayShare, onPresent }: { roomId: number | null; mayShare: boolean; onPresent: () => void }) {
  useVisibleIds(); // Re-evaluate editor actions when the organization changes app access.
  const [choosing, setChoosing] = useState(false);
  const q = useQuery({
    queryKey: ['chat', 'shared', String(roomId)],
    queryFn: ({ signal }) => apiGet<SharedFiles>(`/api/chat/rooms/${roomId}/shared`, undefined, signal),
    enabled: !!roomId,
    refetchInterval: 15_000,
  });
  if (!roomId) return <Empty icon="file" title="This meeting has no conversation to share files in" />;
  const files = q.isError ? [] : [...(q.data?.files ?? []), ...(q.data?.media ?? []), ...(q.data?.drive ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const open = (document: SharedDocument) => {
    const route = documentRoute(document);
    if (route) openRouteInWindow(route, document.card?.name ?? document.file?.filename);
    else if (document.file) {
      const token = mediaToken(document.file.download_url);
      if (token) void openDocument({ chatMedia: token }, document.file.filename);
    }
  };
  return (
    <div className="flex flex-col gap-2 p-3.5 text-[12.5px]">
      <Button icon="file" disabled={!mayShare} onClick={() => setChoosing(true)}>
        Share Document
      </Button>
      {!mayShare ? (
        <p role="status" className="text-ink-3">
          The host has restricted sharing in this meeting.
        </p>
      ) : null}
      <p className="text-ink-3">
        Documents open in a WorkSuite window while the meeting stays connected. Drive documents use their existing access and version history. Uploaded attachments are copies.
      </p>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error && !files.length ? <p className="text-ink-3">Nothing shared yet.</p> : null}
      {files.map((document) => {
        const card = document.card;
        const name = card?.name ?? document.file?.filename ?? 'Shared file';
        const route = documentRoute(document);
        const canOpen = route ? canOpenDesktopRoute(route) : !!document.file && !!mediaToken(document.file.download_url);
        return (
          <div key={document.message_id} className="flex flex-col gap-2 rounded-[9px] border border-line px-2.5 py-2">
            <div className="flex items-center gap-2.5">
              <FileBadge name={name} size={30} />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-ink">{name}</b>
                <span className="text-[11px] text-ink-3">
                  {bytes(card?.size ?? document.file?.size ?? 0)} · {document.sender_name} · {dateLabel(document.created_at)}
                </span>
              </span>
            </div>
            {card?.available === false ? (
              <p role="status" className="text-ink-3">
                {card.why ?? 'Ask the owner to give you access.'}
              </p>
            ) : null}
            {card?.kind === 'drive.link' ? <p className="text-ink-3">Open this secure link from the meeting chat.</p> : null}
            <div className="flex flex-wrap gap-1.5">
              {canOpen ? (
                <Button size="sm" onClick={() => open(document)}>
                  {route ? 'Open in WorkSuite' : 'Open file'}
                </Button>
              ) : null}
              {route && canOpen && mayShare ? (
                <Button
                  size="sm"
                  icon="screen-share"
                  onClick={() => void call('windows:open', { kind: 'record', route, title: name }).then(onPresent, (e) => toast('error', errorMessage(e)))}
                >
                  Present to Meeting…
                </Button>
              ) : null}
              {card?.kind === 'drive.file' && card.available === true && card.id && route?.startsWith('/office/') && canOpen ? (
                <Button
                  size="sm"
                  onClick={() =>
                    void call('office:openLocal', { fileId: card.id! }).then(
                      () => toast('info', 'External editing does not support live collaboration.'),
                      (e) => toast('error', errorMessage(e)),
                    )
                  }
                >
                  Open in Desktop App
                </Button>
              ) : null}
            </div>
            {route && !card ? <p className="text-[11px] text-ink-3">Attachment editing saves a separate copy; it does not co-edit the meeting attachment.</p> : null}
          </div>
        );
      })}
      {choosing && mayShare ? <ShareMeetingDocument roomId={roomId} onClose={() => setChoosing(false)} onSent={() => void q.refetch()} /> : null}
    </div>
  );
}

/** The toolbar and Files panel use the same explicit source/access choice. */
export function ShareMeetingDocument({ roomId, onClose, onSent }: { roomId: number; onClose: () => void; onSent: () => void }) {
  const [choose, setChoose] = useState<'source' | 'drive'>('source');
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    setBusy(true);
    try {
      const picked = await call('files:pickFiles', { multiple: true, title: 'Share documents with the meeting' });
      if (picked.length) {
        await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'chat', roomId: String(roomId) } });
        toast('info', 'Uploading documents — see Transfers for progress and errors.');
        onClose();
        onSent();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {choose === 'source' ? (
        <Modal
          title="Share Document"
          onClose={() => {
            if (!busy) onClose();
          }}
          width={440}
        >
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-ink-2">
              Choose Word, Excel, PowerPoint or PDF documents. Sharing a Drive file asks before granting access to anyone who cannot open it.
            </p>
            <Button disabled={busy} onClick={() => setChoose('drive')}>
              Choose from Drive
            </Button>
            <Button loading={busy} onClick={() => void upload()}>
              Upload from this device
            </Button>
            <p className="text-[12px] text-ink-3">
              Files remain in the meeting conversation. Drive grants made here remain until the owner revokes them. Meeting-only grants and guest document access are not available
              yet.
            </p>
          </div>
        </Modal>
      ) : null}
      {choose === 'drive' ? <DrivePicker roomId={String(roomId)} onClose={onClose} onSent={onSent} /> : null}
    </>
  );
}
