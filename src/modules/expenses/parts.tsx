import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { btnPrimary } from '../hr/parts';
import { Pill } from '../inventory/parts';

/**
 * The pieces every Expenses screen shares: the status pill, the engines'
 * refusals and warnings shown as written, and the state a one-company screen
 * shows when several companies are selected.
 */

const TONE: Record<string, 'blue' | 'amber' | 'red' | 'green' | 'grey'> = {
  submitted: 'amber',
  requested: 'amber',
  pending: 'amber',
  approved: 'blue',
  disbursed: 'blue',
  processing: 'blue',
  rejected: 'red',
  cancelled: 'grey',
  paid: 'green',
  settled: 'green',
  draft: 'grey',
  exported: 'green',
  void: 'grey',
  matched: 'green',
  unmatched: 'amber',
  ignored: 'grey',
  flagged: 'amber',
  clear: 'green',
  active: 'green',
  closed: 'grey',
};

/** "needs_receipt" → "Needs receipt". */
export const words = (v: string | null | undefined) => {
  const s = (v ?? '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={TONE[status] ?? 'grey'}>{words(status)}</Pill>;
}

/** A refusal or a warning from the policy or budget engines — the server's sentence, never reworded. */
export interface Hit {
  rule: string;
  policy?: string | null;
  message: string;
  severity?: 'block' | 'warn';
}

/** Refusals, in full. A control that says "policy violation" instead of the rule and both figures is a control people route around. */
export function Blocks({ items }: { items: Hit[] | null | undefined }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((h, i) => (
        <div key={`${h.rule}-${i}`} className="flex items-start gap-2 rounded-[9px] border border-[#F1B8A8] bg-[#FDF1EE] px-3 py-2 text-[12.5px] text-[#8C2A14] dark:border-danger/40 dark:bg-danger-bg dark:text-danger">
          <Icon name="x" size={14} className="mt-0.5 shrink-0" />
          <span>
            {h.message}
            {h.policy ? <span className="ml-1 opacity-75">({h.policy})</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Warnings: allowed, and said. */
export function Warnings({ items }: { items: Hit[] | null | undefined }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((h, i) => (
        <div key={`${h.rule}-${i}`} className="flex items-start gap-2 rounded-[9px] border border-[#F5D48A] bg-[#FFF8E6] px-3 py-2 text-[12.5px] text-[#7A3B05] dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <span>
            {h.message}
            {h.policy ? <span className="ml-1 opacity-75">({h.policy})</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * What a one-company screen says when several are selected: the screen, the
 * reason in a sentence, and the click that resolves it — never one company's
 * figures under a heading naming several.
 */
export function OneCompany({ label, count, onNarrow }: { label: string; count: number; onNarrow: () => void }) {
  return (
    <div className="m-6 flex max-w-[520px] flex-col items-start gap-2.5 rounded-[12px] border border-line bg-surface px-5 py-4">
      <b className="text-[15px] text-ink">{label} shows one company at a time</b>
      <span className="text-[13px] text-ink-2">
        You have {count === 0 ? 'every company' : `${count} companies`} selected. This screen books, edits or reports on figures that belong to a single set of books, so it needs to know which one.
      </span>
      <button type="button" className={btnPrimary} onClick={onNarrow}>
        Show one company
      </button>
      <span className="text-[12px] text-ink-3">The dashboard and the claim lists add companies up.</span>
    </div>
  );
}

export interface QuickCounts {
  approvals: number;
  unmatchedCards: number;
  owedToYou: number;
  advances: number;
  renewing: number;
}

/**
 * What needs a person, in words, above every screen — and nothing at all when
 * nothing does. It fetches nothing: the counts are the rail's and the
 * dashboard's. Ordered by whose problem it is: what waits on you before what
 * is owed to you.
 */
export function QuickBar({ counts, onGo, canApprove, canFinance }: { counts: QuickCounts; onGo: (v: 'approvals' | 'cards' | 'advances' | 'subs' | 'mine') => void; canApprove: boolean; canFinance: boolean }) {
  const chips: Array<{ key: 'approvals' | 'cards' | 'advances' | 'subs' | 'mine'; label: string; warn: boolean }> = [];
  const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
  if (canApprove && counts.approvals > 0) chips.push({ key: 'approvals', label: `${counts.approvals} to approve`, warn: true });
  if (canFinance && counts.unmatchedCards > 0) chips.push({ key: 'cards', label: `${n(counts.unmatchedCards, 'card line', 'card lines')} unmatched`, warn: true });
  if (counts.advances > 0) chips.push({ key: 'advances', label: `${n(counts.advances, 'advance', 'advances')} to settle`, warn: true });
  if (counts.renewing > 0) chips.push({ key: 'subs', label: `${counts.renewing} renewing in 30 days`, warn: false });
  if (counts.owedToYou > 0) chips.push({ key: 'mine', label: `${counts.owedToYou} of yours awaiting payment`, warn: false });
  if (!chips.length) return null;
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-surface/95 px-6 py-2 backdrop-blur">
      <span className="text-[12px] font-semibold text-ink-3">Needs you</span>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onGo(c.key)}
          className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold', c.warn ? 'bg-[#FFF4E0] text-[#9A4A06] hover:bg-[#FDEBC8] dark:bg-warning-bg dark:text-warning' : 'bg-subtle text-ink-2 hover:bg-line')}
        >
          <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', c.warn ? 'bg-[#E59A2F]' : 'bg-ink-3')} />
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** A sentence in a bordered card, for a screen with nothing to show yet. */
export function Note({ children }: { children: ReactNode }) {
  return <div className="m-6 max-w-[620px] rounded-[12px] border border-line bg-surface px-5 py-4 text-[13px] text-ink-2">{children}</div>;
}
