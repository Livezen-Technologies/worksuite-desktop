import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { navigate } from '../../core/tabs';
import { assistantProblem, cancelAction, confirmAction, editAction, undoAction, type PendingAction } from './assistant';

/**
 * A change the assistant proposed (WS-AI-SRS-001 §4.6, FR-CNF-02, DSK-5): the
 * module's own preview of it, and the only control that makes it happen.
 *
 * Confirm goes to the main process (`ai:confirm`), which accepts it from the
 * main window only — so neither Quick Ask nor a notification can confirm
 * anything, and a change reaching outside the company is always confirmed
 * here, looking at this card. Cancel and Undo go straight to the server.
 *
 * EDITING DOES NOT ALTER THIS PROPOSAL — IT REPLACES IT. The server's edit
 * (`PUT /api/ai/pending/{id}`) validates the changed arguments as a *new*
 * version and supersedes this one, so what comes back has its own id, its own
 * nonce and `version + 1`, and still has to be confirmed. That is why the
 * card's own override is keyed on the id of the action it was *given*
 * (`mine.for`) rather than the id of the action it is *showing*: the earlier
 * `local.id === action.id` test quietly discarded the edited version and put
 * the superseded one back on screen, which read as "the edit did nothing"
 * while the server had already replaced the proposal.
 */
export function ActionCard({ action, onChange, elsewhere }: {
  action: PendingAction;
  onChange?: (a: PendingAction) => void;
  /** Quick Ask: nothing is confirmed here — the card is reviewed in the main window. */
  elsewhere?: () => void;
}) {
  const qc = useQueryClient();
  // What this card itself last did wins over the list it came from, which catches up on refetch.
  const [mine, setMine] = useState<{ for: number; action: PendingAction } | null>(null);
  const a = mine && mine.for === action.id ? mine.action : action;
  const setA = (next: PendingAction) => setMine({ for: action.id, action: next });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
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

      {editing ? (
        <div className="mt-2.5 rounded-[10px] border border-line bg-ground p-2.5">
          <p className="mb-2 text-[12px] text-ink-2">
            Change what the assistant proposed. Saving does not do it — WorkSuite checks the change and asks you to confirm the new version.
          </p>
          <div className="space-y-2">
            {fields(a.arguments).map(([key, value]) => {
              const id = `edit-${a.id}-${key}`;
              const long = value.length > 60 || value.includes('\n');
              return (
                <div key={key}>
                  <label htmlFor={id} className="mb-0.5 block text-[11.5px] font-semibold text-ink-2">{humanise(key)}</label>
                  {long ? (
                    <textarea id={id} rows={4} value={editing[key] ?? ''} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                      className="w-full resize-y rounded-[8px] border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink" />
                  ) : (
                    <input id={id} type="text" value={editing[key] ?? ''} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                      className="h-8 w-full rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
                  )}
                </div>
              );
            })}
          </div>
          {fields(a.arguments).length === 0 ? (
            <p className="text-[12px] text-ink-3">This proposal has nothing on it you can type over. Cancel it and ask for what you want instead.</p>
          ) : null}
          {kept(a.arguments).length ? (
            <p className="mt-2 text-[11.5px] text-ink-3">
              Left as it is: {kept(a.arguments).map(humanise).join(', ')}. The record this is about never changes with an edit.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-2 rounded-[8px] bg-danger-bg px-2 py-1.5 text-[12px] text-danger">{error}</p> : null}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {open && elsewhere ? (
          <button type="button" onClick={elsewhere} className={cx(btn, 'bg-primary text-white hover:bg-primary-hover')}>
            Review in WorkSuite
          </button>
        ) : null}
        {open && !elsewhere && editing ? (
          <>
            <button type="button" disabled={!!busy || fields(a.arguments).length === 0}
              onClick={() => void act('edit', async () => {
                const next = await editAction(a.id, merge(a.arguments, editing));
                setEditing(null);
                return next;
              })}
              className={cx(btn, 'bg-primary text-white hover:bg-primary-hover')}>
              {busy === 'edit' ? 'Checking…' : 'Save changes'}
            </button>
            <button type="button" disabled={!!busy} onClick={() => { setEditing(null); setError(null); }} className={cx(btn, 'text-ink-2 hover:bg-subtle')}>
              Keep it as it was
            </button>
          </>
        ) : null}
        {open && !elsewhere && !editing ? (
          <>
            <button type="button" disabled={!!busy} onClick={() => void act('confirm', () => confirmAction(a))}
              className={cx(btn, 'text-white', outside ? 'bg-danger hover:opacity-90' : 'bg-primary hover:bg-primary-hover')}>
              {busy === 'confirm' ? 'Doing it…' : outside ? 'Confirm and send' : 'Confirm'}
            </button>
            <button type="button" disabled={!!busy} onClick={() => { setError(null); setEditing(asText(a.arguments)); }} className={cx(btn, 'border border-line text-ink hover:bg-subtle')}>
              Edit
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

/**
 * WHAT AN EDIT MAY TOUCH. The desktop does not know any tool's argument
 * schema — the server owns that and validates the result — so the form offers
 * the arguments a person can sensibly type over: the strings and numbers. An
 * object or a list (a row set, a structured attachment) is left exactly as the
 * assistant built it and sent back unchanged, because retyping one as text
 * would be a guess at a shape only the server knows.
 *
 * The server additionally pins any argument named in the tool's endpoint path
 * back to its original value, so an edit "changes what is done, never what it
 * is done to". Those are listed as left alone rather than hidden, so nobody
 * types into a box whose value is quietly going to be ignored.
 */
function fields(args: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(args)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => [k, String(v)] as [string, string]);
}

function kept(args: Record<string, unknown>): string[] {
  return Object.entries(args).filter(([, v]) => !(typeof v === 'string' || typeof v === 'number')).map(([k]) => k);
}

function asText(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(fields(args));
}

/**
 * The typed-over values back onto the arguments the assistant built. A box
 * always holds text, so an argument that arrived as a number goes back as a
 * number — sending `"3"` where the tool declared an integer is a validation
 * failure the person cannot see the cause of. Text that is no longer a number
 * is sent as it was typed and refused by name on the server, which is the
 * clearer error of the two.
 */
function merge(args: Record<string, unknown>, typed: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const [k, v] of Object.entries(typed)) {
    out[k] = typeof args[k] === 'number' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return out;
}

/** `recipient_email` → `Recipient email`, so a field reads as a label and not as a column name. */
function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statusWord(s: PendingAction['status'], left: number): string {
  if (s === 'awaiting_confirmation' && left <= 0) return 'Expired — ask again';
  return {
    awaiting_confirmation: '', executing: 'Doing it…', succeeded: 'Done', failed: 'Failed', cancelled: 'Cancelled',
    expired: 'Expired — ask again', superseded: 'Replaced by an edit', submitted_for_approval: 'Sent for approval',
    rejected: 'Rejected', undone: 'Undone',
  }[s];
}
