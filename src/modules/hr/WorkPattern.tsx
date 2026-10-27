import { useQuery } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { apiGet } from '../../core/api';
import { useStore } from '../../core/store';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { dayLong } from './dates';
import { Cell, Empty, PageHead, Panel, row, THead } from '../../components/PageKit';
import { can } from './Rail';

/**
 * Work pattern (HrAdminSheet "Work pattern"; the web's WorkPattern): my own
 * attendance, leave and expense discipline over the month, and my team's
 * for whoever holds `hr.kpi.view`. It is not a performance score — sales and
 * goals are not measured, so a profile leaning on them shows its parts and
 * no total, and the screen says why instead of printing a number.
 */
type Withheld = 'low_coverage' | 'nothing_measurable' | null;

interface Components {
  attendance: number | null;
  leave: number | null;
  expenses: number | null;
}

interface Score {
  period: { from: string; to: string };
  components: Components;
  total: number | null;
  band: string | null;
  coverage: number;
  withheld: Withheld;
  profile: { name: string; assignment: string } | null;
  inputs?: {
    scheduled_days: number;
    present_days: number;
    holiday_days: number;
    leave_days: number;
    entitlement_known: boolean;
    linked: boolean;
    leave: { unapproved_absence_days: number; excess_leave_days: number | null; short_notice_leaves: number };
    expenses: { spent: number | null; budget: number | null; rejected_claims: number; claim_count: number };
  };
}

interface TeamRow {
  employee_id: number;
  employee_no: string | null;
  name: string;
  components: Components;
  total: number | null;
  band: string | null;
  coverage: number;
  withheld: Withheld;
}

const BAND_TONE: Record<string, string> = {
  Outstanding: 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success',
  Strong: 'bg-teal-bg text-teal-ink',
  'Meets expectations': 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  'Needs attention': 'bg-orange-bg text-orange-ink dark:bg-warning-bg dark:text-warning',
  Critical: 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger',
};

export function withheldReason(w: Withheld, coverage: number): string | null {
  if (w === 'low_coverage') return `Sales and goals are not measured yet, so only ${coverage}% of this profile can be scored — not enough for a total.`;
  if (w === 'nothing_measurable') return 'Nothing in this period could be measured — no scheduled days, no leave and no expenses.';
  return null;
}

function Band({ band, withheld }: { band: string | null; withheld: Withheld }) {
  if (band) return <span className={cx('inline-flex h-5 items-center rounded-[10px] px-2 text-[11.5px] font-bold whitespace-nowrap', BAND_TONE[band] ?? 'bg-subtle text-ink-2')}>{band}</span>;
  if (withheld) return <span className="inline-flex h-5 items-center rounded-[10px] bg-subtle px-2 text-[11.5px] font-bold whitespace-nowrap text-ink-2">{withheld === 'nothing_measurable' ? 'Nothing to measure' : 'Not scored'}</span>;
  return <span className="text-ink-3">—</span>;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Number(v).toFixed(0));

export default function WorkPattern() {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const team = can(perms, 'hr.kpi.view');
  const me = useQuery({ queryKey: ['hr', 'work-pattern', 'me'], queryFn: ({ signal }) => apiGet<{ linked: boolean; score: Score | null }>('/api/hr/work-pattern/me', undefined, signal) });
  const list = useQuery({
    queryKey: ['hr', 'work-pattern', 'team'],
    queryFn: ({ signal }) => apiGet<{ period: { from: string; to: string }; rows: TeamRow[]; total: number; truncated: boolean }>('/api/hr/work-pattern', undefined, signal),
    enabled: team,
  });

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Work pattern" sub="Attendance, leave and expense discipline over the month. Not a performance score: sales and goals are not measured yet." />
      {me.isLoading ? <Spinner /> : me.error ? <ErrorNote error={me.error} onRetry={() => void me.refetch()} /> : <MyScore data={me.data!} />}
      {team ? (
        <Panel
          title="Your team"
          action={list.data ? <span className="text-[12px] text-ink-3">{dayLong(list.data.period.from)} – {dayLong(list.data.period.to)}{list.data.truncated ? ` · showing ${list.data.rows.length} of ${list.data.total}` : ''}</span> : null}
        >
          <THead cols={[['Employee', null], ['Attendance', 90], ['Leave', 70], ['Expenses', 80], ['Score', 70], ['Band', 170]]} />
          {list.isLoading ? <Spinner /> : null}
          {list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          {list.data?.rows.map((r) => (
            <div key={r.employee_id} className={row}>
              <Cell w={null} className="font-semibold">
                {/^#\d+$/.test(r.name) && r.employee_no ? r.employee_no : r.name}
                {r.employee_no && !/^#\d+$/.test(r.name) ? <span className="ml-1.5 font-medium text-ink-3">{r.employee_no}</span> : null}
              </Cell>
              <Cell w={90} className="tabular-nums">{num(r.components.attendance)}</Cell>
              <Cell w={70} className="tabular-nums">{num(r.components.leave)}</Cell>
              <Cell w={80} className="tabular-nums">{num(r.components.expenses)}</Cell>
              <Cell w={70} className="font-bold tabular-nums">{r.total === null ? '—' : r.total.toFixed(1)}</Cell>
              <Cell w={170} className="!overflow-visible">
                <span title={withheldReason(r.withheld, r.coverage) ?? undefined}>
                  <Band band={r.band} withheld={r.withheld} />
                </span>
              </Cell>
            </div>
          ))}
          {list.data && !list.data.rows.length ? <Empty text="Nobody to show for this period." /> : null}
        </Panel>
      ) : null}
    </div>
  );
}

function MyScore({ data }: { data: { linked: boolean; score: Score | null } }) {
  const s = data.score;
  if (!data.linked || !s) return <Empty text="You have no employee record, so there is nothing to measure yet." />;
  const why = withheldReason(s.withheld, s.coverage);
  const i = s.inputs;
  const parts: Array<[string, number | null]> = [
    ['Attendance', s.components.attendance],
    ['Leave', s.components.leave],
    ['Expenses', s.components.expenses],
  ];
  return (
    <section aria-label="Your work pattern" className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <b className="text-ink">Your work pattern</b>
        <span className="text-[12px] text-ink-3">
          {dayLong(s.period.from)} – {dayLong(s.period.to)}
          {s.profile ? ` · ${s.profile.name}${s.profile.assignment === 'default' ? ' (company default)' : ''}` : ''}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <b className="text-[30px] leading-none text-ink tabular-nums">{s.total === null ? <span className="text-[20px] text-ink-3">Not scored</span> : s.total.toFixed(1)}</b>
        <Band band={s.band} withheld={s.total === null ? s.withheld : null} />
        <span className="text-[12px] text-ink-3">
          How this was worked out: {parts.map(([l, v]) => `${l} ${num(v)}`).join(' · ')} · covers {s.coverage}% of the full model
        </span>
      </div>
      {why ? <div className="rounded-[8px] bg-ground px-3 py-2 text-[12px] text-ink-2">{why}</div> : null}
      <div className="grid grid-cols-3 gap-2.5">
        {parts.map(([l, v]) => (
          <div key={l} className="flex flex-col rounded-[10px] bg-ground px-3 py-2.5">
            <span className="text-[12px] text-ink-3">{l}</span>
            <b className="text-[18px] text-ink tabular-nums">{num(v)}</b>
            {v === null ? <span className="text-[11px] text-ink-3">not applicable</span> : null}
          </div>
        ))}
      </div>
      {i ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-ink-2">
          <li>
            <b className="text-ink">Attendance:</b> present {i.present_days} of {i.scheduled_days} scheduled days — {i.holiday_days} public holiday(s) and {i.leave_days} on leave were not counted against you.
          </li>
          <li>
            <b className="text-ink">Leave:</b> {i.leave.unapproved_absence_days} unapproved absence day(s), {i.leave.short_notice_leaves} at short notice.
            {i.entitlement_known === false ? ' No leave entitlement is on file, so days beyond it were not charged.' : i.leave.excess_leave_days === null ? '' : ` ${i.leave.excess_leave_days} day(s) beyond entitlement.`}
          </li>
          <li>
            <b className="text-ink">Expenses:</b>{' '}
            {s.components.expenses === null
              ? i.linked === false
                ? 'your login is not linked to expense claims, so expenses are not scored.'
                : 'no budget is set and you filed no claims, so expenses are not scored.'
              : `${i.expenses.claim_count} claim(s), ${i.expenses.rejected_claims} rejected.${i.expenses.budget === null ? ' No budget is on file, so only claim compliance was scored.' : i.expenses.spent === null ? ` Budget ${i.expenses.budget}, nothing spent against it yet.` : ` ${i.expenses.spent} of ${i.expenses.budget} spent.`}`}
          </li>
        </ul>
      ) : null}
    </section>
  );
}
