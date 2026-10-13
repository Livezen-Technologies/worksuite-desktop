import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage, on } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { useStore } from '../../core/store';
import { useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { agendaClock, clockFace, timerSteps } from './agenda';
import { abilitiesOf, meetingProblem, type Detail } from './api';
import type { MinutesView } from './minutes/api';

/**
 * The agenda window (D08): a small window that stays on top of the meeting — or of whatever else is on the screen —
 * with the shared agenda timer and quick notes.
 *
 * The timer is the meeting's own (`POST /api/meetings/{id}/agenda/{item}/timer`), so everybody's agenda, the meeting's
 * Agenda tab and Meet show the same item and the same time. It counts down what is left of the live item, and once the
 * item runs over says by how much, in red. Pause and Next item only for whoever may run the agenda (`can.run_agenda`).
 *
 * Quick notes are kept on this computer as they are typed, and Add to minutes puts them under the minutes'
 * Discussion, headed with the item they were written in. Offline, or when the server cannot be reached, they wait
 * here and go in when it answers again; nothing typed is lost.
 */

const POLL_MS = 5_000;
const RETRY_MS = 30_000;

interface Notes {
  text: string;
  /** Add to minutes was pressed and has not gone in yet. */
  pending: boolean;
  /** The item they were written under. */
  heading: string;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Quick notes as a paragraph of the minutes, headed with the agenda item they were written in. */
export function notesHtml(heading: string, text: string): string {
  const body = escape(text.trim()).replace(/\r?\n/g, '<br>');
  return heading ? `<p><b>${escape(heading)}</b> — ${body}</p>` : `<p>${body}</p>`;
}

/**
 * Adds a paragraph to the minutes' Discussion on the revision it is now, reading it again and trying once more when
 * somebody saved meanwhile (409). Throws what the server said otherwise.
 */
export async function appendToMinutes(meetingId: number, html: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const v = await apiGet<MinutesView>(`/api/meetings/${meetingId}/minutes`);
    const now = v.sections?.discussion ?? '';
    try {
      await apiPut(`/api/meetings/${meetingId}/minutes/sections/discussion`, { html: `${now}${html}`, base_rev: v.revs?.discussion ?? 0 });
      return;
    } catch (e) {
      if ((e as { status?: number }).status === 409 && attempt < 2) continue;
      throw e;
    }
  }
}

/** A failure that is the connection's, not the server's refusal: the notes wait for it. */
const unreachable = (e: unknown): boolean => {
  const x = e as { status?: number; offline?: boolean; code?: string | null } | null;
  return !!x && (x.offline === true || x.status === 0 || x.status === 503 || x.code === 'NETWORK_UNREACHABLE');
};

export function AgendaWindow({ id }: { id: number }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const key = ['meetings', 'detail', id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => apiGet<Detail>(`/api/meetings/${id}`, undefined, signal), refetchInterval: POLL_MS });
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const notes = useDraft<Notes>('meetings', `agenda-notes:${id}`, { text: '', pending: false, heading: '' });
  const [said, setSaid] = useState<string | null>(null);
  const sending = useRef(false);
  useTabTitle(q.data ? `Agenda · ${q.data.meeting.title}` : 'Agenda');

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Somebody moved the agenda on: read it now rather than at the next poll.
  useEffect(
    () =>
      on<{ type?: string; meeting_id?: number }>('realtime:event', (e) => {
        if (typeof e?.type === 'string' && e.type.startsWith('meeting.') && Number(e.meeting_id) === id) void qc.invalidateQueries({ queryKey: ['meetings', 'detail', id] });
      }),
    [qc, id],
  );

  const flush = async (n: Notes): Promise<void> => {
    if (sending.current || !n.text.trim()) return;
    sending.current = true;
    try {
      await appendToMinutes(id, notesHtml(n.heading, n.text));
      notes.setValue({ text: '', pending: false, heading: '' });
      setSaid('Added to the minutes.');
      void qc.invalidateQueries({ queryKey: ['meetings', id, 'minutes'] });
    } catch (e) {
      if (unreachable(e)) {
        notes.setValue({ ...n, pending: true });
        setSaid(null);
      } else {
        notes.setValue({ ...n, pending: false });
        toast('error', errorMessage(e));
      }
    } finally {
      sending.current = false;
    }
  };
  // Waiting notes go in once the server answers again.
  const waiting = notes.value.pending && !!notes.value.text.trim();
  const latest = useRef(notes.value);
  useEffect(() => {
    latest.current = notes.value;
  });
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void flush(latest.current), RETRY_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const m = d.meeting;
  const mine = d.participants.find((p) => p.user_id === me) ?? null;
  const can = abilitiesOf(m, { me, mine, manage: d.can.manage });
  const open = m.live_status !== 'cancelled' && m.live_status !== 'completed';
  const c = agendaClock(d.agenda, now);
  const heading = c.item ? `${c.number} · ${c.item.title}` : '';

  const press = async (button: 'toggle' | 'next') => {
    setBusy(true);
    try {
      for (const step of timerSteps(c, button)) await apiPost(`/api/meetings/${id}/agenda/${step.itemId}/timer`, { action: step.action });
    } catch (e) {
      const problem = meetingProblem(e);
      toast(problem ? 'info' : 'error', problem?.message ?? errorMessage(e));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['meetings', 'detail', id] });
    }
  };
  const addAction = async () => {
    const title = notes.value.text.trim().split(/\r?\n/)[0]?.trim() ?? '';
    if (!title) return;
    try {
      await apiPost(`/api/meetings/${id}/actions`, { title: title.slice(0, 255), priority: 'normal', status: 'open' });
      setSaid('Action item added.');
      void qc.invalidateQueries({ queryKey: ['meetings', id, 'minutes'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto bg-surface p-3.5 text-[13px] scroll-thin">
      <span className="truncate text-[12px] text-ink-3">{m.title}</span>
      {c.item ? (
        <>
          <div className="flex items-baseline gap-2">
            <b className="min-w-0 flex-1 truncate text-ink" data-testid="agenda-live">{heading}</b>
            <span role="timer" aria-label={c.overrun ? 'Over its time by' : 'Time left'} className={cx('font-mono text-[22px] font-bold tabular', c.overrun ? 'text-danger' : c.running ? 'text-ink' : 'text-ink-3')}>
              {clockFace(c)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Item time" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress * 100)}>
            <span className={cx('block h-full rounded-full', c.overrun ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.round(c.progress * 100)}%` }} />
          </div>
          <span className="text-[11.5px] text-ink-3">
            {c.overrun ? 'Over its time' : c.running ? `${c.item.minutes} min planned` : c.elapsed > 0 ? 'Paused' : 'Not started'}
            {c.next ? ` · next: ${c.next.title}` : ' · last item'} · {c.done} of {c.total} done
          </span>
          {can.run_agenda && open ? (
            <div className="flex gap-1.5">
              <Button size="sm" disabled={busy} onClick={() => void press('toggle')}>
                {c.running ? 'Pause' : c.elapsed > 0 ? 'Resume' : 'Start'}
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void press('next')}>
                {c.next ? 'Next item' : 'Finish'}
              </Button>
            </div>
          ) : (
            <span className="text-[11.5px] text-ink-3">Whoever runs the meeting moves the agenda on.</span>
          )}
        </>
      ) : (
        <p className="text-ink-3">{d.agenda.length ? 'Every agenda item is done.' : 'This meeting has no agenda.'}</p>
      )}
      <div className="my-0.5 border-t border-line" />
      <b className="text-[12.5px] text-ink">Quick notes</b>
      <textarea
        aria-label="Quick notes"
        rows={4}
        value={notes.value.text}
        onChange={(e) => (setSaid(null), notes.setValue({ text: e.target.value, pending: false, heading: notes.value.heading || heading }))}
        placeholder={can.minutes ? 'Noted here, added to the minutes when you choose' : 'Noted on this computer'}
        className="min-h-[84px] resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
      />
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="min-w-0 flex-1 text-ink-3" role="status" aria-live="polite">
          {waiting ? 'Saved offline · added to the minutes when back online' : said ?? (notes.value.text.trim() ? 'Kept on this computer' : '')}
        </span>
        {can.actions && open ? (
          <Button size="sm" disabled={!notes.value.text.trim()} onClick={() => void addAction()} title="The first line becomes an action item">
            Add action
          </Button>
        ) : null}
        {can.minutes ? (
          <Button size="sm" disabled={!notes.value.text.trim() || waiting} onClick={() => void flush({ ...notes.value, heading: notes.value.heading || heading })}>
            Add to minutes
          </Button>
        ) : null}
      </div>
    </div>
  );
}
