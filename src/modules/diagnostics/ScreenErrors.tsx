import { useState } from 'react';
import { screenErrors } from '../../core/screen-errors';
import { useStore } from '../../core/store';
import { Button, cx } from '../../components/ui';

/**
 * Errors caught in this window (worksuite-desktop#338): each screen's boundary keeps what it caught with a short
 * reference, shown on its error screen. Opened from there, Diagnostics shows that one error — module, account,
 * reference, the error and where it was thrown — with the rest a click away. They are in the log too, by reference.
 */
export function ScreenErrors({ focus }: { focus: string | null }) {
  const errors = useStore(screenErrors, (s) => s.errors);
  const [all, setAll] = useState(false);
  const named = focus ? errors.filter((e) => e.ref === focus) : [];
  const shown = focus && !all && named.length ? named : errors;
  if (!errors.length && !focus) return null;
  return (
    <section aria-label="Errors in this window" className="mt-8 rounded-[12px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-ink">{focus && !all ? `Error ${focus}` : 'Errors in this window'}</h2>
        {focus && !all && errors.length > shown.length ? (
          <Button size="sm" onClick={() => setAll(true)}>
            Show all ({errors.length})
          </Button>
        ) : null}
      </div>
      {focus && !named.length ? <p className="mt-2 text-[12.5px] text-ink-3">{`Nothing caught in this window has the reference ${focus}. It is in the log: create a diagnostic report and send it with the reference.`}</p> : null}
      <ul className="mt-3 flex flex-col gap-2">
        {shown.map((e) => (
          <li key={e.ref} data-error-ref={e.ref} className={cx('rounded-[10px] border px-4 py-3', e.ref === focus ? 'border-danger bg-danger-bg/40' : 'border-line')}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
              <b className="font-mono text-ink selectable">{e.ref}</b>
              <span className="font-semibold text-ink">{e.module}</span>
              {e.account ? <span className="text-ink-3">{`account ${e.account}`}</span> : null}
              <span className="text-ink-3">{new Date(e.at).toLocaleString()}</span>
            </div>
            <div className="mt-1 text-[12.5px] text-danger selectable">{`${e.name}: ${e.message}`}</div>
            {e.stack ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[12px] text-ink-3">Where it happened</summary>
                <pre className="selectable mt-1 max-h-48 overflow-auto rounded-[8px] bg-subtle p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-2">{e.stack}</pre>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
