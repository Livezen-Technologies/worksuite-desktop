import { useEffect, useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { FileViewer } from '../../components/FileViewer';
import { Icon } from '../../components/Icon';
import { IconButton, cx } from '../../components/ui';
import { saveTenderFile } from './files';
import { reviewMessage, reviewRecipients, tellInChat, usePeople } from './people';
import { reviewLine, type Line } from './work';

/** A line with something on it to look at. */
export const viewable = (l: Line) => l.files.length > 0;
const reviewable = (l: Line) => l.status === 'uploaded' || l.status === 'pending_review' || l.status === 'approved';

/** The next line after `id` still waiting for a decision, going round from there. */
export function nextToReview(lines: Line[], id: number): Line | null {
  const i = lines.findIndex((l) => l.id === id);
  const order = [...lines.slice(i + 1), ...lines.slice(0, Math.max(0, i))];
  return order.find((l) => viewable(l) && (l.status === 'pending_review' || l.status === 'uploaded')) ?? null;
}

/**
 * Reviewing a checklist file inside WorkSuite: the document on the left —
 * a PDF read page by page, a picture, or, for Word and Excel, a way to open
 * it in its own app — and on the right who uploaded it and when, its earlier
 * versions, and the decision: Approve, or Send back with a comment. The
 * uploader (and whoever chases the line) can be told in Team Chat, with the
 * comment and a link to the tender. After a decision the next file waiting
 * for review opens.
 */
export function ReviewScreen({
  tenderId,
  lines,
  startId,
  canApprove,
  canDownload,
  onClose,
  onChanged,
}: {
  tenderId: number;
  lines: Line[];
  startId: number;
  canApprove: boolean;
  canDownload: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const nameOf = usePeople();
  const files = useMemo(() => lines.filter(viewable), [lines]);
  const [id, setId] = useState(startId);
  const line = files.find((l) => l.id === id) ?? files[0] ?? null;
  const [version, setVersion] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState<'approve' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  if (!line) return null;
  const current = line.files.find((f) => f.current) ?? line.files[0]!;
  const shown = line.files.find((f) => f.id === version) ?? current;
  const older = shown.id !== current.id;
  const uploader = nameOf(shown.uploaded_by);
  const owner = nameOf(line.owner_id) ?? line.owner_name;
  const tellIds = reviewRecipients(current.uploaded_by, line.owner_id, me);
  const tellNames = tellIds.map((u) => (u === current.uploaded_by ? uploader : owner) ?? 'a colleague');
  const at = files.findIndex((l) => l.id === line.id);
  const path = `/api/tenders/checklist/${line.id}/download${older ? `?v=${shown.id}` : ''}`;
  const fileName = shown.name ?? line.label;

  const open = (l: Line) => {
    setId(l.id);
    setVersion(null);
    setComment('');
    setError(null);
  };
  const decide = async (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !comment.trim()) {
      setError('Say what is wrong with it — whoever has to redo it cannot guess.');
      return;
    }
    setBusy(decision === 'approved' ? 'approve' : 'send');
    setError(null);
    try {
      await reviewLine(line.id, decision, decision === 'rejected' ? comment.trim() : undefined);
      let told = '';
      if (tell && tellIds.length && (decision === 'rejected' || comment.trim())) {
        const r = await tellInChat(tellIds, reviewMessage({ decision, line: line.label, file: current.name, comment: comment.trim(), tenderId }));
        told = r.sent ? ` ${tellNames.slice(0, r.sent).join(' and ')} ${r.sent === 1 ? 'was' : 'were'} told in Chat.` : '';
        if (r.failed) toast('warning', 'The decision is saved, but a Chat message could not be sent.');
      }
      toast('success', `${decision === 'approved' ? 'Approved' : 'Sent back'}.${told}`);
      onChanged();
      const next = nextToReview(files, line.id);
      if (next) open(next);
      else {
        toast('info', 'Nothing else is waiting for review.');
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const btn = 'h-9 rounded-[8px] px-3 text-[13px] font-semibold disabled:opacity-50';
  return (
    <div role="dialog" aria-modal="true" aria-label={`Review ${line.label}`} className="fixed inset-0 z-50 flex flex-col bg-ground">
      <div className="drag flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <IconButton icon="chevron-left" label="Previous file" className="no-drag" disabled={at <= 0} onClick={() => open(files[at - 1]!)} />
        <IconButton icon="chevron-right" label="Next file" className="no-drag" disabled={at >= files.length - 1} onClick={() => open(files[at + 1]!)} />
        <span className="text-[12px] text-ink-3 tabular-nums">
          {at + 1} of {files.length}
        </span>
        <b className="min-w-0 flex-1 truncate text-[14px] text-ink">
          {line.label} · <span className="font-medium text-ink-2">{fileName}</span>
        </b>
        {canDownload ? (
          <>
            <button type="button" className={cx(btn, 'no-drag border border-line text-ink hover:bg-subtle')} onClick={() => void saveTenderFile({ tenderLine: { line: line.id, ...(older ? { version: shown.id } : {}) } }, fileName, true)}>
              Open in its app
            </button>
            <button type="button" className={cx(btn, 'no-drag border border-line text-ink hover:bg-subtle')} onClick={() => void saveTenderFile({ tenderLine: { line: line.id, ...(older ? { version: shown.id } : {}) } }, fileName)}>
              Save a copy
            </button>
          </>
        ) : null}
        <IconButton icon="x" label="Close the review (Esc)" className="no-drag" onClick={onClose} />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {canDownload ? (
            <FileViewer
              key={path}
              path={path}
              name={fileName}
              onOpen={() => void saveTenderFile({ tenderLine: { line: line.id, ...(older ? { version: shown.id } : {}) } }, fileName, true)}
              onSave={() => void saveTenderFile({ tenderLine: { line: line.id, ...(older ? { version: shown.id } : {}) } }, fileName)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-[13px] text-ink-2">You may not take copies of tender documents, so they cannot be shown here.</div>
          )}
        </div>
        <aside aria-label="Review" className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-4 text-[13px] scroll-thin">
          <div className="flex flex-col gap-1">
            <b className="text-[15px] text-ink">{line.label}</b>
            <span className="text-[12px] text-ink-3">
              {line.mandatory ? 'Required' : 'Optional'} · {STATUS[line.status] ?? line.status}
            </span>
            {line.detail ? <span className="text-ink-2">{line.detail}</span> : null}
          </div>
          <dl className="m-0 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1.5 rounded-[10px] bg-subtle px-3 py-2.5 text-[12.5px]">
            <dt className="text-ink-3">File</dt>
            <dd className="m-0 break-words font-semibold text-ink">{fileName}</dd>
            <dt className="text-ink-3">Uploaded by</dt>
            <dd className="m-0 font-semibold text-ink">{uploader ?? (shown.uploaded_by ? 'A colleague' : 'Not recorded')}</dd>
            <dt className="text-ink-3">Uploaded</dt>
            <dd className="m-0 text-ink">{shown.uploaded_at ? `${dateLabel(shown.uploaded_at)} · ${relative(shown.uploaded_at)}` : '—'}</dd>
            {owner ? (
              <>
                <dt className="text-ink-3">Chased by</dt>
                <dd className="m-0 text-ink">{owner}</dd>
              </>
            ) : null}
          </dl>
          {line.files.length > 1 ? (
            <label className="flex flex-col gap-1 text-[12px] text-ink-3">
              Version
              <select value={shown.id} onChange={(e) => setVersion(Number(e.target.value))} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink">
                {line.files.map((f) => (
                  <option key={f.id} value={f.id}>
                    v{f.version}
                    {f.current ? ' (current)' : ''} · {f.name ?? 'file'}
                    {f.uploaded_at ? ` · ${dateLabel(f.uploaded_at)}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {line.status === 'rejected' && line.rejection_reason ? (
            <p className="m-0 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
              Sent back{line.reviewer_name ? ` by ${line.reviewer_name}` : ''}
              {line.reviewed_at ? ` ${relative(line.reviewed_at)}` : ''}: {line.rejection_reason}
            </p>
          ) : null}
          {line.status === 'approved' ? (
            <p className="m-0 rounded-[10px] bg-success-bg px-3 py-2 text-[12.5px] text-success">
              Approved{line.reviewer_name ? ` by ${line.reviewer_name}` : ''}
              {line.reviewed_at ? ` ${relative(line.reviewed_at)}` : ''}.
            </p>
          ) : null}
          {older ? <p className="m-0 text-[12px] text-[#9A4A06] dark:text-warning">This is an earlier version. A decision applies to the current one.</p> : null}
          {canApprove && reviewable(line) ? (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
                Comment{uploader ? ` for ${uploader}` : ''}
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, 500))}
                  rows={4}
                  placeholder="What is wrong with it, or anything they should know"
                  className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-normal text-ink outline-none focus:border-primary"
                />
              </label>
              {tellIds.length ? (
                <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
                  <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} className="mt-0.5 accent-primary" />
                  <span>
                    Tell {tellNames.join(' and ')} in Chat
                    <span className="block text-[11.5px] text-ink-3">With your comment and a link to this tender. Approving sends nothing unless you write a comment.</span>
                  </span>
                </label>
              ) : null}
              {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
              <div className="flex gap-2">
                {line.status !== 'approved' ? (
                  <button type="button" disabled={busy !== null} onClick={() => void decide('approved')} className={cx(btn, 'flex-1 bg-[#1F7A4D] text-white hover:brightness-110')}>
                    {busy === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                ) : null}
                <button type="button" disabled={busy !== null} onClick={() => void decide('rejected')} className={cx(btn, 'flex-1 border border-[#F1B8A8] text-danger hover:bg-danger-bg')}>
                  {busy === 'send' ? 'Sending back…' : uploader ? `Send back to ${uploader.split(' ')[0]}` : 'Send back'}
                </button>
              </div>
            </div>
          ) : !canApprove ? (
            <p className="m-0 border-t border-line pt-3 text-[12px] text-ink-3">Approving and sending back need the checklist approval permission.</p>
          ) : null}
          <p className="mt-auto flex items-center gap-1.5 text-[11.5px] text-ink-3">
            <Icon name="shield-check" size={12} /> Shown inside WorkSuite: the file's own scripts and links do not run.
          </p>
        </aside>
      </div>
    </div>
  );
}

const STATUS: Record<string, string> = { missing: 'Missing', uploaded: 'Uploaded', pending_review: 'Pending review', approved: 'Approved', rejected: 'Sent back' };
