import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { daysLeft, fetchDomain, fetchDomains, nameservers, type Domain, type ListQuery } from './api';
import type { Nav } from './HostingShell';
import { Btn, Chip, Days, Kbd, PageHead, Pills, Row, Status, input, useReadOnly, when } from './parts';

/**
 * Domains (D-02): All / Expiring / Manual, a search box, the keyboard list — ↑↓ move, ↵ open, ⌘↵ open in a new tab,
 * ⌘⇧↵ pop out — and the selected domain beside it. Expiring (the rail's) is the same list at 30 days.
 */
type Filter = 'all' | 'expiring' | 'manual';

/** The list's next index for a key, or null when the key is not the list's. */
export function moveIndex(key: string, at: number, length: number): number | null {
  if (!length) return null;
  if (key === 'ArrowDown') return Math.min(length - 1, at + 1);
  if (key === 'ArrowUp') return Math.max(0, at - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'PageDown') return Math.min(length - 1, at + 10);
  if (key === 'PageUp') return Math.max(0, at - 10);
  return null;
}

export default function Domains({ org, nav, active, expiring, filter: initial }: { org: number; nav: Nav; active: boolean; expiring: boolean; filter: string }) {
  const ro = useReadOnly();
  const [filter, setFilter] = useState<Filter>(expiring ? 'expiring' : initial === 'manual' ? 'manual' : 'all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [at, setAt] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const params: ListQuery = { q: q.trim() || undefined, org: org || undefined, page, per_page: 100, sort: 'expires_on', expires_within: filter === 'expiring' ? 30 : undefined, status: filter === 'manual' ? 'manual' : undefined };
  const list = useQuery({ queryKey: ['hosting', 'domains', params], queryFn: ({ signal }) => fetchDomains(params, signal), placeholderData: keepPreviousData });
  // "Manual" filters on the server where it knows the word; the source column decides otherwise.
  const items = (list.data?.items ?? []).filter((d) => filter !== 'manual' || !d.source || d.source === 'manual');
  const sel: Domain | undefined = items[Math.min(at, Math.max(0, items.length - 1))];
  const detail = useQuery({ queryKey: ['hosting', 'domain', sel?.id], queryFn: ({ signal }) => fetchDomain(sel!.id, signal), enabled: !!sel, staleTime: 30_000 });
  const d = detail.data ?? sel;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / Math.max(1, list.data.per_page))) : 1;

  useEffect(() => {
    if (active) body.current?.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => {
    body.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const onKey = (e: KeyboardEvent) => {
    const next = moveIndex(e.key, at, items.length);
    if (next !== null) {
      e.preventDefault();
      setAt(next);
    } else if (e.key === 'Enter' && sel) {
      e.preventDefault();
      nav.openDomain(sel.id, e.shiftKey && (e.metaKey || e.ctrlKey) ? 'window' : e.metaKey || e.ctrlKey ? 'tab' : 'here', sel.name);
    }
  };

  const counts = list.data ? { [filter]: list.data.total } : {};
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHead title={expiring ? 'Expiring' : 'Domains'} sub={ro ? text('{n} · cached', { n: list.data?.total ?? 0 }) : undefined}>
        <input aria-label="Search domains" placeholder="Search domains" value={q} onChange={(e) => (setQ(e.target.value), setPage(1), setAt(0))} className={cx(input, 'w-[220px]')} />
        <Btn primary disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => nav.to('new')}>
          Add domain <Kbd>⌘N</Kbd>
        </Btn>
      </PageHead>
      <div className="flex flex-wrap items-center gap-3">
        <Pills<Filter>
          label="Show"
          value={filter}
          onChange={(f) => (setFilter(f), setPage(1), setAt(0))}
          options={[
            { id: 'all', label: text('All'), n: (counts as Record<string, number>).all },
            { id: 'expiring', label: text('Expiring'), n: (counts as Record<string, number>).expiring },
            { id: 'manual', label: text('Manual'), n: (counts as Record<string, number>).manual },
          ]}
        />
        <span className="flex-1" />
        <span className="text-[11.5px] text-ink-3">↑↓ move · ↵ open · ⌘↵ new tab · ⌘⇧↵ pop out</span>
      </div>
      {list.isError ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div className="flex min-h-0 flex-1 gap-4">
        <div
          ref={body}
          tabIndex={0}
          role="listbox"
          aria-label="Domains"
          aria-activedescendant={sel ? `hosting-domain-${sel.id}` : undefined}
          onKeyDown={onKey}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[10px] border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-primary/40 scroll-thin"
        >
          <div className="sticky top-0 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_80px_minmax(0,1fr)] gap-2 border-b border-line bg-ground px-3 py-[7px] text-[11px] font-semibold text-ink-2">
            <span>Domain</span>
            <span>Registrar</span>
            <span>Expires</span>
            <span>Client</span>
          </div>
          {list.isPending ? <Spinner /> : null}
          {items.map((x, i) => (
            <div
              key={x.id}
              id={`hosting-domain-${x.id}`}
              data-row={i}
              role="option"
              aria-selected={i === at}
              onClick={() => setAt(i)}
              onDoubleClick={() => nav.openDomain(x.id, 'tab', x.name)}
              className={cx('grid h-9 cursor-default grid-cols-[minmax(0,2fr)_minmax(0,1fr)_80px_minmax(0,1fr)] items-center gap-2 border-b border-line/60 px-3 text-[12.5px]', i === at ? 'bg-[#EEF1FD] shadow-[inset_3px_0_0_#23349E] dark:bg-selection' : 'hover:bg-subtle')}
            >
              <span className="truncate font-semibold text-ink">{x.name}</span>
              <span className="truncate text-ink-2">{x.source === 'manual' || !x.registrar ? (x.registrar ?? text('Manual')) : x.registrar}</span>
              <span>
                <Days days={daysLeft(x)} />
              </span>
              <span className="truncate text-ink-2">{x.client ?? '—'}</span>
            </div>
          ))}
          {list.isSuccess && !items.length ? <p className="m-0 px-3 py-6 text-center text-[12.5px] text-ink-3">No domains match.</p> : null}
          {pages > 1 ? (
            <div className="flex items-center justify-end gap-2 px-3 py-2 text-[12px] text-ink-2">
              <Btn disabled={page <= 1} onClick={() => (setPage(page - 1), setAt(0))}>Previous</Btn>
              <span className="tabular-nums">{`${page} / ${pages}`}</span>
              <Btn disabled={page >= pages} onClick={() => (setPage(page + 1), setAt(0))}>Next</Btn>
            </div>
          ) : null}
        </div>
        {d ? <Preview d={d} nav={nav} /> : null}
      </div>
    </div>
  );
}

function Preview({ d, nav }: { d: Domain; nav: Nav }) {
  const days = daysLeft(d);
  const ns = nameservers(d.nameservers);
  return (
    <aside aria-label={text('{name} preview', { name: d.name })} className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto rounded-[10px] border border-line bg-surface p-4 scroll-thin">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-extrabold text-ink">{d.name}</div>
          <div className="text-[11.5px] text-ink-3">{[d.registrar ?? d.provider, d.company, d.synced_at ? text('synced {time}', { time: when(d.synced_at) }) : null].filter(Boolean).join(' · ')}</div>
        </div>
        <Days days={days} long />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Btn onClick={() => nav.openDomain(d.id, 'tab', d.name)}>
          Open in tab <Kbd>⌘↵</Kbd>
        </Btn>
        <Btn onClick={() => nav.openDomain(d.id, 'window', d.name)}>Pop out</Btn>
        <Btn onClick={() => void navigator.clipboard.writeText(d.name).then(() => toast('success', text('Copied {name}.', { name: d.name })))}>Copy name</Btn>
      </div>
      <div>
        <Row label="Expires">
          {d.expires_on ? `${when(d.expires_on)} · ${d.auto_renew ? text('auto-renew on') : text('auto-renew off')}` : '—'}
        </Row>
        <Row label="Status">
          <Status value={d.status} />
        </Row>
        <Row label="Nameservers">{ns.length ? ns.join(', ') : '—'}</Row>
        <Row label="Server">
          {d.server_id ? (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => nav.openServer(d.server_id!, 'here', d.server ?? undefined)}>
              {d.server ?? `#${d.server_id}`}
            </button>
          ) : (
            (d.server ?? '—')
          )}
        </Row>
        <Row label="Client">{[d.client, d.project].filter(Boolean).join(' · ') || '—'}</Row>
        <Row label="DNS">
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => nav.openDomain(d.id, 'here', d.name, 'dns')}>
            {d.dns_count !== null && d.dns_count !== undefined ? text('{n} records', { n: d.dns_count }) : text('Records')}
          </button>
          {d.dns_editable === false ? <span className="text-ink-3">{` · ${text('read-only')}`}</span> : d.dns_editable ? <span className="text-ink-3">{` · ${text('editable')}`}</span> : null}
        </Row>
        {d.tls ? (
          <Row label="TLS">
            <Status value={d.tls.status} /> {typeof d.tls.days_left === 'number' ? text('{n} days', { n: d.tls.days_left }) : ''}
          </Row>
        ) : null}
        {d.monitor ? (
          <Row label="Monitor">
            <Status value={d.monitor.state} /> {typeof d.monitor.ms === 'number' ? `${d.monitor.ms} ms` : ''}
          </Row>
        ) : null}
        {d.tags?.length ? (
          <Row label="Tags">
            <span className="flex flex-wrap gap-1">
              {d.tags.map((t) => (
                <Chip key={t} tone="grey">
                  {t}
                </Chip>
              ))}
            </span>
          </Row>
        ) : null}
      </div>
    </aside>
  );
}
