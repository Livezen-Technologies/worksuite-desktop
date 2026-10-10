import { useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { Button, Modal, TextField, cx } from '../../../../components/ui';
import { STATE_CHIP } from '../verdicts';
import { searchRemove, searchRemoveRun } from './api';
import type { SearchRemovePreview, SearchRemoveQuery, SearchRemoveRun } from '../types';

/**
 * Search and remove (P-UI-08, AC-MPR-13; mail.quarantine.purge): find a message everywhere by Message-ID, sender,
 * subject, link, file hash or date; see the matches by mailbox first — WorkSuite mailboxes can have it moved to
 * quarantine, external ones can only have it hidden in WorkSuite — then remove with a reason, and read what was done.
 */
export function SearchRemoveDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState<Omit<SearchRemoveQuery, 'reason'>>({});
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<SearchRemovePreview | null>(null);
  const [result, setResult] = useState<SearchRemoveRun | null>(null);
  const [busy, setBusy] = useState<'preview' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = (k: keyof Omit<SearchRemoveQuery, 'reason'>, label: string, type = 'text') => (
    <TextField
      label={label}
      type={type}
      value={q[k] ?? ''}
      onChange={(e) => {
        setQ({ ...q, [k]: e.target.value || undefined });
        setPreview(null);
      }}
    />
  );
  const any = Object.values(q).some((v) => !!v && String(v).trim());
  const body = (): SearchRemoveQuery => ({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v && String(v).trim())), reason: reason.trim() });
  const doPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      setPreview(await searchRemove(body(), true));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const run = async () => {
    setBusy('run');
    setError(null);
    try {
      setResult(await searchRemoveRun(body()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const total = preview?.matches.reduce((n, m) => n + m.count, 0) ?? 0;
  return (
    <Modal
      title={text('Search and remove')}
      labelledBy="search-remove"
      width={680}
      onClose={busy ? undefined : onClose}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>{text('Done')}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={!!busy}>{text('Cancel')}</Button>
            <Button loading={busy === 'preview'} disabled={!any || !!busy} onClick={() => void doPreview()}>{text('Find matches')}</Button>
            <Button variant="danger" loading={busy === 'run'} disabled={!preview || total === 0 || reason.trim().length < 3 || !!busy} onClick={() => void run()}>
              {text('Remove {n}', { n: total })}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3 p-4 text-[13px] text-ink">
        {result ? (
          <div role="status" data-search-remove-result className="flex flex-col gap-2">
            <p className="font-bold">{text('{n} copies moved to quarantine.', { n: result.removed })}</p>
            {result.hidden_only.length ? (
              <>
                <p>{text('These external mailboxes could only have it hidden in WorkSuite — it is still at their provider:')}</p>
                <ul className="list-disc pl-5 text-ink-2">
                  {result.hidden_only.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </>
            ) : null}
            <p className="text-[12px] text-ink-3">{text('Job {id} is in the audit log.', { id: result.job_id })}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {field('message_id', text('Message-ID'))}
              {field('sender', text('Sender'))}
              {field('subject', text('Subject'))}
              {field('url', text('Link in the message'))}
              {field('sha256', text('File hash (SHA-256)'))}
              <div className="grid grid-cols-2 gap-2">
                {field('from', text('From'), 'date')}
                {field('to', text('To'), 'date')}
              </div>
            </div>
            <TextField label={text('Reason (recorded in the audit log)')} value={reason} onChange={(e) => setReason(e.target.value)} />
            {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
            {preview ? (
              <section aria-label={text('Matches')} className="flex flex-col rounded-[10px] border border-line">
                <p className="border-b border-line px-3 py-2 font-semibold">{text('{n} copies in {m} mailboxes', { n: total, m: preview.matches.length })}</p>
                {preview.matches.map((m) => (
                  <div key={m.mailbox_id} className="flex items-center gap-2.5 border-b border-line px-3 py-1.5 last:border-b-0">
                    <span className="flex-1 truncate">{m.email}</span>
                    <span className={cx('inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-bold', m.kind === 'local' ? STATE_CHIP.info : STATE_CHIP.muted)}>{m.kind === 'local' ? text('WorkSuite mailbox') : text('External')}</span>
                    <span className="w-[150px] text-right text-[12px] text-ink-3">{m.can_remove ? text('{n} · moved to quarantine', { n: m.count }) : text('{n} · hidden only', { n: m.count })}</span>
                  </div>
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
