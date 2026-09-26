import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { PAYMENT_LABEL, type PayLine, type Payslip } from './api';
import { dayLong } from './dates';
import { Empty, PageHead, Panel, StatusChip, THead, row } from './parts';
import { Select } from '../../components/Select';

/**
 * My pay (HrSelfService · My pay): my payslips by year, what has been paid,
 * and one payslip's breakdown — earnings, deductions and the PDF. Only runs
 * that have been locked for payment show here, as on the web.
 */
export default function MyPay() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['hr', 'payslips', year], queryFn: ({ signal }) => apiGet<{ payslips: Payslip[]; linked: boolean }>('/api/payroll/me/payslips', { year }, signal) });
  const summary = useQuery({ queryKey: ['hr', 'pay-summary', year], queryFn: ({ signal }) => apiGet<{ linked: boolean; summary: { year: number; months: number; gross: string; deductions: string; net: string } | null }>('/api/payroll/me/summary', { year }, signal) });
  const slips = list.data?.payslips ?? [];
  const current = open ?? slips[0]?.reference ?? null;
  const detail = useQuery({
    queryKey: ['hr', 'payslip', current],
    queryFn: ({ signal }) => apiGet<{ payslip: Payslip; lines: PayLine[] }>(`/api/payroll/me/payslips/${encodeURIComponent(current!)}`, undefined, signal),
    enabled: !!current,
  });
  const currency = (s: Payslip | undefined) => s?.currency ?? 'LKR';

  const pdf = async (s: Payslip) => {
    try {
      await call('transfers:download', { payslip: s.reference, name: `Payslip ${s.period_name ?? s.reference}.pdf`, open: true });
      toast('success', 'Downloading your payslip.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="My pay" sub="Your payslips and what has been paid." />
      {summary.data?.summary ? (
        <div className="grid grid-cols-4 gap-2.5">
          <Tile label={`${year} so far`} value={`${summary.data.summary.months} ${summary.data.summary.months === 1 ? 'month' : 'months'}`} />
          <Tile label="Gross" value={`${currency(slips[0])} ${summary.data.summary.gross}`} />
          <Tile label="Deductions" value={`${currency(slips[0])} ${summary.data.summary.deductions}`} />
          <Tile label="Net" value={`${currency(slips[0])} ${summary.data.summary.net}`} />
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
        <Panel
          title="Payslips"
          action={
            <Select aria-label="Year" value={year} onChange={(e) => (setYear(Number(e.target.value)), setOpen(null))} className="h-[30px] rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink">
              {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </Select>
          }
        >
          <THead cols={[['Period', null], ['Net', 130], ['Paid', 150]]} />
          {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : null}
          {list.data && !list.data.linked ? <Empty text="Your login is not linked to an employee record, so there is no pay to show." /> : null}
          {list.data?.linked && !slips.length ? <Empty text={`No payslips for ${year} yet.`} /> : null}
          {slips.map((s) => (
            <button key={s.reference} type="button" onClick={() => setOpen(s.reference)} aria-current={s.reference === current ? 'true' : undefined} className={cx(row, 'w-full text-left hover:bg-subtle', s.reference === current && 'bg-selection')}>
              <span className="min-w-0 flex-1 truncate font-semibold">{s.period_name ?? s.reference}</span>
              <span className="w-[130px] shrink-0 font-mono text-[12px]">
                {currency(s)} {s.net ?? '—'}
              </span>
              <span className="w-[150px] shrink-0">
                <StatusChip>{s.state === 'under_revision' ? 'Being corrected' : s.state === 'cancelled' ? 'Cancelled' : PAYMENT_LABEL[s.payment.state]}</StatusChip>
              </span>
            </button>
          ))}
        </Panel>
        {current ? (
          <Panel title={detail.data?.payslip.period_name ?? 'Payslip'} action={detail.data ? <StatusChip>{detail.data.payslip.state === 'under_revision' ? 'Being corrected' : PAYMENT_LABEL[detail.data.payslip.payment.state]}</StatusChip> : null} bodyClassName="flex flex-col gap-2 p-3.5">
            {detail.isLoading ? <Spinner /> : detail.error ? <ErrorNote error={detail.error} onRetry={() => void detail.refetch()} /> : null}
            {detail.data ? (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  <Tile label="Gross" value={`${currency(detail.data.payslip)} ${detail.data.payslip.gross ?? '—'}`} small />
                  <Tile label="Deductions" value={`${currency(detail.data.payslip)} ${detail.data.payslip.deductions ?? '—'}`} small />
                  <Tile label="Net" value={`${currency(detail.data.payslip)} ${detail.data.payslip.net ?? '—'}`} small />
                </div>
                {detail.data.payslip.revision_note ? <div className="rounded-[8px] bg-warning-bg px-2.5 py-2 text-[12px] font-semibold text-warning">{detail.data.payslip.revision_note}</div> : null}
                <span className="text-[12px] text-ink-3">
                  {[detail.data.payslip.period_starts_on && detail.data.payslip.period_ends_on ? `${dayLong(detail.data.payslip.period_starts_on)} – ${dayLong(detail.data.payslip.period_ends_on)}` : null, detail.data.payslip.paid_days ? `${detail.data.payslip.paid_days} paid days` : null, detail.data.payslip.payment.on ? `paid ${dayLong(detail.data.payslip.payment.on)}` : detail.data.payslip.payment_date ? `pay date ${dayLong(detail.data.payslip.payment_date)}` : null].filter(Boolean).join(' · ')}
                </span>
                <b className="mt-1 text-ink">Breakdown</b>
                {detail.data.lines.map((l, i) => (
                  <div key={i} className="flex text-[12.5px]">
                    <span className="flex-1 text-ink-2">
                      {l.label}
                      {l.quantity && Number(l.quantity) !== 1 ? ` (${l.quantity})` : ''}
                    </span>
                    <span className={cx('font-mono', l.kind === 'deduction' ? 'text-danger' : 'text-ink')}>{l.kind === 'deduction' ? `−${l.amount}` : l.amount}</span>
                  </div>
                ))}
                <button type="button" className="mt-1 self-start font-bold text-primary hover:underline" onClick={() => void pdf(detail.data!.payslip)}>
                  Payslip as a PDF
                </button>
              </>
            ) : null}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className={cx('rounded-[8px] bg-surface', small ? 'border border-line px-2 py-1.5' : 'rounded-[12px] border border-line px-3.5 py-3')}>
      <div className="text-[11px] text-ink-3">{label}</div>
      <b className={cx('text-ink tabular-nums', small ? 'text-[13px]' : 'text-[18px]')}>{value}</b>
    </div>
  );
}
