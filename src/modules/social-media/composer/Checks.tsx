/**
 * W02 / D02 Create post — Checks (SMM-CMP-003/004, SMM-MED-004, SMM-CMP-015, AC-04): every variant checked live
 * against its account's capability set, errors first, each with the one-click fix that solves it.
 */
import { Button, cx } from '../../../components/ui';
import type { IssueFix } from '../lib/validate';
import { NetChip, Panel } from '../parts';
import type { DraftIssue } from './state';

const FIX_LABEL: Record<IssueFix, string> = {
  split_thread: 'Split into thread',
  shorten: 'Shorten (AI)',
  crop: 'Crop',
  remove_account: 'Remove account',
  add_alt_text: 'Add alt text',
  move_link_to_comment: 'Move link to first comment',
};

/** "X: 312 / 280 characters." in bold, the advice after it plain. */
function Message({ text }: { text: string }) {
  const m = /^(.*?\d+ \/ \d+ characters\.)\s*(.*)$/s.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <b className="font-bold">{m[1]}</b> {m[2]}
    </>
  );
}

export function Checks({ issues, readOnly, aiEnabled, onFix }: { issues: DraftIssue[]; readOnly?: boolean; aiEnabled: boolean; onFix: (issue: DraftIssue, fix: IssueFix) => void }) {
  return (
    <Panel title="Checks">
      {issues.length === 0 ? (
        <p className="text-[12.5px] text-success">Everything checks out for the chosen accounts.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Checks">
          {issues.map((i, k) => {
            const fixes: IssueFix[] = [];
            if (i.fix && (i.fix !== 'shorten' || aiEnabled)) fixes.push(i.fix);
            if (i.code === 'too_long' && i.fix === 'split_thread' && aiEnabled) fixes.push('shorten');
            return (
              <li key={`${i.network ?? 'o'}-${i.code}-${k}`} className={cx('flex items-start gap-2 rounded-[10px] px-2.5 py-2 text-[12.5px]', i.level === 'error' ? 'bg-danger-bg text-danger' : i.level === 'warning' ? 'bg-warning-bg text-warning-ink dark:text-warning' : 'bg-subtle text-ink-2')} data-level={i.level}>
                {i.network ? <NetChip network={i.network} size={20} /> : <span className="mt-px inline-block h-5 w-5 shrink-0 rounded-[6px] bg-line" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p>
                    <Message text={i.message} />
                  </p>
                  {fixes.length && !readOnly && i.network ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {fixes.map((f) => (
                        <Button key={f} size="sm" variant={i.level === 'error' ? 'secondary' : 'ghost'} onClick={() => onFix(i, f)}>
                          {FIX_LABEL[f]}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
