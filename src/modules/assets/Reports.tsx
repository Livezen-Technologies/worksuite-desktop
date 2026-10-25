import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal } from '../finance/api';
import { BASE, toCsv } from './api';
import { Btn, Card, Note, PageHead, Pills, Table, td, tdr } from './parts';

/**
 * Reports (D20): valuation, depreciation, assignments, maintenance cost, warranty, licences and disposals — each the
 * server's rows and totals, computed when asked. Copy (for a spreadsheet), Save CSV…, Save PDF and Print (⌘P).
 */
const KINDS: Array<[string, string]> = [['valuation', 'Valuation'], ['depreciation', 'Depreciation'], ['assignment', 'Assignments'], ['maintenance', 'Maintenance cost'], ['warranty', 'Warranty'], ['licenses', 'Licences'], ['disposal', 'Disposals']];

export interface Report {
  kind: string;
  currency?: string;
  basis?: string;
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
}

const MONEY = /(cost|nbv|value|accumulated|monthly|proceeds|gain|loss|amount|total|price|charge)/;
const label = (k: string) => (k === 'nbv' ? 'Book value' : k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));

/** The columns a report shows: every key the rows carry, ids left out. */
export function columnsOf(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.includes(k) && k !== 'id' && !k.endsWith('_id') && (r[k] === null || typeof r[k] !== 'object')) seen.push(k);
  return seen;
}
const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

/** Tab-separated, as a spreadsheet pastes it. */
export function toTsv(cols: string[], rows: Report['rows']): string {
  const clean = (v: unknown) => cell(v).replace(/[\t\r\n]+/g, ' ');
  return [cols.map(label), ...rows.map((r) => cols.map((c) => clean(r[c])))].map((r) => r.join('\t')).join('\n');
}

export function reportHtml(title: string, cols: string[], rows: Report['rows'], basis?: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:9pt;margin:12mm}h1{font-size:14pt}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:1.5mm 2mm;text-align:left}td.r{text-align:right}</style></head><body><h1>${esc(title)}</h1>${basis ? `<p>${esc(basis)}</p>` : ''}<table><thead><tr>${cols.map((c) => `<th>${esc(label(c))}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td${MONEY.test(c) ? ' class="r"' : ''}>${esc(cell(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}

export default function Reports({ org, kind, onKind, onUnfiled }: { org: number; kind: string; onKind: (k: string) => void; onUnfiled: () => void }) {
  const k = KINDS.some(([x]) => x === kind) ? kind : 'valuation';
  const q = useQuery({ queryKey: ['assets', 'report', k, org], queryFn: ({ signal }) => apiGet<Report>(`${BASE}/reports`, { kind: k, org: org || undefined }, signal) });
  const title = KINDS.find(([x]) => x === k)![1];
  const rows = q.data?.rows ?? [];
  const cols = columnsOf(rows);
  const totals = q.data?.totals ?? {};
  const safe = (p: Promise<unknown>) => void p.catch((e) => toast('error', refusal(e)));

  return (
    <div className="flex flex-col gap-3">
      <PageHead title={title} sub={q.data?.currency ? `Amounts in ${q.data.currency}` : undefined}>
        <Btn disabled={!rows.length} onClick={() => safe(navigator.clipboard.writeText(toTsv(cols, rows)).then(() => toast('success', 'Copied — paste into a spreadsheet.')))}>Copy</Btn>
        <Btn disabled={!rows.length} onClick={() => safe(call('files:saveText', { name: `assets-${k}.csv`, text: toCsv(cols.map(label), rows.map((r) => cols.map((c) => cell(r[c])))) }))}>Save CSV…</Btn>
        <Btn disabled={!rows.length} onClick={() => safe(call('print:toPdf', { html: reportHtml(`Assets · ${title}`, cols, rows, q.data?.basis), title: `Assets ${title}` }))}>PDF</Btn>
        <Btn disabled={!rows.length} onClick={() => safe(call('print:print', { html: reportHtml(`Assets · ${title}`, cols, rows, q.data?.basis), title: `Assets ${title}` }))}>Print</Btn>
      </PageHead>
      <Pills label="Report" value={k} onChange={onKind} options={KINDS.map(([id, l]) => ({ id, label: l }))} />
      {q.data?.basis ? <Note>{q.data.basis}</Note> : null}
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        <Table head={cols.map((c) => (MONEY.test(c) ? [label(c), 'r'] : label(c)))}>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className={MONEY.test(c) ? tdr : td}>{cell(r[c])}</td>
              ))}
            </tr>
          ))}
          {Object.keys(totals).length ? (
            <tr className="font-bold">
              {cols.map((c, i) => (
                <td key={c} className={MONEY.test(c) ? tdr : td}>{i === 0 ? 'Total' : cell(totals[c])}</td>
              ))}
            </tr>
          ) : null}
        </Table>
        {q.data && !rows.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">Nothing to report.</p> : null}
      </Card>
      {org ? (
        <p className="m-0 text-[12px] text-ink-3">
          Assets with no company are not in a company's figures.{' '}
          <button type="button" className="font-semibold text-primary" onClick={onUnfiled}>File them</button>
        </p>
      ) : null}
    </div>
  );
}
