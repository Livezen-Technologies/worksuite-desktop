import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { ReasonSheet } from '../finance/parts';
import { humanise } from '../hr/parts';
import { groupLines, unsigned } from '../hr/pay';
import type { PayLine } from '../hr/api';
import {
  acceptException, calculateRun, fetchAudit, fetchPayouts, fetchPosting, fetchRun, fetchVariance, K, KIND_LABEL, percent, rejectBlock, rejectRun, runTitle, STATUS_LABEL, submitRun, validateRun,
  type RunDetail,
} from './api';
import { Badge, Card, Kbd, NotYet, Table, amt, td, tdr, useReadOnly } from './parts';

/**
 * A run's workspace (DRunHead + D04–D07): the header with the run's figures and its next act — Recalculate (⌘R),
 * Submit, Reject, Approve — and the tabs Summary · Employees · Variance · Validation · Journal · Payslips · Payment ·
 * History. Everything shown is the server's; offline (D25) it is the last copy and every act is off.
 */
export type RunTab = 'summary' | 'employees' | 'variance' | 'validation' | 'journal' | 'payslips' | 'payment' | 'history';
const TABS: RunTab[] = ['summary', 'employees', 'variance', 'validation', 'journal', 'payslips', 'payment', 'history'];

export default function RunWorkspace({ id, figures, tab, active, onTab, onBack, onApprove, onEmployee }: {
  id: number; figures: boolean; tab: string; active: boolean; onTab: (t: RunTab) => void; onBack: () => void; onApprove: () => void; onEmployee: (employeeId: number) => void;
}) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.run(id), queryFn: ({ signal }) => fetchRun(id, signal) });
  const t: RunTab = (TABS as string[]).includes(tab) ? (tab as RunTab) : 'summary';
  const [rejecting, setRejecting] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['payroll'] });
  const act = useMutation({
    mutationFn: (what: 'calc' | 'submit') => (what === 'calc' ? calculateRun(id) : submitRun(id)),
    onSuccess: (_r, what) => (toast('success', what === 'calc' ? 'Recalculated.' : 'Submitted for approval.'), refresh()),
    onError: (e) => toast('error', refusal(e)),
  });
  const d = q.data;
  const canCalc = !!d && !ro && d.can.calculate && ['draft', 'calculated', 'failed', 'rejected'].includes(d.run.status);

  // ⌘R — recalculate (DRunHead), while this tab is in front.
  useEffect(() => {
    if (!active || !canCalc) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (!act.isPending) act.mutate('calc');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, canCalc, act]);

  if (q.isLoading) return <Spinner />;
  if (q.error || !d) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const { run, payslips, counts } = d;
  const cur = run.currency ?? '';
  const show = figures && d.can.figures;
  const m = (v?: string | null) => (show ? amt(v) : '—');
  const held = payslips.filter((p) => p.status === 'held').length;
  const noReject = ro ? 'Offline' : rejectBlock(d, 0);
  const label: Record<RunTab, string> = {
    summary: 'Summary', employees: `Employees ${payslips.length}`, variance: 'Variance', validation: `Validation ${counts.blocking || ''}`.trim(), journal: 'Journal', payslips: 'Payslips', payment: 'Payment', history: 'History',
  };

  return (
    <div className="flex flex-col gap-2.5">
      <section className="rounded-[10px] border border-line bg-surface px-4 pt-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] text-ink-2">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={onBack}>Runs</button> / <span className="font-mono">{run.reference ?? `RUN-${run.id}`}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-[19px] font-extrabold text-ink">{runTitle(run)}</h1>
              <Badge status="ne">{KIND_LABEL[run.kind] ?? run.kind}</Badge>
              <Badge status={run.status}>{STATUS_LABEL[run.status] ?? run.status}</Badge>
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-2">
              {[run.period_starts_on && run.period_ends_on ? `${shortDate(run.period_starts_on)} – ${shortDate(run.period_ends_on)}` : null, cur || null, run.prepared_by?.name ? `prepared by ${run.prepared_by.name}` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          {ro ? <span className="self-center text-[12px] font-semibold text-warning">Read-only while offline</span> : null}
          {canCalc ? (
            <button type="button" disabled={act.isPending} onClick={() => act.mutate('calc')} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
              {act.isPending && act.variables === 'calc' ? 'Calculating…' : 'Recalculate'} <Kbd>⌘R</Kbd>
            </button>
          ) : null}
          {!ro && d.can.submit && run.status === 'calculated' ? (
            <button type="button" disabled={act.isPending || counts.blocking > 0} title={counts.blocking > 0 ? 'Blocking issues first' : undefined} onClick={() => act.mutate('submit')} className="inline-flex h-8 items-center rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50">
              Submit for approval
            </button>
          ) : null}
          {run.status === 'submitted' && d.can.approve ? (
            <>
              <button type="button" disabled={!!noReject} title={noReject ?? undefined} onClick={() => setRejecting(true)} className="inline-flex h-8 items-center rounded-[7px] border border-[#F1B8A8] bg-surface px-3 text-[12.5px] font-semibold text-danger disabled:opacity-50 dark:border-danger/40">
                Reject…
              </button>
              <button type="button" disabled={ro} onClick={onApprove} className="inline-flex h-8 items-center rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50">
                Approve run
              </button>
            </>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2">
          <Fig label="Employees" value={String(run.employee_count ?? payslips.length)} sub={held ? `${held} held` : `${payslips.length} on the run`} />
          <Fig label="Gross" value={m(run.gross_total)} />
          <Fig label="Deductions" value={m(run.deduction_total)} />
          <Fig label="Net pay" value={m(run.net_total)} strong />
          <Fig label="Employer cost" value={m(run.employer_total)} />
        </div>
        <div role="tablist" aria-label="Run" className="mt-2.5 flex gap-1 overflow-x-auto">
          {TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={x === t} onClick={() => onTab(x)} className={cx('h-9 shrink-0 border-b-2 px-2.5 text-[12.5px] font-semibold', x === t ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
              {label[x]}
            </button>
          ))}
        </div>
      </section>
      {!show ? <p className="m-0 text-[12px] text-ink-3">You can see who is on this run but not the amounts. The payroll figures grant opens them.</p> : null}

      {t === 'summary' ? <Summary d={d} onTab={onTab} onApprove={onApprove} /> : null}
      {t === 'employees' ? <Employees d={d} show={show} onEmployee={onEmployee} /> : null}
      {t === 'variance' ? <VarianceTab id={id} show={show} /> : null}
      {t === 'validation' ? <Validation d={d} ro={ro} onChanged={refresh} /> : null}
      {t === 'journal' ? <Journal id={id} ro={ro} cur={cur} /> : null}
      {t === 'payslips' ? <PayslipsTab d={d} show={show} /> : null}
      {t === 'payment' ? <Payment id={id} cur={cur} /> : null}
      {t === 'history' ? <History id={id} /> : null}

      {rejecting ? (
        <ReasonSheet
          title="Reject this run"
          body="The run goes back to the preparer, with your reason. Its signatures are withdrawn."
          label="Reason"
          action="Reject run"
          danger
          onOk={(r) =>
            void rejectRun(id, r).then(
              () => (toast('success', 'Sent back to the preparer.'), setRejecting(false), refresh()),
              (e) => toast('error', refusal(e)),
            )
          }
          onClose={() => setRejecting(false)}
        />
      ) : null}
    </div>
  );
}

function Fig({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-[8px] border border-line px-2.5 py-2">
      <div className="text-[11px] font-semibold text-ink-2">{label}</div>
      <div className={cx('text-[15px] font-extrabold tabular-nums', strong ? 'text-[#1B2A85] dark:text-primary' : 'text-ink')}>{value}</div>
      {sub ? <div className="text-[10.5px] text-ink-2">{sub}</div> : null}
    </div>
  );
}

function Summary({ d, onTab, onApprove }: { d: RunDetail; onTab: (t: RunTab) => void; onApprove: () => void }) {
  const { counts, run } = d;
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Card title="Where this run is">
        <div className="flex flex-col gap-2 px-3.5 pb-3 text-[12.5px]">
          <Row ok={counts.blocking === 0} text={counts.blocking ? `${counts.blocking} blocking ${counts.blocking === 1 ? 'issue' : 'issues'}` : 'No blocking issues'} onClick={() => onTab('validation')} />
          <Row ok text={`${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}`} onClick={() => onTab('validation')} />
          <Row ok={run.status !== 'draft'} text={run.status === 'draft' ? 'Not calculated yet' : 'Calculated'} />
          {run.status === 'submitted' && d.can.approve ? (
            <button type="button" className="mt-1 self-start font-bold text-primary hover:underline" onClick={onApprove}>
              Review the checks and the journal, then approve
            </button>
          ) : null}
        </div>
      </Card>
      <Card title="Approval chain">
        <div className="flex flex-col gap-1.5 px-3.5 pb-3 text-[12.5px]">
          {(d.approvals ?? []).length ? (
            (d.approvals ?? []).map((a) => (
              <div key={`${a.step}-${a.decided_at ?? ''}`} className="flex gap-2">
                <b className="w-5">{a.step}</b>
                <span className="flex-1">{a.label ?? `Step ${a.step}`}{a.decided_by_name ? ` · ${a.decided_by_name}` : ''}</span>
                <Badge status={a.status === 'approved' ? 'done' : a.status === 'pending' ? 'waiting' : 'ne'}>{humanise(a.status)}</Badge>
              </div>
            ))
          ) : (
            <span className="text-ink-3">Not submitted yet.</span>
          )}
        </div>
      </Card>
    </div>
  );
}

function Row({ ok, text, onClick }: { ok: boolean; text: string; onClick?: () => void }) {
  return (
    <button type="button" disabled={!onClick} onClick={onClick} className="flex items-center gap-2 text-left enabled:hover:underline">
      <span aria-hidden className={cx('flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold text-white', ok ? 'bg-success' : 'bg-danger')}>{ok ? '✓' : '!'}</span>
      {text}
    </button>
  );
}

function Employees({ d, show, onEmployee }: { d: RunDetail; show: boolean; onEmployee: (id: number) => void }) {
  const [filter, setFilter] = useState('');
  const [only, setOnly] = useState<'all' | 'flagged' | 'held'>('all');
  const [sel, setSel] = useState<number | null>(d.payslips[0]?.id ?? null);
  const flagged = new Set(d.exceptions.map((x) => x.employee_id).filter(Boolean));
  const f = filter.trim().toLowerCase();
  const rows = d.payslips.filter((p) => (!f || `${p.employee_no ?? ''} ${p.employee_name ?? ''} ${p.department ?? ''}`.toLowerCase().includes(f)) && (only === 'all' || (only === 'held' ? p.status === 'held' : flagged.has(p.employee_id))));
  const pick = d.payslips.find((p) => p.id === sel) ?? null;
  const lines = useQuery({ queryKey: ['payroll', 'lines', sel], queryFn: ({ signal }) => apiGet<{ lines: PayLine[] }>(`/api/payroll/payslips/${sel}/lines`, undefined, signal), enabled: show && !!sel });
  const g = lines.data ? groupLines(lines.data.lines) : null;
  return (
    <div className="flex gap-2.5">
      <Card className="min-w-0 flex-[999_1_520px]">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-2 text-[11.5px]">
          <input aria-label="Filter employees" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-7 w-[150px] rounded-[7px] border border-line bg-surface px-2 text-[12px] text-ink outline-none focus:border-primary" />
          {(['all', 'flagged', 'held'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={only === k} onClick={() => setOnly(k)} className={cx('h-[26px] rounded-[13px] border px-2.5 font-semibold', only === k ? 'border-primary bg-[#EAEDFB] text-[#23349E] dark:bg-selection dark:text-primary' : 'border-line bg-surface text-ink-2')}>
              {k === 'all' ? `All ${d.payslips.length}` : k === 'flagged' ? `Flagged ${d.payslips.filter((p) => flagged.has(p.employee_id)).length}` : `Held ${d.payslips.filter((p) => p.status === 'held').length}`}
            </button>
          ))}
        </div>
        <Table head={['Employee', ['Days', 'r'], ['Gross', 'r'], ['Net', 'r'], 'Flag']}>
          {rows.map((p) => (
            <tr key={p.id} onClick={() => setSel(p.id)} aria-selected={p.id === sel} className={cx('cursor-default', p.id === sel ? 'bg-[#EEF1FD] shadow-[inset_3px_0_0_#23349E] dark:bg-selection' : 'hover:bg-subtle', p.status === 'held' && 'text-ink-2')}>
              <td className={td}><b>{p.employee_name ?? '—'}</b> <span className="text-ink-2">{p.department ? `· ${p.department}` : ''}</span></td>
              <td className={tdr}>{p.paid_days ?? '—'}</td>
              <td className={tdr}>{show ? amt(p.gross) : '—'}</td>
              <td className={tdr}><b>{show ? amt(p.net) : '—'}</b></td>
              <td className={td}>
                {p.status === 'held' ? <Badge status="blocked">Held</Badge> : null}
                {p.balanced === 0 ? <Badge status="failed">Does not add up</Badge> : null}
                {flagged.has(p.employee_id) && p.status !== 'held' ? <Badge status="open">Flagged</Badge> : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {pick ? (
        <aside aria-label="Selected employee" className="flex flex-[1_1_280px] flex-col rounded-[10px] border border-line bg-surface px-3.5 py-3 text-[12px]">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-ink">{pick.employee_name}</div>
              <div className="text-[11px] text-ink-2">{[pick.employee_no, pick.designation].filter(Boolean).join(' · ')}</div>
            </div>
            <button type="button" className="text-[11.5px] font-semibold text-primary hover:underline" onClick={() => onEmployee(pick.employee_id)}>Profile ↗</button>
          </div>
          {!show ? <p className="mt-2 text-ink-3">Amounts need the payroll figures grant.</p> : lines.isLoading ? <Spinner /> : g ? (
            <>
              <Head>Earnings</Head>
              {g.earnings.map((l, i) => <Ln key={i} a={l.label} b={amt(l.amount)} />)}
              <Ln a="Gross" b={amt(pick.gross)} strong />
              <Head>Deductions</Head>
              {g.deductions.map((l, i) => <Ln key={i} a={l.label} b={amt(unsigned(l.amount))} />)}
              <Ln a="Net pay" b={amt(pick.net)} strong />
              {g.employer.length ? <Head>Employer</Head> : null}
              {g.employer.map((l, i) => <Ln key={i} a={l.label} b={amt(l.amount)} />)}
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

const Head = ({ children }: { children: string }) => <div className="mt-2 text-[10.5px] font-bold tracking-[.6px] text-ink-2 uppercase">{children}</div>;
const Ln = ({ a, b, strong }: { a: string; b: string; strong?: boolean }) => (
  <div className={cx('flex justify-between py-[3px]', strong && 'border-t border-line font-bold')}>
    <span>{a}</span>
    <span className="tabular-nums">{b}</span>
  </div>
);

function VarianceTab({ id, show }: { id: number; show: boolean }) {
  const [threshold, setThreshold] = useState(10);
  const q = useQuery({ queryKey: [...K.variance(id), threshold], queryFn: ({ signal }) => fetchVariance(id, signal, threshold), enabled: show, retry: false });
  if (!show) return <Card><p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">The variance needs the payroll figures grant.</p></Card>;
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const v = q.data;
  if (v === null || !v) return <Card><NotYet what="The run variance" /></Card>;
  const tone = (p: string | number | null, flagged: boolean) => cx(tdr, flagged ? 'font-bold text-[#8A5200] dark:text-warning' : Number(p) > 0 ? 'text-[#23349E] dark:text-primary' : Number(p) < 0 ? 'text-[#C2410C]' : '');
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[12px] text-ink-2">
        <span>{v.previous_run_id ? `Compared with run ${v.previous_run_id}` : 'No earlier run to compare with'}</span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5">
          Flag above
          <Select aria-label="Flag above" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
            {[5, 10, 15, 20, 25].map((n) => <option key={n} value={n}>{`${n}%`}</option>)}
          </Select>
        </label>
      </div>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2.5">
        <Card title="By component">
          <Table head={['Component', ['Before', 'r'], ['Now', 'r'], ['Change', 'r']]}>
            {v.components.map((c) => (
              <tr key={c.code ?? c.label}>
                <td className={td}>{c.label}</td>
                <td className={tdr}>{amt(c.prev)}</td>
                <td className={tdr}>{amt(c.current)}</td>
                <td className={tone(c.pct, c.flagged)}>{percent(c.pct) ?? '—'}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className={td}>Net pay</td>
              <td className={tdr}>{amt(v.totals.prev_net)}</td>
              <td className={tdr}>{amt(v.totals.net)}</td>
              <td className={tdr}>{percent(v.totals.pct) ?? '—'}</td>
            </tr>
          </Table>
        </Card>
        <Card title="Largest movers">
          <Table head={['Employee', 'Why', ['Net change', 'r']]}>
            {[...v.employees].sort((a, b) => Math.abs(Number(b.diff ?? 0)) - Math.abs(Number(a.diff ?? 0))).slice(0, 12).map((e) => (
              <tr key={e.employee_id}>
                <td className={td}>{e.name}</td>
                <td className={cx(td, 'text-ink-2')}>{e.why ?? (e.prev_net === null ? 'New' : percent(e.pct) ?? '')}</td>
                <td className={tone(e.pct, e.flagged)}>{amt(e.diff)}</td>
              </tr>
            ))}
          </Table>
          <p className="m-0 px-3.5 py-2 text-[11px] text-ink-2">Blue = up · orange = down · held people are left out</p>
        </Card>
      </div>
    </div>
  );
}

function Validation({ d, ro, onChanged }: { d: RunDetail; ro: boolean; onChanged: () => void }) {
  const check = useMutation({ mutationFn: () => validateRun(d.run.id), onError: (e) => toast('error', refusal(e)) });
  const [accepting, setAccepting] = useState<number | null>(null);
  const blocking = d.exceptions.filter((x) => x.severity === 'blocking');
  const warnings = d.exceptions.filter((x) => x.severity !== 'blocking');
  const block = (title: string, list: typeof blocking, red: boolean) => (
    <Card title={`${title} ${list.length}`}>
      {!list.length ? <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">None.</p> : null}
      {list.map((x) => (
        <div key={x.id} className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 text-[12.5px]">
          <span aria-hidden className={cx('flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[11px] font-bold', red ? 'bg-[#FDECEA] text-[#B42318]' : 'bg-[#FFF4DB] text-[#8A5200]')}>{x.code.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <b>{x.employee_name ? `${x.employee_name} — ` : ''}{x.message ?? humanise(x.code)}</b>
            <div className="text-[11.5px] text-ink-2">{humanise(x.status ?? 'open')}</div>
          </span>
          {(x.status ?? 'open') === 'open' && !ro && (red ? d.can.approve : d.can.edit) && x.employee_id !== d.self_employee_id ? (
            <button type="button" className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle" onClick={() => setAccepting(x.id)}>
              {red ? 'Accept in writing…' : 'Acknowledge'}
            </button>
          ) : null}
        </div>
      ))}
    </Card>
  );
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12px] text-ink-2">{check.data ? `${check.data.counts.employees} employees checked · ${check.data.counts.blocking} blocking · ${check.data.counts.warnings} warnings` : 'The checks run on the server.'}</span>
        <button type="button" disabled={ro || !d.can.calculate || check.isPending} onClick={() => check.mutate(undefined, { onSuccess: onChanged })} className="h-8 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink disabled:opacity-50">
          {check.isPending ? 'Checking…' : 'Run the checks again'}
        </button>
      </div>
      {block('Blocking', blocking, true)}
      {block('Warnings', warnings, false)}
      {accepting ? (
        <ReasonSheet
          title="Accept this issue"
          body="Accepting says in writing that the run may go ahead with it. Your name and reason are kept."
          label="Reason"
          action="Accept"
          onOk={(r) => void acceptException(accepting, r).then(() => (setAccepting(null), onChanged()), (e) => toast('error', refusal(e)))}
          onClose={() => setAccepting(null)}
        />
      ) : null}
    </div>
  );
}

function Journal({ id, ro, cur }: { id: number; ro: boolean; cur: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.posting(id), queryFn: ({ signal }) => fetchPosting(id, signal) });
  const post = useMutation({
    mutationFn: () => apiPost<{ journal_no: string }>(`/api/payroll/runs/${id}/post`, {}),
    onSuccess: (r) => (toast('success', `Posted as ${r.journal_no}.`), void qc.invalidateQueries({ queryKey: K.posting(id) })),
    onError: (e) => toast('error', refusal(e)),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  return (
    <Card title="Journal" action={!p.posted && p.can.post ? <button type="button" disabled={ro || !p.ok || post.isPending} onClick={() => post.mutate()} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white disabled:opacity-50">Post to Finance</button> : p.posted ? <Badge status="done">In the books</Badge> : null}>
      {p.problems.length ? <p className="m-0 px-3.5 pb-2 text-[12.5px] text-danger">{p.problems.join(' ')}</p> : null}
      {p.lines?.length ? (
        <Table head={['Account', 'Role', ['Debit', 'r'], ['Credit', 'r']]}>
          {p.lines.map((l, i) => (
            <tr key={i}>
              <td className={td}>{[l.account_code, l.account_name].filter(Boolean).join(' ')}</td>
              <td className={cx(td, 'font-mono text-[11px] text-ink-2')}>{l.role}</td>
              <td className={tdr}>{l.debit && Number(l.debit) ? amt(l.debit) : ''}</td>
              <td className={tdr}>{l.credit && Number(l.credit) ? amt(l.credit) : ''}</td>
            </tr>
          ))}
          {p.totals ? (
            <tr className="font-bold">
              <td className={td}>Total</td>
              <td className={cx(td, p.totals.balanced ? 'text-success' : 'text-danger')}>{p.totals.balanced ? 'Balanced' : 'Not balanced'}</td>
              <td className={tdr}>{amt(p.totals.debit, cur)}</td>
              <td className={tdr}>{amt(p.totals.credit, cur)}</td>
            </tr>
          ) : null}
        </Table>
      ) : (
        <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">{p.posted ? 'This run is in the books.' : 'The journal lines show once this server previews them.'}</p>
      )}
    </Card>
  );
}

function PayslipsTab({ d, show }: { d: RunDetail; show: boolean }) {
  const pdf = async (id: number, name: string) => {
    try {
      await call('transfers:download', { payrollDoc: { kind: 'run-payslip', id: String(id) }, name: `Payslip ${name}.pdf`, open: true });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (!['approved', 'locked', 'paying', 'paid'].includes(d.run.status)) return <Card><p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Payslips are made once the run is approved.</p></Card>;
  return (
    <Card title="Payslips">
      <Table head={['Employee', ['Net', 'r'], '']}>
        {d.payslips.map((p) => (
          <tr key={p.id}>
            <td className={td}>{p.employee_name}</td>
            <td className={tdr}>{show ? amt(p.net) : '—'}</td>
            <td className={tdr}>{show ? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void pdf(p.id, `${d.run.period_name ?? d.run.id} ${p.employee_no ?? p.id}`)}>PDF</button> : null}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Payment({ id, cur }: { id: number; cur: string }) {
  const q = useQuery({ queryKey: ['payroll', 'payouts', id], queryFn: ({ signal }) => fetchPayouts(id, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data?.batches ?? [];
  return (
    <Card title="Payment batches">
      {!b.length ? <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">No payment batch yet. Batches are made in Disbursements once the run is locked.</p> : null}
      <Table head={['Batch', 'Method', ['Lines', 'r'], ['Amount', 'r'], 'Status']}>
        {b.map((x) => (
          <tr key={x.id}>
            <td className={cx(td, 'font-mono text-[11px]')}>{x.reference ?? `PAY-${x.id}`}</td>
            <td className={td}>{humanise(x.method ?? 'bank')}</td>
            <td className={tdr}>{x.line_count ?? '—'}</td>
            <td className={tdr}>{amt(x.total, x.currency ?? cur)}</td>
            <td className={td}><Badge status={x.status}>{humanise(x.status)}</Badge></td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function History({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['payroll', 'audit', id], queryFn: ({ signal }) => fetchAudit(id, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Card title="History">
      <Table head={['When', 'What', 'Who', 'Reason']}>
        {(q.data?.items ?? []).map((a) => (
          <tr key={a.id}>
            <td className={td}>{a.created_at.slice(0, 16)}</td>
            <td className={td}>{a.label ?? humanise(a.event)}{a.after ? ` · ${a.after}` : ''}</td>
            <td className={td}>{a.actor_name ?? '—'}</td>
            <td className={cx(td, 'whitespace-normal text-ink-2')}>{a.reason ?? ''}</td>
          </tr>
        ))}
      </Table>
      {q.data && !q.data.items.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nothing recorded yet.</p> : null}
    </Card>
  );
}

