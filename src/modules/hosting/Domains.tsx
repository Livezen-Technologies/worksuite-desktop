import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Checkbox } from '../../components/Checkbox';
import { ContextMenu } from '../../components/ContextMenu';
import type { MenuSection } from '../../components/Menu';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { daysLeft, domainTask, fetchDomain, fetchDomains, K, nameservers, refreshDns, removeDomain, watchHost, type Domain, type ListQuery, type Org } from './api';
import { BulkBar } from './Bulk';
import type { Nav } from './HostingShell';
import { EditLinks } from './Links';
import { AddMonitor } from './Monitors';
import { Btn, Chip, Days, ExportButton, Kbd, MenuButton, PageHead, Pills, Row, Status, input, useReadOnly, when } from './parts';

/**
 * Domains (D-02): All / Expiring / Manual with the server's counts, a search box, the keyboard list — ↑↓ move, ↵ open,
 * ⌘↵ open in a new tab, ⌘⇧↵ pop out, Space tick for a bulk change — and the selected domain beside it. A right-click on
 * a row offers what the D-02 board lists: Re-read DNS, Watch certificate, Add monitor, Edit links, Create task. Export
 * is the server's file of the list as filtered; Register and Import are a step away. Expiring (the rail's) is the
 * same list at 30 days.
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

/** Tick or untick one id. */
export const toggle = (set: ReadonlySet<number>, id: number): Set<number> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** The list request for a filter, as the server reads it (DomainController::filter). */
export function domainQuery(filter: Filter, q: string, org: number, page: number): ListQuery {
  return { q: q.trim() || undefined, org: org || undefined, page, per_page: 100, sort: 'expires_on', expires_within: filter === 'expiring' ? 30 : undefined, source: filter === 'manual' ? 'manual' : undefined };
}

export default function Domains({ org, nav, active, expiring, filter: initial, companies }: { org: number; nav: Nav; active: boolean; expiring: boolean; filter: string; companies: Org[] }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>(expiring ? 'expiring' : initial === 'manual' ? 'manual' : 'all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [at, setAt] = useState(0);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; d: Domain } | null>(null);
  const [links, setLinks] = useState<Domain | null>(null);
  const [monitor, setMonitor] = useState<Domain | null>(null);
  const [gone, setGone] = useState<Domain | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const params = domainQuery(filter, q, org, page);
  const list = useQuery({ queryKey: K.domains(params), queryFn: ({ signal }) => fetchDomains(params, signal), placeholderData: keepPreviousData });
  // The counts on the pills are the whole register's (the All list's summary), not this page's.
  const all = useQuery({ queryKey: K.domains({ org, per_page: 1 }), queryFn: ({ signal }) => fetchDomains({ org: org || undefined, per_page: 1 }, signal), staleTime: 60_000 });
  const manual = useQuery({ queryKey: K.domains({ org, per_page: 1, source: 'manual' }), queryFn: ({ signal }) => fetchDomains({ org: org || undefined, per_page: 1, source: 'manual' }, signal), staleTime: 60_000 });
  const items = list.data?.items ?? [];
  const sel: Domain | undefined = items[Math.min(at, Math.max(0, items.length - 1))];
  const detail = useQuery({ queryKey: K.domain(sel?.id ?? 0), queryFn: ({ signal }) => fetchDomain(sel!.id, signal), enabled: !!sel, staleTime: 30_000 });
  const d = detail.data ?? sel;
  const pages = list.data?.pages ?? 1;
  const tickedRows = items.filter((x) => ticked.has(x.id));

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
    } else if (e.key === ' ' && sel) {
      e.preventDefault();
      setTicked(toggle(ticked, sel.id));
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && items.length) {
      e.preventDefault();
      setTicked(new Set(items.map((x) => x.id)));
    } else if (e.key === 'Escape' && ticked.size) {
      setTicked(new Set());
    } else if (e.key === 'ContextMenu' && sel) {
      e.preventDefault();
      const r = body.current?.querySelector(`[data-row="${at}"]`)?.getBoundingClientRect();
      setMenu({ x: r ? r.left + 24 : 0, y: r ? r.bottom : 0, d: sel });
    }
  };

  const reset = () => (setPage(1), setAt(0), setTicked(new Set()));
  const act = async (what: string, run: () => Promise<unknown>, ok: string) => {
    try {
      const r = await run();
      toast(r === null ? 'info' : 'success', r === null ? text('{what} needs a server update.', { what }) : typeof r === 'string' && r ? r : ok);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const sections = (x: Domain): MenuSection[] => {
    const off = ro ? text('Needs a connection') : undefined;
    return [
      {
        id: 'open',
        items: [
          { id: 'open', label: text('Open'), shortcut: '↵', onSelect: () => nav.openDomain(x.id, 'here', x.name) },
          { id: 'tab', label: text('Open in new tab'), shortcut: '⌘↵', onSelect: () => nav.openDomain(x.id, 'tab', x.name) },
          { id: 'window', label: text('Pop out'), shortcut: '⌘⇧↵', onSelect: () => nav.openDomain(x.id, 'window', x.name) },
          { id: 'dns', label: text('DNS records'), onSelect: () => nav.openDomain(x.id, 'here', x.name, 'dns') },
        ],
      },
      {
        id: 'do',
        items: [
          { id: 'reread', label: text('Re-read DNS'), disabled: ro || x.source === 'manual', reason: off ?? (x.source === 'manual' ? text('Added by hand: there is no registrar to read.') : undefined), onSelect: () => void act(text('Re-reading DNS'), () => refreshDns(x.id).then(() => qc.invalidateQueries({ queryKey: K.dns(x.id) })), text('Read {name}’s records again.', { name: x.name })) },
          { id: 'watch', label: text('Watch certificate'), disabled: ro || !x.org_id, reason: off, onSelect: () => void act(text('Watching'), () => watchHost(x.org_id!, x.name, 443).then(() => qc.invalidateQueries({ queryKey: ['hosting', 'certificates'] })), text('Watching {host}.', { host: x.name })) },
          { id: 'monitor', label: text('Add monitor…'), disabled: ro, reason: off, onSelect: () => setMonitor(x) },
          { id: 'links', label: text('Edit links…'), description: text('Customer, project, server, responsible'), disabled: ro, reason: off, onSelect: () => setLinks(x) },
          { id: 'task', label: text('Create renewal task'), disabled: ro, reason: off, onSelect: () => void act(text('Renewal tasks'), () => domainTask(x.id), text('Renewal task created.')) },
        ],
      },
      {
        id: 'more',
        items: [
          { id: 'copy', label: text('Copy name'), onSelect: () => void navigator.clipboard.writeText(x.name).then(() => toast('success', text('Copied {name}.', { name: x.name }))) },
          { id: 'tick', label: ticked.has(x.id) ? text('Untick') : text('Tick for a bulk change'), shortcut: 'Space', onSelect: () => setTicked(toggle(ticked, x.id)) },
          { id: 'remove', label: text('Remove from the register…'), danger: true, disabled: ro, reason: off, onSelect: () => setGone(x) },
        ],
      },
    ];
  };
  const onRowMenu = (e: ReactMouseEvent, i: number, x: Domain) => {
    e.preventDefault();
    setAt(i);
    setMenu({ x: e.clientX, y: e.clientY, d: x });
  };
  const remove = async (x: Domain) => {
    try {
      await removeDomain(x.id);
      toast('success', x.source === 'manual' ? text('Removed {name}. It can be restored for 30 days.', { name: x.name }) : text('{name} is hidden from the register; it is still at its registrar.', { name: x.name }));
      setGone(null);
      void qc.invalidateQueries({ queryKey: ['hosting', 'domains'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const total = all.data?.total;
  const exportQuery = { q: params.q, org: params.org, expires_within: params.expires_within, source: params.source, sort: params.sort };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHead title={expiring ? 'Expiring' : 'Domains'} sub={ro ? text('{n} · cached', { n: list.data?.total ?? 0 }) : list.data ? text('{n} domains', { n: list.data.total }) : undefined}>
        <input aria-label="Search domains" placeholder="Search domains" value={q} onChange={(e) => (setQ(e.target.value), reset())} className={cx(input, 'w-[220px]')} />
        <ExportButton kind="domains" query={exportQuery} disabled={ro} />
        <MenuButton
          label={text('More')}
          items={[
            { id: 'register', label: text('Find and register a domain…'), disabled: ro, onSelect: () => nav.to('register', q.trim() ? `&name=${encodeURIComponent(q.trim())}` : '') },
            { id: 'import', label: text('Import from CSV…'), disabled: ro, onSelect: () => nav.to('import') },
          ]}
        />
        <Btn primary disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => nav.to('new')}>
          Add domain <Kbd>⌘N</Kbd>
        </Btn>
      </PageHead>
      <div className="flex flex-wrap items-center gap-3">
        <Pills<Filter>
          label="Show"
          value={filter}
          onChange={(f) => (setFilter(f), reset())}
          options={[
            { id: 'all', label: text('All'), n: total },
            { id: 'expiring', label: text('Expiring'), n: all.data?.summary.within_30 },
            { id: 'manual', label: text('Manual'), n: manual.data?.total },
          ]}
        />
        {all.data?.summary.expired ? <Chip tone="red">{text('{n} expired', { n: all.data.summary.expired })}</Chip> : null}
        {all.data?.summary.renew_off_soon ? <Chip tone="amber">{text('{n} lapse soon with auto-renew off', { n: all.data.summary.renew_off_soon })}</Chip> : null}
        <span className="flex-1" />
        <span className="text-[11.5px] text-ink-3">↑↓ move · ↵ open · Space select · right-click for more</span>
      </div>
      <BulkBar kind="domains" ids={[...ticked]} orgs={[...new Set(tickedRows.map((x) => x.org_id ?? 0).filter(Boolean))]} onClear={() => setTicked(new Set())} />
      {list.isError ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div className="flex min-h-0 flex-1 gap-4">
        <div
          ref={body}
          tabIndex={0}
          role="listbox"
          aria-label="Domains"
          aria-multiselectable
          aria-activedescendant={sel ? `hosting-domain-${sel.id}` : undefined}
          onKeyDown={onKey}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[10px] border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-primary/40 scroll-thin"
        >
          <div className="sticky top-0 grid grid-cols-[22px_minmax(0,2fr)_minmax(0,1fr)_80px_minmax(0,1fr)] gap-2 border-b border-line bg-ground px-3 py-[7px] text-[11px] font-semibold text-ink-2">
            <Checkbox aria-label={text('Select all on this page')} checked={!!items.length && items.every((x) => ticked.has(x.id))} onChange={(e) => setTicked(e.target.checked ? new Set(items.map((x) => x.id)) : new Set())} />
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
              aria-selected={i === at || ticked.has(x.id)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) setTicked(toggle(ticked, x.id));
                setAt(i);
              }}
              onDoubleClick={() => nav.openDomain(x.id, 'tab', x.name)}
              onContextMenu={(e) => onRowMenu(e, i, x)}
              className={cx('grid h-9 cursor-default grid-cols-[22px_minmax(0,2fr)_minmax(0,1fr)_80px_minmax(0,1fr)] items-center gap-2 border-b border-line/60 px-3 text-[12.5px]', i === at ? 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)] dark:bg-selection' : ticked.has(x.id) ? 'bg-info-soft dark:bg-primary/10' : 'hover:bg-subtle')}
            >
              <Checkbox tabIndex={-1} aria-label={text('Select {name}', { name: x.name })} checked={ticked.has(x.id)} onClick={(e) => e.stopPropagation()} onChange={() => setTicked(toggle(ticked, x.id))} />
              <span className="truncate font-semibold text-ink">{x.name}</span>
              <span className="truncate text-ink-2">{x.source === 'manual' ? (x.registrar ?? text('Manual')) : (x.provider_label ?? x.registrar ?? '—')}</span>
              <span title={x.left ?? undefined}>
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
        {d ? <Preview d={d} nav={nav} onLinks={() => setLinks(d)} /> : null}
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} label={text('{name} actions', { name: menu.d.name })} sections={sections(menu.d)} onClose={() => setMenu(null)} /> : null}
      {links ? <EditLinks d={links} onClose={() => setLinks(null)} /> : null}
      {monitor ? (
        <AddMonitor
          companies={companies}
          initial={{ org_id: monitor.org_id ?? org, kind: 'http', target: `https://${monitor.name}`, interval_s: 300, domain_id: monitor.id, server_id: monitor.server_id ?? null }}
          onClose={() => setMonitor(null)}
          onDone={() => {
            setMonitor(null);
            void qc.invalidateQueries({ queryKey: ['hosting', 'monitors'] });
          }}
        />
      ) : null}
      {gone ? (
        <Modal
          title={text('Remove {name} from the register?', { name: gone.name })}
          onClose={() => setGone(null)}
          footer={
            <>
              <Btn onClick={() => setGone(null)}>Cancel</Btn>
              <Btn danger onClick={() => void remove(gone)}>Remove</Btn>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{gone.source === 'manual' ? text('It can be restored for 30 days.') : text('It is still at its registrar, so it is hidden rather than deleted, and can be restored for 30 days. Nothing changes at the registrar.')}</p>
        </Modal>
      ) : null}
    </div>
  );
}

function Preview({ d, nav, onLinks }: { d: Domain; nav: Nav; onLinks: () => void }) {
  const ro = useReadOnly();
  const days = daysLeft(d);
  const ns = nameservers(d.nameservers);
  const detail = d as Domain & { dns?: { records?: unknown[]; can_edit?: boolean }; certificates?: Array<{ status?: string | null; status_words?: string | null; days_left?: number | null }>; monitors?: Array<{ state?: string | null; last_ms?: number | null }> };
  const tls = detail.certificates?.[0];
  const mon = detail.monitors?.[0];
  return (
    <aside aria-label={text('{name} preview', { name: d.name })} className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto rounded-[10px] border border-line bg-surface p-4 scroll-thin">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-extrabold text-ink">{d.name}</div>
          <div className="text-[11.5px] text-ink-3">{[d.source === 'manual' ? text('Added by hand') : (d.provider_label ?? d.registrar), d.account_name, d.synced_at ? text('synced {time}', { time: when(d.synced_at) }) : null].filter(Boolean).join(' · ')}</div>
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
        <Row label="Expires">{d.expires_on ? `${when(d.expires_on)} · ${d.auto_renew === null || d.auto_renew === undefined ? text('auto-renew unknown') : d.auto_renew ? text('auto-renew on') : text('auto-renew off')}` : '—'}</Row>
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
            '—'
          )}
        </Row>
        <Row label="Client">
          <span>{[d.client, d.project].filter(Boolean).join(' · ') || '—'}</span>{' '}
          {!ro ? (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={onLinks}>
              {text('Edit')}
            </button>
          ) : null}
        </Row>
        {d.owner ? <Row label="Responsible">{d.owner}</Row> : null}
        <Row label="DNS">
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => nav.openDomain(d.id, 'here', d.name, 'dns')}>
            {detail.dns?.records ? text('{n} records', { n: detail.dns.records.length }) : text('Records')}
          </button>
          {detail.dns ? <span className="text-ink-3">{` · ${detail.dns.can_edit ? text('editable') : text('read-only')}`}</span> : null}
        </Row>
        {tls ? (
          <Row label="TLS">
            <Status value={tls.status} label={tls.status_words} /> {typeof tls.days_left === 'number' ? text('{n} days', { n: tls.days_left }) : ''}
          </Row>
        ) : null}
        {mon ? (
          <Row label="Monitor">
            <Status value={mon.state} /> {typeof mon.last_ms === 'number' ? `${mon.last_ms} ms` : ''}
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
      <p className="m-0 text-[11.5px] text-ink-3">Right-click a row for Re-read, Watch certificate, Add monitor, Edit links, Create task.</p>
    </aside>
  );
}
