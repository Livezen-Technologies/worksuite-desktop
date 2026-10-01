import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, Cell, Empty, Field, input, Kpi, PageHead, row, Sheet, SidePanel, StatusChip, THead } from './parts';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';

/**
 * Announcements (HrAdminSheet "Announcements"; the web's HrAnnouncements):
 * what HR has told a company, written, sent, and who has read and
 * acknowledged it. The audience is fixed when it is sent, so sending says in
 * words who it goes to before it goes.
 */
interface Row {
  id: number;
  title: string;
  company: string;
  org_id: number | null;
  category: string;
  priority: string;
  status: string;
  pinned: boolean;
  requires_ack: boolean;
  publish_at: string | null;
  published_at: string | null;
  expires_at: string | null;
}

interface Report {
  stats: { notified: number; read: number; acknowledged: number };
  revision: number;
  people: Array<{ id: number; name: string; email: string; read: boolean; acknowledged: boolean; ack_revision: number | null }>;
}

const when = (s: string | null) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function Announcements() {
  const qc = useQueryClient();
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [report, setReport] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ['hr', 'announcements'], queryFn: ({ signal }) => apiGet<{ items: Row[] }>('/api/hr/announcements', undefined, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr', 'announcements'] });
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };
  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Announcements" sub="What HR has told each company, and who has read it.">
        <button type="button" className={btnPrimary} onClick={() => setWriting(true)}>
          New announcement
        </button>
      </PageHead>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead cols={[['Title', null], ['Company', 150], ['Priority', 100], ['Acknowledgement', 130], ['Status', 110], ['Sent', 110], ['', 170]]} />
          {q.data.items.map((r) => (
            <div key={r.id} className={row}>
              <Cell w={null} className="font-semibold">{r.title}</Cell>
              <Cell w={150} className="text-ink-2">{r.company}</Cell>
              <Cell w={100} className="!overflow-visible">
                <StatusChip className={r.priority === 'urgent' ? '!bg-danger-bg !text-danger' : r.priority === 'important' ? '!bg-warning-bg !text-[#9A4A06] dark:!text-warning' : '!bg-subtle !text-ink-2'}>{r.priority[0]!.toUpperCase() + r.priority.slice(1)}</StatusChip>
              </Cell>
              <Cell w={130} className="text-ink-2">{r.requires_ack ? 'Required' : 'Not required'}</Cell>
              <Cell w={110} className="!overflow-visible">
                <StatusChip>{r.status[0]!.toUpperCase() + r.status.slice(1)}</StatusChip>
              </Cell>
              <Cell w={110} className="text-ink-3">{when(r.published_at)}</Cell>
              <span className="flex w-[170px] shrink-0 justify-end gap-3 text-[12.5px] font-bold">
                {r.status === 'draft' ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => setSending(r)}>
                    Send
                  </button>
                ) : (
                  <button type="button" className="text-primary hover:underline" onClick={() => setReport(r)}>
                    Who has read it
                  </button>
                )}
                <button type="button" className="text-danger hover:underline" onClick={() => setDeleting(r)}>
                  Delete
                </button>
              </span>
            </div>
          ))}
          {!q.data.items.length ? <Empty text="Nothing announced yet." /> : null}
        </div>
      ) : null}
      {writing ? <Composer onClose={() => setWriting(false)} onDone={() => (setWriting(false), refresh())} /> : null}
      {sending ? (
        <Sheet
          title={`Send “${sending.title}”?`}
          width={440}
          onClose={() => setSending(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setSending(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={() => void run(() => apiPost(`/api/hr/announcements/${sending.id}/publish`, {}), 'Sent.').then((ok) => ok && setSending(null))}>
                Send it
              </button>
            </>
          }
        >
          <span className="text-ink-2">
            It goes to everybody in <b className="text-ink">{sending.company}</b>, who see it on their home screen{sending.requires_ack ? ' and are asked to confirm they have read it' : ''}. Who receives it is fixed once it is sent.
          </span>
        </Sheet>
      ) : null}
      {deleting ? (
        <Sheet
          title={`Delete “${deleting.title}”?`}
          width={420}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} onClick={() => void run(() => apiDelete(`/api/hr/announcements/${deleting.id}`), 'Deleted.').then((ok) => ok && setDeleting(null))}>
                Delete
              </button>
            </>
          }
        >
          <span className="text-ink-2">{deleting.status === 'published' ? 'It disappears from everybody’s home screen, and who read it is no longer shown.' : 'The draft is removed.'}</span>
        </Sheet>
      ) : null}
      {report ? <ReportPanel row={report} onClose={() => setReport(null)} /> : null}
    </div>
  );
}

function Composer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const ctx = useQuery({ queryKey: ['hr', 'context'], queryFn: ({ signal }) => apiGet<{ organizations: Array<{ id: number; name: string }>; default: number | null }>('/api/hr/context', undefined, signal) });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [org, setOrg] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const companies = ctx.data?.organizations ?? [];
  const chosen = org || String(ctx.data?.default ?? companies[0]?.id ?? '');
  const save = async () => {
    setBusy(true);
    try {
      await apiPost('/api/hr/announcements', {
        title: title.trim(),
        body: body
          .split(/\n{2,}/)
          .map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
          .join(''),
        priority,
        org_id: Number(chosen),
        audience_type: 'all',
        requires_ack: ack,
      });
      toast('success', 'Saved as a draft. Send it when it is ready.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New announcement"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !title.trim() || !chosen} className={btnPrimary} onClick={() => void save()}>
            Save draft
          </button>
        </>
      }
    >
      <Field label="Title">
        <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Annual staff meeting" className={input} />
      </Field>
      <Field label="Message">
        <textarea aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Friday at 10:00 in the main hall." className={input + ' !h-[130px] resize-none py-2'} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Company">
          <Select aria-label="Company" value={chosen} onChange={(e) => setOrg(e.target.value)} className={input}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={input}>
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
      </div>
      <label className="flex items-start gap-2 text-[12.5px] text-ink">
        <Checkbox aria-label="Ask everyone to acknowledge it" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-[2px]" />
        <span>
          <b>Ask everyone to acknowledge it</b>
          <br />
          <span className="text-ink-3">Each person confirms they have read it, and you see who has and has not.</span>
        </span>
      </label>
    </Sheet>
  );
}

function ReportPanel({ row: r, onClose }: { row: Row; onClose: () => void }) {
  const q = useQuery({ queryKey: ['hr', 'announcement-report', r.id], queryFn: ({ signal }) => apiGet<Report>(`/api/hr/announcements/${r.id}/report`, undefined, signal) });
  const d = q.data;
  return (
    <SidePanel label="Who has read it" width={520} onClose={onClose} head={<b className="truncate text-ink">{r.title}</b>}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="Sent to" value={d.stats.notified} />
            <Kpi label="Read" value={d.stats.read} />
            <Kpi label="Acknowledged" value={r.requires_ack ? d.stats.acknowledged : '—'} />
          </div>
          <div className="flex flex-col">
            {d.people.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border-b border-line/70 py-2 text-[12.5px] last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{p.name}</b>
                  <span className="truncate text-[11.5px] text-ink-3">{p.email}</span>
                </span>
                <StatusChip>{p.acknowledged ? 'Acknowledged' : p.read ? 'Read' : 'Not read'}</StatusChip>
              </div>
            ))}
            {!d.people.length ? <Empty text="Nobody yet." /> : null}
          </div>
        </>
      ) : null}
    </SidePanel>
  );
}
