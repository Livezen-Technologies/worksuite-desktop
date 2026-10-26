import { useMemo, useState } from 'react';
import { call as desktop, hasDesktop } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Chip, cx, Empty, IconButton, Spinner } from '../../../components/ui';
import { phoneApi, useExtensions, useHistory, type CallFilters, type CallRow } from '../api';
import { usePhoneAccess } from '../access';
import { placeCall } from '../dial';
import { toCsv } from '../lib/csv';
import { clock, daysAgo, dispositionLabel, dispositionTone, isoDay, money, otherParty, prettyNumber, stamp } from '../lib/format';
import { DirectionGlyph, Mono, PageBody, PageHeader, Panel, Refused, TD, TR, Table } from '../parts';
import { usePhoneState } from '../softphone/client';
import { clickOnKey } from '../../../components/press';

/**
 * W04 · Call history (VOIP-HIS-01/02/05/08, VOIP-POP-05). Your calls, or the whole team's for supervisors (the server
 * decides: `voip.reports`). Filters by date, direction, outcome, extension and queue; each row links the record the
 * caller is to the business, the agent, queue, outcome, ring and talk time, cost only where the trunk has a rate,
 * and the recording. An unknown number offers "Create contact".
 */
type Range = 'today' | '7d' | '30d' | '90d';
const RANGES: Record<Range, { label: string; days: number }> = { today: { label: 'Today', days: 0 }, '7d': { label: 'Last 7 days', days: 6 }, '30d': { label: 'Last 30 days', days: 29 }, '90d': { label: 'Last 90 days', days: 89 } };
const PER_PAGE = 50;

export default function History() {
  const { go, openInNewTab } = useTab();
  const access = usePhoneAccess();
  const exts = useExtensions();
  const own = usePhoneState((s) => s.extension);
  const [q, setQ] = useState('');
  const [range, setRange] = useState<Range>('7d');
  const [direction, setDirection] = useState('');
  const [disposition, setDisposition] = useState('');
  const [extension, setExtension] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const filters: CallFilters = useMemo(
    () => ({ page, per_page: PER_PAGE, from: daysAgo(RANGES[range].days), to: isoDay(new Date()), q: q.trim() || undefined, direction: direction || undefined, disposition: disposition || undefined, extension_id: extension || undefined }),
    [page, range, q, direction, disposition, extension],
  );
  const h = useHistory(filters);
  const calls = h.data?.calls ?? [];
  const total = h.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  /** VOIP-HIS-08: every page of what the filters show, as CSV (Core's export is the server's own path). */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: CallRow[] = [];
      for (let p = 1; p <= 50; p += 1) {
        const r = await phoneApi.history({ ...filters, page: p, per_page: 100 });
        rows.push(...r.calls);
        if (rows.length >= r.total || r.calls.length === 0) break;
      }
      const csv = toCsv(
        ['Started', 'Direction', 'From', 'To', 'Extension', 'Agent', 'Queue', 'Outcome', 'Ring (s)', 'Talk (s)', 'Cost', 'Recording', 'Notes'],
        rows.map((c) => [c.started_at, c.direction, c.from, c.to, c.extension, c.agent, c.queue, dispositionLabel(c.disposition), c.ring, c.talk, c.rated === false ? '' : c.cost || '', c.recording_id ? 'yes' : '', c.notes]),
      );
      const name = `calls-${filters.from}-to-${filters.to}.csv`;
      const where = hasDesktop() ? await desktop('files:saveText', { name, text: csv }) : null;
      if (where) toast('success', `${rows.length} calls exported.`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Calls"
        sub={access.reports ? 'Supervisors see the whole team' : 'Showing your calls'}
        actions={
          <Button icon="download" loading={exporting} disabled={!total} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        }
      />
      <PageBody>
        <Panel bodyClassName="flex flex-col gap-3 pt-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-ink-3">
                <Icon name="search" size={14} />
              </span>
              <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Number, contact or agent" aria-label="Search calls" className="h-8 w-[240px] rounded-[8px] border border-line bg-surface pr-2 pl-8 text-[12.5px] outline-none focus:border-primary" />
            </div>
            <FilterSelect label="Date" value={range} onChange={reset(setRange)} options={Object.entries(RANGES).map(([id, r]) => ({ value: id as Range, label: r.label }))} />
            <FilterSelect label="Direction" value={direction} onChange={reset(setDirection)} options={[{ value: '', label: 'All' }, { value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }, { value: 'internal', label: 'Internal' }]} />
            <FilterSelect
              label="Outcome"
              value={disposition}
              onChange={reset(setDisposition)}
              options={[{ value: '', label: 'All' }, { value: 'answered', label: 'Answered' }, { value: 'no_answer', label: 'No answer' }, { value: 'busy', label: 'Busy' }, { value: 'cancelled', label: 'Abandoned' }, { value: 'failed', label: 'Failed' }]}
            />
            {access.reports ? (
              <FilterSelect
                label="Extension"
                value={extension}
                onChange={reset(setExtension)}
                options={[{ value: '', label: 'Any' }, ...(exts.data ?? []).map((e) => ({ value: String(e.id), label: `${e.extension} · ${e.name}${e.extension === own ? ' (you)' : ''}` }))]}
              />
            ) : null}
          </div>
          {h.isLoading ? (
            <Spinner />
          ) : h.error ? (
            <Refused error={h.error} onRetry={() => void h.refetch()} />
          ) : calls.length === 0 ? (
            <Empty icon="history" title="No calls match" hint="Calls placed with the dial pad are recorded when they start; inbound calls appear once the phone system reports them." />
          ) : (
            <Table head={['', 'Caller / callee', 'Linked record', 'Agent', 'Queue', 'Outcome', 'Ring', 'Talk', 'Cost', 'Rec', 'Started', '']}>
              {calls.map((c) => {
                const other = otherParty(c);
                const known = c.contact?.name ?? c.linked?.label ?? null;
                return (
                  <tr tabIndex={0} onKeyDown={clickOnKey} key={c.id} className={cx(TR, 'cursor-pointer')} onClick={() => go(`/phone/calls/${c.id}`)}>
                    <td className={TD}>
                      <DirectionGlyph direction={c.direction} disposition={c.disposition} />
                    </td>
                    <td className={TD}>
                      <div className="font-semibold text-ink">{c.contact?.name ?? (prettyNumber(other) || 'Unknown caller')}</div>
                      <Mono className="text-[11px] text-ink-3">{prettyNumber(other)}</Mono>
                    </td>
                    <td role="presentation" className={TD} onClick={(e) => e.stopPropagation()}>
                      {c.linked ? (
                        <button type="button" className="text-primary underline" onClick={() => openInNewTab(linkRoute(c.linked!.kind, c.linked!.id), c.linked!.label)}>
                          {c.linked.label}
                        </button>
                      ) : known ? (
                        <span>{known}</span>
                      ) : other && c.direction !== 'internal' ? (
                        <button type="button" className="text-primary underline" onClick={() => openInNewTab(`/contacts?new=1&mobile=${encodeURIComponent(other.replace(/[^0-9+]/g, ''))}`, 'New contact')}>
                          Create contact…
                        </button>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className={TD}>
                      {c.extension ? `${c.extension}` : '—'}
                      {c.extension && c.extension === own ? <span className="text-ink-3"> · You</span> : c.agent ? <span className="text-ink-3"> · {c.agent}</span> : null}
                    </td>
                    <td className={TD}>{c.queue ?? '—'}</td>
                    <td className={TD}>
                      <Chip tone={dispositionTone(c.disposition)}>{dispositionLabel(c.disposition)}</Chip>
                    </td>
                    <td className={TD}>
                      <Mono>{clock(c.ring)}</Mono>
                    </td>
                    <td className={TD}>
                      <Mono>{clock(c.talk)}</Mono>
                    </td>
                    <td className={TD}>
                      <Mono>{c.rated === false || !c.cost ? '—' : money(c.cost)}</Mono>
                    </td>
                    <td className={TD}>{c.recording_id ? <Icon name="play" size={14} className="text-primary" label="Has a recording" /> : <span className="text-ink-3">—</span>}</td>
                    <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{stamp(c.started_at)}</td>
                    <td role="presentation" className={TD} onClick={(e) => e.stopPropagation()}>
                      {other ? <IconButton icon="phone" label={`Call ${prettyNumber(other)}`} onClick={() => void placeCall(other, { name: c.contact?.name ?? null, contactId: c.contact?.id ?? null })} className="text-success" /> : null}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
          <div className="flex items-center justify-between text-[12px] text-ink-3">
            <span>
              {total ? `${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, total)} of ${total.toLocaleString()} calls` : ''} · cost shown only where the trunk has a rate
            </span>
            <span className="flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </span>
          </div>
        </Panel>
      </PageBody>
    </div>
  );
}

/** Where a call's linked record opens in the desktop. */
export function linkRoute(kind: string, id: number): string {
  switch (kind) {
    case 'contact':
      return `/contacts?open=${id}`;
    case 'account':
    case 'customer':
      return `/crm?account=${id}`;
    case 'lead':
      return `/crm/leads/${id}`;
    case 'deal':
      return `/crm?deal=${id}`;
    case 'quote':
      return `/crm?quote=${id}`;
    case 'invoice':
      return `/billing?invoice=${id}`;
    case 'task':
    case 'ticket':
      return `/tasks?task=${id}`;
    default:
      return '/crm';
  }
}

function FilterSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface pr-1 pl-2.5 text-[12px] text-ink-3">
      {label}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className="h-7 max-w-[180px] bg-transparent font-semibold text-ink outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
