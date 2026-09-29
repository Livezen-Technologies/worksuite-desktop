import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { GARAGE_REPORTS, type GarageDoc } from '@shared/garage-docs';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PageHead } from '../hr/parts';
import { download, errorText, gGet, K, money, type Report, type ReportList } from './api';
import { input, Section, useGarage } from './parts';

type ReportName = (typeof GARAGE_REPORTS)[number];
const isReport = (s: string): s is ReportName => (GARAGE_REPORTS as readonly string[]).includes(s);

/**
 * Garage reports (FR-ANL-01..06): what the workshop did, as facts — job
 * aging, technician work (no composite scores), estimate against actual,
 * quality and rework, parts consumption, and for people who may see money,
 * revenue and job profitability. A CSV goes to the downloads folder through
 * the download manager, for people who may export.
 */
export default function Reports() {
  const g = useGarage();
  const list = useQuery({ queryKey: K.reports(g.org), queryFn: ({ signal }) => gGet<ReportList>('/reports', { org: g.org }, signal) });
  const [pick, setPick] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const name = pick || list.data?.reports[0]?.key || '';
  const filters = { org: g.org, from, to, branch_id: branch };
  const q = useQuery({ queryKey: K.report(name, filters), enabled: name !== '', queryFn: ({ signal }) => gGet<Report>(`/reports/${name}`, filters, signal), placeholderData: keepPreviousData });
  const branches = g.options.branches.filter((b) => b.garage);

  const csv = async () => {
    if (!isReport(name)) return;
    const query: Extract<GarageDoc, { kind: 'report' }>['query'] = {};
    if (/^\d+$/.test(g.org)) query.org = g.org;
    if (from) query.from = from;
    if (to) query.to = to;
    if (branch) query.branch_id = branch;
    setBusy(true);
    try {
      await download({ kind: 'report', report: name, query }, `garage-${name}${from ? `-${from}` : ''}${to ? `-to-${to}` : ''}.csv`, false);
      toast('success', 'Saving the CSV to your downloads — see Transfers.');
    } catch (e) {
      toast('error', errorText(e, 'The export could not be made.'));
    } finally {
      setBusy(false);
    }
  };

  const fmt = (v: string | number | null | undefined, isMoney?: boolean) => (v === null || v === undefined ? '—' : isMoney ? money(Number(v), g.options.currency) : typeof v === 'number' ? v.toLocaleString() : v);

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Reports" sub="What the workshop did, from its own records.">
        {list.data?.export && name ? (
          <Button icon="download" loading={busy} disabled={!g.online} onClick={() => void csv()}>
            CSV
          </Button>
        ) : null}
      </PageHead>
      {list.isLoading ? (
        <Spinner />
      ) : list.error || !list.data ? (
        <ErrorNote error={list.error ?? new Error('Reports could not be loaded.')} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <nav className="flex flex-wrap gap-1" aria-label="Reports">
            {list.data.reports.map((r) => (
              <button
                key={r.key}
                type="button"
                title={r.about}
                aria-current={name === r.key ? 'page' : undefined}
                onClick={() => setPick(r.key)}
                className={cx('h-7 rounded-[8px] px-2.5 text-[12px] font-semibold', name === r.key ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}
              >
                {r.title}
              </button>
            ))}
          </nav>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-[12px] text-ink-3">
              From
              <input type="date" className={cx(input, 'w-40')} aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-0.5 text-[12px] text-ink-3">
              To
              <input type="date" className={cx(input, 'w-40')} aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            {branches.length > 1 ? <Select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]} className={cx(input, 'w-48')} /> : null}
          </div>
          {q.isLoading ? (
            <Spinner />
          ) : q.error || !q.data ? (
            name ? <ErrorNote error={q.error ?? new Error('This report could not be run.')} onRetry={() => void q.refetch()} /> : <p className="text-[13px] text-ink-3">No reports are open to you.</p>
          ) : (
            <Section title={q.data.title}>
              <p className="m-0 mb-3 text-[12px] text-ink-3">{q.data.about}</p>
              {q.data.rows.length === 0 ? (
                <p className="m-0 text-[13px] text-ink-3">Nothing in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-[11px] text-ink-3">
                        {q.data.columns.map((c, i) => (
                          <th key={c.key} className={cx('py-1.5 pr-3 font-semibold', i > 0 && 'text-right')}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.rows.map((r, n) => (
                        <tr key={n} className="border-b border-line/70 last:border-b-0">
                          {q.data!.columns.map((c, i) => (
                            <td key={c.key} className={cx('py-1.5 pr-3', i > 0 && 'text-right tabular-nums')}>
                              {fmt(r[c.key], c.money)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
