import { useQueries, useQuery } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { call } from '../../core/bridge';
import { stampDayLabel, timeLabel } from '../../core/time';
import { Switch, cx } from '../../components/ui';
import { withOrg } from './api';
import { Sheet, btn, btnPrimary } from './parts';
import type { Audience, Campaign, MarketingList, Report, Segment, Starter, Template, Topic } from './types';

/**
 * What the email screens share: the reader's lists, segments, topics and
 * templates as the server sends them, the tab strip, a confirming sheet, how a
 * moment is written, and how a summary is saved to this computer.
 */

/** The companies' lists, for the audience pickers and the names in the campaigns table. */
export function useLists(org: string) {
  return useQuery({
    queryKey: ['marketing', 'lists', org, 'live'],
    queryFn: ({ signal }) => apiGet<{ items: MarketingList[] }>('/api/marketing/lists', withOrg(org), signal),
    staleTime: 60_000,
  });
}

/** The segments' names, uncounted: counting each is a query over every contact, and a picker needs none of it. */
export function useSegmentNames(org: string) {
  return useQuery({
    queryKey: ['marketing', 'segments', org, 'brief'],
    queryFn: ({ signal }) => apiGet<{ items: Segment[] }>('/api/marketing/segments', withOrg(org, { brief: 1 }), signal),
    staleTime: 60_000,
  });
}

export interface TopicsReply { items: Topic[]; suggested: Array<{ name: string; description: string }>; max: number }

export function useTopics(org: string) {
  return useQuery({
    queryKey: ['marketing', 'topics', org],
    queryFn: ({ signal }) => apiGet<TopicsReply>('/api/marketing/topics', withOrg(org), signal),
  });
}

/** The starters that come with Marketing, and every company's saved templates. */
export function useTemplates() {
  return useQuery({
    queryKey: ['marketing', 'templates'],
    queryFn: ({ signal }) => apiGet<{ items: Template[]; starters: Starter[] }>('/api/marketing/templates', undefined, signal),
  });
}

/** A campaign's audience in words: "Customers (list)", "Engaged vendors (segment) +2". */
export function audienceWords(a: Audience | null | undefined, lists: MarketingList[] | undefined, segments: Segment[] | undefined): string {
  if (!a) return '—';
  const named = [
    ...a.lists.map((id) => {
      const l = lists?.find((x) => x.id === id);
      return l ? `${l.name} (list)` : null;
    }),
    ...a.segments.map((id) => {
      const s = segments?.find((x) => x.id === id);
      return s ? `${s.name} (segment)` : null;
    }),
  ];
  const total = a.lists.length + a.segments.length;
  if (total === 0) return '—';
  const first = named.find(Boolean);
  if (!first) return total === 1 ? '1 list or segment' : `${total} lists and segments`;
  return total > 1 ? `${first} +${total - 1}` : first;
}

/** A moment on the reader's clock: "28 Sep 10:00". */
export function stamp(at: string | null | undefined): string {
  if (!at) return '—';
  const day = stampDayLabel(at, 'short');
  return day ? `${day} ${timeLabel(at)}` : '—';
}

/** A moment with its year: "28 Sep 2026 10:00". */
export function stampYear(at: string | null | undefined): string {
  if (!at) return '—';
  const day = stampDayLabel(at, 'year');
  return day ? `${day} ${timeLabel(at)}` : '—';
}

/** A wall-clock time in no zone ("6 Oct 09:00, wherever each person is"), as written: never read as an instant. */
export function wallWords(stampText: string | null | undefined): string {
  const m = stampText ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(stampText) : null;
  if (!m) return '—';
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, 12));
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${m[4]}:${m[5]}`;
}

/** Whether the bounce guard paused it (the server's note says so in words). */
export function bounceGuarded(c: Pick<Campaign, 'status' | 'status_note'>): boolean {
  return c.status === 'paused' && /bounced/i.test(c.status_note ?? '');
}

/** Copies delivered: sent and not bounced. */
export function delivered(c: Pick<Campaign, 'stats'>): number | null {
  return c.stats ? Math.max(0, c.stats.sent - c.stats.bounced) : null;
}

/**
 * Copies opened by a person, per campaign: the list's own figure (`stats.human`)
 * when the server sends it; from a server a part behind, each campaign's
 * report — fetched only for the campaigns that went out and lack it, and
 * shared with the report screen's cache. Null where neither says (still
 * loading, or the reader may not see results): shown as a dash, never guessed.
 */
export function useHumanOpens(campaigns: Campaign[]): Map<number, number | null> {
  const lacking = campaigns.filter((c) => c.stats && typeof c.stats.human !== 'number' && ['sending', 'paused', 'sent'].includes(c.status) && (delivered(c) ?? 0) > 0);
  const reports = useQueries({
    queries: lacking.map((c) => ({
      queryKey: ['marketing', 'campaign-results', c.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<Report>(`/api/marketing/campaigns/${c.id}/results`, undefined, signal),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const out = new Map<number, number | null>();
  for (const c of campaigns) if (typeof c.stats?.human === 'number') out.set(c.id, c.stats.human);
  lacking.forEach((c, i) => {
    const r = reports[i]?.data;
    out.set(c.id, r ? (r.quality?.human ?? r.counts.opened_by_people ?? null) : null);
  });
  return out;
}

/** A share as a rate to one decimal, or a dash. */
export function rateWords(part: number | null | undefined, whole: number | null | undefined): string {
  return part === null || part === undefined || !whole ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

/** A tab strip under a heading: the campaigns' statuses, the editor's steps. */
export function Tabs<T extends string>({ items, value, onChange, label, className }: { items: Array<{ id: T; label: ReactNode; disabled?: boolean }>; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex min-w-0 flex-wrap gap-x-5 gap-y-1', className)}>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px border-b-2 py-2 text-[13.5px] font-semibold whitespace-nowrap disabled:opacity-50',
            t.id === value ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Are you sure? — for the acts that cannot be taken back: cancelling, sending, deleting. */
export function Confirm({ title, children, yes, danger = false, busy = false, onYes, onClose }: { title: string; children: ReactNode; yes: string; danger?: boolean; busy?: boolean; onYes: () => void; onClose: () => void }) {
  return (
    <Sheet
      title={title}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={cx(btnPrimary, danger && '!bg-danger hover:!opacity-90')} onClick={onYes}>
            {yes}
          </button>
        </>
      }
    >
      <div className="text-[13px] text-ink-2">{children}</div>
    </Sheet>
  );
}

/** A labelled switch with the line that says what it does. */
export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-ink">{label}</span>
        {hint ? <span id={id} className="block text-[12px] text-ink-3">{hint}</span> : null}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} describedBy={hint ? id : undefined} />
    </div>
  );
}

/** One CSV cell: quoted when it holds a comma, a quote or a line break; a leading =, +, - or @ is defused for spreadsheets. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Save a summary this screen wrote to a file the person chooses, through the
 * desktop's own save dialog (`files:saveText`, as Mail's sync log and the
 * backup codes are saved), as `<name>.csv`.
 *
 * @return where it was saved, or null when the dialog was cancelled
 */
export async function saveCsvFile(base: string, text: string): Promise<string | null> {
  const name = `${base.replace(/[^A-Za-z0-9 ._-]+/g, '-').replace(/-+/g, '-').slice(0, 64).trim() || 'export'}.csv`;
  return call('files:saveText', { name, text: text.slice(0, 64_000) });
}
