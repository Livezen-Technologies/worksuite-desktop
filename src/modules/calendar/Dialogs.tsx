import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Modal, Spinner, cx } from '../../components/ui';

interface FeedStatus {
  exists: boolean;
  created_at: string | null;
  last_used_at: string | null;
  uses: number;
  url: null;
  window: { behind_days: number; ahead_days: number };
}

const APPS: Array<{ id: string; label: string; how: string; webcal: boolean }> = [
  { id: 'google', label: 'Google Calendar', how: 'Google Calendar: Other calendars › + › From URL → paste the link → Add calendar.', webcal: false },
  { id: 'apple', label: 'Apple Calendar', how: 'Apple Calendar: File › New Calendar Subscription → paste the link → set auto-refresh every 15 minutes.', webcal: true },
  { id: 'outlook', label: 'Outlook', how: 'Outlook: Add calendar › Subscribe from web → paste the link → name it WorkSuite.', webcal: false },
];

/**
 * Subscribe (CalendarDialogs): your WorkSuite calendar in the calendar you
 * already use. The link is its own key, so the server keeps only a hash and
 * shows the whole link once, when it is made; after that it can be replaced
 * (the old one stops) or stopped.
 */
export function SubscribeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['calendar', 'feed'], queryFn: ({ signal }) => apiGet<FeedStatus>('/api/calendar/feed', undefined, signal) });
  const [url, setUrl] = useState<string | null>(null);
  const [app, setApp] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'replace' | 'stop' | null>(null);
  const s = status.data;
  const shown = url ? (APPS[app]!.webcal ? url.replace(/^https?:\/\//, 'webcal://') : url) : null;

  const make = async () => {
    setBusy(true);
    setConfirm(null);
    try {
      const r = await apiPost<{ url: string }>('/api/calendar/feed');
      setUrl(r.url);
      void qc.invalidateQueries({ queryKey: ['calendar', 'feed'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    setConfirm(null);
    try {
      await apiDelete('/api/calendar/feed');
      setUrl(null);
      toast('success', 'That link has stopped working.');
      void qc.invalidateQueries({ queryKey: ['calendar', 'feed'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Subscribe to this calendar" onClose={onClose} width={540}>
      <div className="flex flex-col gap-3 text-[13px]">
        <span className="text-ink-2">Your WorkSuite day, in the calendar you already use.</span>
        {status.isLoading ? <Spinner /> : null}
        {s ? (
          <>
            <b className="text-ink">Your calendar link</b>
            {shown ? (
              <>
                <div className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-[8px] bg-ground px-2.5 py-2 font-mono text-[11.5px] text-primary selectable" title={shown} aria-label="Your calendar link">{shown}</span>
                  <Button onClick={() => void navigator.clipboard.writeText(shown).then(() => toast('success', 'Link copied.'))}>Copy</Button>
                </div>
                <span className="text-[12px] font-semibold text-[#9A4A06] dark:text-warning">Copy it now: it is not shown again. Anyone with it can read your calendar.</span>
              </>
            ) : s.exists ? (
              <span className="rounded-[8px] bg-ground px-2.5 py-2 text-ink-2">
                Your link is set up{s.created_at ? ` (made ${relative(s.created_at)})` : ''}. It is shown only when it is made; replace it to get a new one to copy.
              </span>
            ) : (
              <span className="rounded-[8px] bg-ground px-2.5 py-2 text-ink-2">You have no calendar link yet.</span>
            )}
            {s.exists ? (
              <span className="text-[12px] text-ink-3">
                {s.last_used_at ? `Last read by a calendar ${relative(s.last_used_at)} · ${s.uses} read${s.uses === 1 ? '' : 's'}` : 'Not read by any calendar yet'} · shows {s.window.behind_days} days back and {s.window.ahead_days} ahead
              </span>
            ) : null}
            <b className="text-ink">Where to paste it</b>
            <div role="tablist" className="flex gap-1.5">
              {APPS.map((a, i) => (
                <button key={a.id} type="button" role="tab" aria-selected={i === app} onClick={() => setApp(i)} className={cx('h-[30px] rounded-full px-3 font-semibold', i === app ? 'bg-primary text-white' : 'border border-line text-ink hover:bg-subtle')}>
                  {a.label}
                </button>
              ))}
            </div>
            <div className="rounded-[9px] bg-ground px-3 py-2.5 leading-[1.55] text-ink-2">{APPS[app]!.how}</div>
            {confirm ? (
              <div role="alertdialog" aria-label={confirm === 'stop' ? 'Stop the link?' : 'Replace the link?'} className="flex flex-col gap-2 rounded-[9px] border border-[#F1B8A8] bg-danger-bg dark:border-danger/40 px-3 py-2.5">
                <span className="text-ink">
                  {confirm === 'stop' ? 'Any calendar subscribed to it stops updating. You can make a new link later.' : 'The link you have now stops working, and calendars subscribed to it stop updating until you paste the new one.'}
                </span>
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => setConfirm(null)}>Keep it</Button>
                  <Button size="sm" variant="danger" loading={busy} onClick={() => void (confirm === 'stop' ? stop() : make())}>{confirm === 'stop' ? 'Stop it' : 'Replace it'}</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                {s.exists || url ? (
                  <>
                    <Button onClick={() => setConfirm('replace')} disabled={busy}>Replace the link</Button>
                    <button type="button" onClick={() => setConfirm('stop')} disabled={busy} className="h-9 rounded-[8px] border border-[#F1B8A8] bg-surface px-3 font-bold text-danger hover:bg-danger-bg">Stop it</button>
                  </>
                ) : (
                  <Button variant="primary" loading={busy} onClick={() => void make()}>Make my link</Button>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

export interface IcsProblem {
  line: number;
  summary: string;
  why: string;
  level: string;
}
export interface IcsReport {
  imported: number;
  total: number;
  errors: number;
  warnings: number;
  problems: IcsProblem[];
  notes: string[];
}

/** What happened to the file just imported: how many arrived, and which did not and why. */
export function ImportResult({ name, report, onClose }: { name: string; report: IcsReport; onClose: () => void }) {
  const skipped = Math.max(0, report.total - report.imported);
  return (
    <Modal title="Import .ics" onClose={onClose} width={440} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-2.5 text-[13px]">
        <span className="text-ink-2">{name} · {report.total} event{report.total === 1 ? '' : 's'}</span>
        <div className="flex gap-2.5">
          <div className="flex-1 rounded-[9px] bg-success-bg px-2.5 py-2">
            <div className="text-[11.5px] text-success">Imported</div>
            <div className="text-[20px] font-bold text-success">{report.imported}</div>
          </div>
          <div className={cx('flex-1 rounded-[9px] px-2.5 py-2', skipped ? 'bg-danger-bg' : 'bg-subtle')}>
            <div className={cx('text-[11.5px]', skipped ? 'text-danger' : 'text-ink-3')}>Skipped</div>
            <div className={cx('text-[20px] font-bold', skipped ? 'text-danger' : 'text-ink-3')}>{skipped}</div>
          </div>
        </div>
        {report.problems.length ? (
          <>
            <b className="text-ink">{report.errors ? 'Some events could not be imported' : 'Worth knowing'}</b>
            <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto text-ink-2 scroll-thin">
              {report.problems.map((p, i) => (
                <li key={i}>
                  • “{p.summary}” — {p.why}
                  {p.level !== 'error' ? <span className="text-ink-3"> (imported)</span> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {report.notes.map((n, i) => <p key={i} className="rounded-[8px] bg-subtle px-2.5 py-2 text-[12px] text-ink-2">{n}</p>)}
      </div>
    </Modal>
  );
}

/**
 * Dragging one date of a repeating event: move just that one, or all of
 * them. "Only this one" needs you to own the event, because it makes a
 * one-off copy with the same people on it.
 */
export function SeriesDialog({ title, what, canOne, onOne, onAll, onCancel }: { title: string; what: string; canOne: boolean; onOne: () => void; onAll: () => void; onCancel: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={440}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          {canOne ? <Button onClick={onOne}>Only this one</Button> : null}
          <Button variant="primary" onClick={onAll}>{title.startsWith('Move') ? 'Move every occurrence' : 'Change every occurrence'}</Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2" role="alert">{what}</p>
    </Modal>
  );
}

/** "Event moved to 10:00 AM · Undo", for twelve seconds after a change made by dragging. */
export function UndoBar({ label, onUndo, onGone }: { label: string; onUndo: () => void; onGone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onGone, 12_000);
    return () => clearTimeout(t);
  }, [label, onGone]);
  return (
    <div role="status" className="absolute bottom-5 left-1/2 z-40 flex w-[420px] max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2.5 rounded-[10px] bg-[#0F1B3D] px-3.5 py-3 text-[13px] text-white shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.3)]">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button type="button" onClick={onUndo} className="font-bold text-[#AFC6FF] hover:underline">Undo</button>
      <button type="button" aria-label="Dismiss" onClick={onGone} className="px-1 text-white/60 hover:text-white">×</button>
    </div>
  );
}
