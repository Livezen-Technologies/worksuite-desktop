import { useState } from 'react';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { btnPrimary, input, Panel } from '../../hr/parts';
import { addNote, OFFLINE_WRITE, refusalOf } from '../api';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';

/**
 * Notes on the job (FR-MED): internal ones for the workshop, and ones the
 * customer may read — which only somebody who may publish to the customer
 * can write (the server refuses the rest, and audits what it keeps). Internal
 * notes never reach a customer view.
 */
export default function Notes({ job, company, online, onChanged }: JobTabProps) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'internal' | 'customer'>('internal');
  const [busy, setBusy] = useState(false);
  const mayWrite = !!(company?.can.edit || company?.can.work || company?.can.diagnose || company?.can.checkin);
  const mayPublish = job.can.publish_media;

  const send = async () => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(true);
    try {
      const r = await addNote(job.id, { body: body.trim(), visibility });
      toast('success', r.message || (visibility === 'customer' ? 'Note added; the customer can read it.' : 'Note added.'));
      setBody('');
      setVisibility('internal');
      onChanged(r.data.job);
    } catch (e) {
      toast('error', refusalOf(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {mayWrite ? (
        <Panel title="Add a note">
          <div className="flex flex-col gap-2 p-3.5">
            <textarea
              aria-label="Note"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim() && void send()}
              rows={3}
              placeholder={visibility === 'customer' ? 'What the customer will read' : 'For the workshop only'}
              className={cx(input, 'h-auto py-2')}
              maxLength={4000}
            />
            <div className="flex items-center gap-2">
              <div role="radiogroup" aria-label="Who reads it" className="flex gap-1">
                <button type="button" role="radio" aria-checked={visibility === 'internal'} onClick={() => setVisibility('internal')} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', visibility === 'internal' ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2')}>
                  Internal
                </button>
                {mayPublish ? (
                  <button type="button" role="radio" aria-checked={visibility === 'customer'} onClick={() => setVisibility('customer')} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', visibility === 'customer' ? 'bg-[#1F7A4D] text-white' : 'border border-line bg-surface text-ink-2')}>
                    Customer can read it
                  </button>
                ) : null}
              </div>
              <span className="flex-1 text-[11.5px] text-ink-3">Ctrl/⌘+Enter adds it.</span>
              <button type="button" className={btnPrimary} disabled={!online || busy || !body.trim()} onClick={() => void send()}>
                <Icon name="send" size={14} /> Add note
              </button>
            </div>
          </div>
        </Panel>
      ) : null}
      <Panel title="Notes" sub={`${job.job_notes.length} ${job.job_notes.length === 1 ? 'note' : 'notes'}`}>
        {job.job_notes.length ? (
          [...job.job_notes].reverse().map((n) => (
            <div key={n.id} className="flex flex-col gap-1 border-b border-line/70 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
              <span className="flex items-center gap-2">
                <b className="text-ink">{n.by?.name ?? 'Someone'}</b>
                <span className="text-ink-3">{n.at ? `${dateLabel(n.at)} ${timeLabel(n.at)}` : ''}</span>
                <span className="flex-1" />
                <Pill tone={n.visibility === 'customer' ? 'green' : 'grey'}>{n.visibility === 'customer' ? 'Customer can read it' : 'Internal'}</Pill>
              </span>
              <p className="m-0 whitespace-pre-wrap text-ink">{n.body}</p>
            </div>
          ))
        ) : (
          <div className="px-3.5 py-4 text-[12.5px] text-ink-3">No notes yet.</div>
        )}
      </Panel>
    </div>
  );
}
