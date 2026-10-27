import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { money } from '../finance/api';
import { PAYMENT_LABEL, type Payslip, type Profile } from './api';
import { dayLong } from './dates';
import { ALL, companiesOf, fetchCertificates, groupLines, inCompany, lineLabel, QUERY_KIND, raiseQuery, unsigned, type PayslipDetail } from './pay';
import { Empty, Field, PageHead, Panel, Sheet, StatusChip, btn, btnPrimary, btnSmall, row } from '../../components/PageKit';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * My payslips (UI-23, HrSelfService · My pay; SRS §D1): the latest payslip with its net pay and PDF, every payslip
 * across the companies I am paid by, the year so far, my annual tax certificates, and one payslip's breakdown —
 * earnings, deductions and what my employer paid on top — with "Ask a question about this payslip", which raises a
 * payroll query in HR. Only runs locked for payment show here. Every figure is the server's.
 */
export default function MyPay() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState<number | 0>(0);
  const [company, setCompany] = useState(ALL);
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const list = useQuery({ queryKey: ['hr', 'payslips', year], queryFn: ({ signal }) => apiGet<{ payslips: Payslip[]; linked: boolean }>('/api/payroll/me/payslips', year ? { year } : undefined, signal) });
  const ytdYear = year || thisYear;
  const summary = useQuery({ queryKey: ['hr', 'pay-summary', ytdYear], queryFn: ({ signal }) => apiGet<{ linked: boolean; summary: { year: number; months: number; gross: string; deductions: string; net: string } | null }>('/api/payroll/me/summary', { year: ytdYear }, signal) });
  const certs = useQuery({ queryKey: ['hr', 'tax-certificates'], queryFn: ({ signal }) => fetchCertificates(signal), retry: false });
  const kinds = useQuery({ queryKey: ['hr', 'request-kinds'], queryFn: ({ signal }) => apiGet<{ kinds: Array<{ value: string; label: string }> }>('/api/hr/requests/kinds', undefined, signal), retry: false, staleTime: 300_000 });
  const me = useQuery({ queryKey: ['hr', 'me'], queryFn: ({ signal }) => apiGet<Profile>('/api/hr/me/profile', undefined, signal), retry: false });
  const all = list.data?.payslips ?? [];
  const companies = companiesOf(all);
  const slips = inCompany(all, company);
  const latest = slips[0];
  const current = open && slips.some((s) => s.reference === open) ? open : (latest?.reference ?? null);
  const detail = useQuery({
    queryKey: ['hr', 'payslip', current],
    queryFn: ({ signal }) => apiGet<PayslipDetail>(`/api/payroll/me/payslips/${encodeURIComponent(current!)}`, undefined, signal),
    enabled: !!current,
  });
  const cur = (s: Payslip | undefined) => s?.currency ?? 'LKR';
  const canAsk = (kinds.data?.kinds ?? []).some((k) => k.value === QUERY_KIND) && !!me.data?.employee?.id;
  const state = (s: Payslip) => (s.state === 'under_revision' ? 'Being corrected' : s.state === 'cancelled' ? 'Cancelled' : PAYMENT_LABEL[s.payment.state]);

  const pdf = async (s: Payslip) => {
    try {
      await call('transfers:download', { payslip: s.reference, name: `Payslip ${s.period_name ?? s.reference}.pdf`, open: true });
      toast('success', 'Downloading your payslip.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const certificate = async (reference: string, yearLabel: string) => {
    try {
      await call('transfers:download', { payrollDoc: { kind: 'tax-certificate', id: reference }, name: `Tax certificate ${yearLabel.replace('/', '-')}.pdf`, open: true });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const d = detail.data;
  const g = d ? groupLines(d.lines) : null;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="My payslips" sub={`${me.data?.employee?.name ? `${me.data.employee.name} · ` : ''}only you can see these`}>
        {companies.length > 1 ? (
          <Select aria-label="Company" value={company} onChange={(e) => (setCompany(e.target.value), setOpen(null))} className="h-[34px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink">
            <option value={ALL}>All my companies</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        ) : null}
        <Select aria-label="Year" value={year} onChange={(e) => (setYear(Number(e.target.value)), setOpen(null))} className="h-[34px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink">
          <option value={0}>All years</option>
          {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => (
            <option key={y} value={y}>
              {`Year ${y}`}
            </option>
          ))}
        </Select>
      </PageHead>

      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && !list.data.linked ? <Empty text="Your login is not linked to an employee record, so there is no pay to show." /> : null}

      {latest ? (
        <div className="flex items-center gap-4 rounded-[12px] border border-line bg-surface px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">
              {[latest.employer?.name, latest.period_name, latest.payment.on ? `paid ${dayLong(latest.payment.on)}` : state(latest)].filter(Boolean).join(' · ')}
            </div>
            <b className="text-[24px] text-ink tabular-nums">{money(latest.net, cur(latest))}</b>
            <div className="text-[12.5px] text-ink-2">{latest.bank?.last4 ? `Net pay to ${latest.bank.name ?? 'your bank'} •••• ${latest.bank.last4}` : 'Net pay'}</div>
          </div>
          <button type="button" className={btnPrimary} onClick={() => void pdf(latest)}>
            Download PDF
          </button>
        </div>
      ) : null}

      {summary.data?.summary ? (
        <StatGrid min={200}>
          <Tile icon="calendar" tone="blue" label={`${summary.data.summary.year} so far`} value={`${summary.data.summary.months} ${summary.data.summary.months === 1 ? 'month' : 'months'}`} />
          <Tile icon="banknote" tone="violet" label="Gross, year to date" value={money(summary.data.summary.gross, cur(latest))} />
          <Tile icon="minus" tone="amber" label="Deductions, year to date" value={money(summary.data.summary.deductions, cur(latest))} />
          <Tile icon="wallet" tone="green" label="Net, year to date" value={money(summary.data.summary.net, cur(latest))} />
        </StatGrid>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
        <div className="flex flex-col gap-3">
          <Panel title="All payslips">
            {list.data?.linked && !slips.length ? <Empty text={year ? `No payslips for ${year} yet.` : 'No payslips yet.'} /> : null}
            {slips.map((s) => (
              <button key={s.reference} type="button" onClick={() => setOpen(s.reference)} aria-current={s.reference === current ? 'true' : undefined} className={cx(row, 'w-full text-left hover:bg-subtle', s.reference === current && 'bg-selection')}>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{s.period_name ?? s.reference}</b>
                  <span className="text-[11.5px] text-ink-3">{[s.employer?.name, s.kind ? s.kind.replace('_', '-') : null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="w-[130px] shrink-0 text-right font-mono text-[12px]">{money(s.net, cur(s))}</span>
                <span className="w-[150px] shrink-0 text-right">
                  <StatusChip>{state(s)}</StatusChip>
                </span>
              </button>
            ))}
          </Panel>
          {certs.data?.length ? (
            <Panel title="Tax certificates">
              {certs.data.map((c) => (
                <div key={c.reference} className={row}>
                  <span className="min-w-0 flex-1">
                    <b>{c.year}</b> <span className="text-ink-2">{c.title ?? 'Annual tax certificate'}</span>
                    {c.employer ? <span className="block text-[11.5px] text-ink-3">{c.employer}</span> : null}
                  </span>
                  <button type="button" className={btnSmall} onClick={() => void certificate(c.reference, c.year)}>
                    Download
                  </button>
                </div>
              ))}
            </Panel>
          ) : null}
        </div>

        {current ? (
          <Panel title={d ? `${d.payslip.period_name ?? 'Payslip'} breakdown` : 'Payslip'} action={d ? <StatusChip>{state(d.payslip)}</StatusChip> : null} bodyClassName="flex flex-col gap-1.5 p-3.5">
            {detail.isLoading ? <Spinner /> : detail.error ? <ErrorNote error={detail.error} onRetry={() => void detail.refetch()} /> : null}
            {d && g ? (
              <>
                {d.payslip.revision_note ? <div className="rounded-[8px] bg-warning-bg px-2.5 py-2 text-[12px] font-semibold text-warning">{d.payslip.revision_note}</div> : null}
                <span className="text-[12px] text-ink-3">
                  {[d.payslip.employer?.name, d.payslip.period_starts_on && d.payslip.period_ends_on ? `${dayLong(d.payslip.period_starts_on)} – ${dayLong(d.payslip.period_ends_on)}` : null, d.payslip.paid_days ? `${d.payslip.paid_days} paid days` : null].filter(Boolean).join(' · ')}
                </span>
                {g.earnings.map((l, i) => (
                  <Line key={`e${i}`} label={lineLabel(l)} value={money(l.amount)} />
                ))}
                <Line label="Gross pay" value={money(d.payslip.gross)} strong />
                {g.deductions.map((l, i) => (
                  <Line key={`d${i}`} label={lineLabel(l)} value={`−${money(unsigned(l.amount))}`} bad />
                ))}
                <Line label="Net pay" value={money(d.payslip.net, cur(d.payslip))} strong />
                {g.employer.length ? <p className="m-0 mt-1 text-[12px] text-ink-2">{`Your employer also paid ${g.employer.map((l) => `${l.label} (${money(l.amount)})`).join(' and ')} for you.`}</p> : null}
                {(d.loans ?? []).map((l, i) => (
                  <p key={i} className="m-0 text-[12px] text-ink-2">{`${l.label} balance after this month: ${money(l.balance)}`}</p>
                ))}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={btn} onClick={() => void pdf(d.payslip)}>
                    Payslip as a PDF
                  </button>
                  {canAsk ? (
                    <button type="button" className={btn} onClick={() => setAsking(true)}>
                      Ask a question about this payslip
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </Panel>
        ) : null}
      </div>
      {asking && d && me.data?.employee?.id ? <AskSheet employeeId={me.data.employee.id} payslip={d.payslip} onClose={() => setAsking(false)} /> : null}
    </div>
  );
}

function AskSheet({ employeeId, payslip, onClose }: { employeeId: number; payslip: Payslip; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await raiseQuery(employeeId, payslip, text);
      toast('success', 'Sent to HR. You will see the answer under Requests.');
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Ask about this payslip"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !text.trim()} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send to HR'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">{`Your question about ${payslip.period_name ?? 'this payslip'} goes to HR as a payroll query.`}</p>
      <Field label="Your question">
        <textarea autoFocus aria-label="Your question" value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary" />
      </Field>
    </Sheet>
  );
}

function Line({ label, value, strong, bad }: { label: string; value: string; strong?: boolean; bad?: boolean }) {
  return (
    <div className={cx('flex text-[12.5px]', strong && 'mt-0.5 border-t border-line pt-1.5 font-bold')}>
      <span className={cx('flex-1', strong ? 'text-ink' : 'text-ink-2')}>{label}</span>
      <span className={cx('font-mono tabular-nums', bad ? 'text-danger' : 'text-ink')}>{value}</span>
    </div>
  );
}

function Tile({ label, value, icon, tone }: { label: string; value: string; icon?: string; tone?: StatTone }) {
  return <StatCard label={label} value={value} icon={icon} tone={tone} />;
}
