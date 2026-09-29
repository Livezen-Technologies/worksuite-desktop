import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { navigate } from '../../core/tabs';
import { assistantProblem, cancelAction, confirmAction, undoAction, type PendingAction } from './assistant';

/**
 * A change the assistant proposed (WS-AI-SRS-001 §4.6, FR-CNF-02, DSK-5): the
 * module's own preview of it, and the only control that makes it happen.
 *
 * Confirm goes to the main process (`ai:confirm`), which accepts it from the
 * main window only — so neither Quick Ask nor a notification can confirm
 * anything, and a change reaching outside the company is always confirmed
 * here, looking at this card. Cancel and Undo go straight to the server.
 */
export function ActionCard({ action, onChange, elsewhere }: {
  action: PendingAction;
  onChange?: (a: PendingAction) => void;
  /** Quick Ask: nothing is confirmed here — the card is reviewed in the main window. */
  elsewhere?: () => void;
}) {
  const qc = useQueryClient();
  // What this card itself last did wins over the list it came from, which catches up on refetch.
  const [local, setA] = useState<PendingAction | null>(null);
  const a = local && local.id === action.id ? local : action;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, Math.floor((Date.parse(a.expires_at) - now) / 1000));
  const undoLeft = a.undo_until ? Math.max(0, Math.floor((Date.parse(a.undo_until) - now) / 1000)) : 0;
  const open = a.status === 'awaiting_confirmation' && left > 0;
  const outside = a.risk === 'R2';
  const done = a.status === 'succeeded' || a.status === 'submitted_for_approval';

  const act = async (name: string, fn: () => Promise<PendingAction>) => {
    setBusy(name);
    setError(null);
    try {
      const next = await fn();
      setA(next);
      onChange?.(next);
      void qc.invalidateQueries({ queryKey: ['ai', 'pending'] });
    } catch (e) {
      setError(assistantProblem(e));
    } finally {
      setBusy(null);
    }
  };

  const btn = 'h-8 rounded-[8px] px-3 text-[12.5px] font-semibold disabled:opacity-50';
  return (
    <section aria-label={`Proposed: ${a.preview.title}`} className={cx('rounded-[12px] border bg-surface p-3 text-[13px]', outside ? 'border-danger/40' : 'border-primary/30')}>
      <header className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]', outside ? 'bg-danger-bg text-danger' : 'bg-subtle text-primary')}>
          {outside ? 'Reaches outside' : 'Internal change'}
        </span>
        <span className="text-[12px] text-ink-3">{a.name}</span>
        <span className="ml-auto text-[11.5px] text-ink-3">{open ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : statusWord(a.status, left)}</span>
      </header>

      {a.tainted && open ? (
        <p className="mb-2 flex items-start gap-1.5 rounded-[8px] bg-warning-bg px-2 py-1.5 text-[12px] text-[#7A4308] dark:text-warning">
          <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
          Suggested after reading outside content — an email, a file or a chat could have asked for this. Check it before you confirm.
        </p>
      ) : null}

      <p className="font-semibold text-ink">{a.preview.title}</p>
      {a.preview.lines.length ? (
        <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink-2">
          {a.preview.lines.map((l, i) => <li key={i} className="whitespace-pre-wrap selectable">{l}</li>)}
        </ul>
      ) : null}

      {a.external_recipients.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Icon name="globe" size={14} className="text-danger" />
          <span className="text-[12px] text-danger">Outside the company:</span>
          {a.external_recipients.map((r) => (
            <span key={r} className="rounded-full bg-danger-bg px-2 py-0.5 text-[11.5px] font-semibold text-danger">{r}</span>
          ))}
        </div>
      ) : null}

      {a.preview.warnings.length ? (
        <ul className="mt-2 space-y-0.5">
          {a.preview.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1 text-[12px] text-[#7A4308] dark:text-warning"><Icon name="warning" size={13} className="mt-0.5 shrink-0" />{w}</li>
          ))}
        </ul>
      ) : null}

      {error ? <p role="alert" className="mt-2 rounded-[8px] bg-danger-bg px-2 py-1.5 text-[12px] text-danger">{error}</p> : null}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {open && elsewhere ? (
          <button type="button" onClick={elsewhere} className={cx(btn, 'bg-primary text-white hover:bg-primary-hover')}>
            Review in WorkSuite
          </button>
        ) : null}
        {open && !elsewhere ? (
          <>
            <button type="button" disabled={!!busy} onClick={() => void act('confirm', () => confirmAction(a))}
              className={cx(btn, 'text-white', outside ? 'bg-danger hover:opacity-90' : 'bg-primary hover:bg-primary-hover')}>
              {busy === 'confirm' ? 'Doing it…' : outside ? 'Confirm and send' : 'Confirm'}
            </button>
            <button type="button" disabled={!!busy} onClick={() => void act('cancel', () => cancelAction(a.id))} className={cx(btn, 'text-ink-2 hover:bg-subtle')}>
              Cancel
            </button>
          </>
        ) : null}
        {done ? (
          <>
            <span className="flex items-center gap-1 text-[12.5px] font-semibold text-success"><Icon name="check-circle" size={15} />{a.status === 'submitted_for_approval' ? 'Sent for approval' : 'Done'}</span>
            {(a.links ?? []).map((l) => (
              <button key={l.url} type="button" onClick={() => navigate(l.url)} className="text-[12.5px] font-semibold text-primary hover:underline">{l.label}</button>
            ))}
            {undoLeft > 0 ? (
              <button type="button" disabled={!!busy} onClick={() => void act('undo', () => undoAction(a.id))} className={cx(btn, 'ml-auto flex items-center gap-1 border border-line text-ink hover:bg-subtle')}>
                <Icon name="undo" size={13} /> Undo ({undoLeft}s)
              </button>
            ) : null}
          </>
        ) : null}
        {a.status === 'failed' ? <span className="flex items-center gap-1 text-[12.5px] text-danger"><Icon name="alert" size={15} />{a.error || 'It did not work.'}</span> : null}
      </footer>
    </section>
  );
}

function statusWord(s: PendingAction['status'], left: number): string {
  if (s === 'awaiting_confirmation' && left <= 0) return 'Expired — ask again';
  return {
    awaiting_confirmation: '', executing: 'Doing it…', succeeded: 'Done', failed: 'Failed', cancelled: 'Cancelled',
    expired: 'Expired — ask again', superseded: 'Replaced by an edit', submitted_for_approval: 'Sent for approval',
    rejected: 'Rejected', undone: 'Undone',
  }[s];
}
