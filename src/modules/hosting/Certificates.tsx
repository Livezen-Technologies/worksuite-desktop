import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Checkbox } from '../../components/Checkbox';
import { ContextMenu } from '../../components/ContextMenu';
import { Select } from '../../components/Select';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { checkCertificate, daysLeft, fetchCertificate, fetchCertificates, K, unwatchCertificate, watchHost, type Certificate, type Org } from './api';
import { BulkBar } from './Bulk';
import { moveIndex, toggle } from './Domains';
import { Explain } from './Explain';
import type { Nav } from './HostingShell';
import { Btn, Days, ExportButton, Field, Kbd, Note, PageHead, Row, Status, input, useReadOnly, when } from './parts';

/**
 * Certificates (D-05, HDM-SSL-01/03) from `GET certificates` (Certificates::shape): every watched host with its state,
 * days left and issuer, the summary over the whole list, and the selected one beside it — issuer, names covered,
 * validity, serial, fingerprint, last check, the server's words for what is wrong and its hygiene warnings — with
 * Check now (⌘R), Explain with AI (HDM-AI-01) and Watch host. Tick rows (Space) to check them again or stop watching
 * them together; right-click a row for the same one by one.
 */
export const hostLabel = (c: Pick<Certificate, 'host' | 'port' | 'label'>) => c.label || (c.port && c.port !== 443 ? `${c.host}:${c.port}` : c.host);
export const sans = (c: Pick<Certificate, 'sans'>) => (Array.isArray(c.sans) ? c.sans : typeof c.sans === 'string' ? c.sans.split(/[\s,]+/).filter(Boolean) : []);

/** What is wrong with a certificate in a sentence: the server's own `problem` first. Null when nothing is. */
export function certProblem(c: Certificate): string | null {
  const s = (c.status ?? '').toLowerCase();
  if (c.problem) return c.problem;
  if (s === 'mismatch') return text('The server sends a certificate for {names}. Apps will warn on connect.', { names: sans(c).join(', ') || (c.common_name ?? text('another name')) });
  if (s === 'untrusted') return text('The certificate is not signed by an authority browsers trust.');
  if (s === 'unreachable') return text('The host did not answer on port {port}.', { port: c.port ?? 443 });
  if (s === 'expired') return text('The certificate has expired.');
  if (s === 'not_yet_valid') return text('The certificate is not valid yet.');
  return null;
}

export default function Certificates({ org, nav, active, selected, watch, companies }: { org: number; nav: Nav; active: boolean; selected: number | null; watch: boolean; companies: Org[] }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [risk, setRisk] = useState(false);
  const [moved, setAt] = useState<number | null>(null);
  const [adding, setAdding] = useState(watch);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; c: Certificate } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const params = { q: q.trim() || undefined, org: org || undefined, per_page: 200, sort: 'expires_on', state: risk ? 'risk' : undefined };
  const list = useQuery({ queryKey: K.certificates(params), queryFn: ({ signal }) => fetchCertificates(params, signal), placeholderData: keepPreviousData });
  const items = list.data?.items ?? [];
  const summary = list.data?.summary ?? {};
  // The certificate a link asked for, until the person moves.
  const at = moved ?? Math.max(0, selected === null ? 0 : items.findIndex((c) => c.id === selected));
  const sel = items[Math.min(at, Math.max(0, items.length - 1))];
  const detail = useQuery({ queryKey: K.certificate(sel?.id ?? 0), queryFn: ({ signal }) => fetchCertificate(sel!.id, signal), enabled: !!sel, staleTime: 30_000 });
  const c = detail.data ?? sel;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['hosting', 'certificate'] });
    void qc.invalidateQueries({ queryKey: ['hosting', 'certificates'] });
  };
  const check = async (id: number) => {
    try {
      const r = await checkCertificate(id);
      toast('success', r.message ?? text('Checked again.'));
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const unwatch = async (x: Certificate) => {
    try {
      await unwatchCertificate(x.id);
      toast('success', text('No longer watching {host}.', { host: hostLabel(x) }));
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const keys = useRef({ ro, sel, check });
  useEffect(() => {
    keys.current = { ro, sel, check };
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'r' && keys.current.sel && !keys.current.ro) {
        e.preventDefault();
        void keys.current.check(keys.current.sel.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  const onKey = (e: KeyboardEvent) => {
    const next = moveIndex(e.key, at, items.length);
    if (next !== null) {
      e.preventDefault();
      setAt(next);
    } else if (e.key === ' ' && sel) {
      e.preventDefault();
      setTicked(toggle(ticked, sel.id));
    } else if (e.key === 'Escape' && ticked.size) setTicked(new Set());
  };
  const off = ro ? text('Needs a connection') : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHead
        title="Certificates"
        sub={list.data ? [text('{n} hosts', { n: list.data.total }), summary.expired ? text('{n} expired', { n: summary.expired }) : null, summary.within_14 ? text('{n} within 14 days', { n: summary.within_14 }) : null, summary.problems ? text('{n} with problems', { n: summary.problems }) : null].filter(Boolean).join(' · ') : undefined}
      >
        <input aria-label="Search hosts" placeholder="Search hosts" value={q} onChange={(e) => (setQ(e.target.value), setAt(0))} className={cx(input, 'w-[200px]')} />
        <Btn aria-pressed={risk} onClick={() => (setRisk(!risk), setAt(0))}>{risk ? 'Showing at risk' : 'At risk only'}</Btn>
        <ExportButton kind="certificates" query={{ q: params.q, org: params.org, state: params.state }} disabled={ro} />
        <Btn primary disabled={ro} title={off} onClick={() => setAdding(true)}>
          Watch host
        </Btn>
      </PageHead>
      {list.data?.acme && !list.data.acme.available ? <p className="m-0 text-[11.5px] text-ink-3">{list.data.acme.why || text('Issuing and renewing certificates is not available from WorkSuite yet; they are watched here.')}</p> : null}
      <BulkBar kind="certificates" ids={[...ticked]} orgs={[]} onClear={() => setTicked(new Set())} />
      {list.isError ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div className="flex min-h-0 flex-1 gap-4">
        <div ref={body} tabIndex={0} role="listbox" aria-label="Certificates" aria-multiselectable onKeyDown={onKey} className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[10px] border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-primary/40 scroll-thin">
          {list.isPending ? <Spinner /> : null}
          {items.map((x, i) => (
            <div
              key={x.id}
              role="option"
              aria-selected={i === at || ticked.has(x.id)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) setTicked(toggle(ticked, x.id));
                setAt(i);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setAt(i);
                setMenu({ x: e.clientX, y: e.clientY, c: x });
              }}
              className={cx('grid h-9 grid-cols-[22px_minmax(0,2fr)_110px_70px_minmax(0,1fr)] items-center gap-2 border-b border-line/60 px-3 text-[12.5px]', i === at ? 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)] dark:bg-selection' : ticked.has(x.id) ? 'bg-info-soft dark:bg-primary/10' : 'hover:bg-subtle')}
            >
              <Checkbox tabIndex={-1} aria-label={text('Select {name}', { name: hostLabel(x) })} checked={ticked.has(x.id)} onClick={(e) => e.stopPropagation()} onChange={() => setTicked(toggle(ticked, x.id))} />
              <span className="truncate font-semibold text-ink">{hostLabel(x)}</span>
              <span>
                <Status value={x.status} label={x.status_words} />
              </span>
              <span title={x.left ?? undefined}>
                <Days days={daysLeft(x)} />
              </span>
              <span className="truncate text-ink-2">{x.issuer ?? '—'}</span>
            </div>
          ))}
          {list.isSuccess && !items.length ? <p className="m-0 px-3 py-6 text-center text-[12.5px] text-ink-3">{risk ? 'No certificate is at risk.' : 'No certificates are watched yet.'}</p> : null}
        </div>
        {c ? (
          <aside aria-label={hostLabel(c)} className="flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto rounded-[10px] border border-line bg-surface p-4 scroll-thin">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-ink">{hostLabel(c)}</span>
              <Status value={c.status} label={c.status_words} />
            </div>
            {certProblem(c) ? <p className="m-0 text-[12.5px] text-ink-2">{certProblem(c)}</p> : null}
            {c.warnings?.length ? (
              <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-warning-ink dark:text-warning">
                {c.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            <div>
              <Row label="Issuer">{c.issuer ?? '—'}</Row>
              <Row label="Covers">{sans(c).join(', ') || c.common_name || '—'}</Row>
              <Row label="Valid">{c.issued_on || c.expires_on ? `${when(c.issued_on)} → ${when(c.expires_on)}` : '—'}</Row>
              <Row label="Key">{[c.key_type, c.key_bits ? `${c.key_bits} bit` : null].filter(Boolean).join(' · ') || '—'}</Row>
              <Row label="Serial">
                <span className="font-mono text-[11.5px]">{c.serial ?? '—'}</span>
              </Row>
              <Row label="SHA-256">
                <span className="font-mono text-[11.5px] break-all">{c.fingerprint ?? '—'}</span>
              </Row>
              <Row label="Domain">
                {c.domain_id ? (
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => nav.openDomain(c.domain_id!, 'tab', c.domain ?? undefined)}>
                    {c.domain ?? `#${c.domain_id}`}
                  </button>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Server">
                {c.server_id ? (
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => nav.openServer(c.server_id!, 'tab')}>
                    {text('Open the server')}
                  </button>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Checked">{[when(c.checked_at), c.protocol].filter((v) => v && v !== '—').join(' · ') || '—'}</Row>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Btn disabled={ro} title={off} onClick={() => void check(c.id)}>
                Check now <Kbd>⌘R</Kbd>
              </Btn>
            </div>
            <Explain kind="certificate" id={c.id} />
          </aside>
        ) : null}
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={text('{name} actions', { name: hostLabel(menu.c) })}
          onClose={() => setMenu(null)}
          sections={[
            {
              id: 'do',
              items: [
                { id: 'check', label: text('Check now'), shortcut: '⌘R', disabled: ro, reason: off, onSelect: () => void check(menu.c.id) },
                ...(menu.c.domain_id ? [{ id: 'domain', label: text('Open {name}', { name: menu.c.domain ?? text('the domain') }), onSelect: () => nav.openDomain(menu.c.domain_id!, 'tab', menu.c.domain ?? undefined) }] : []),
                { id: 'copy', label: text('Copy host'), onSelect: () => void navigator.clipboard.writeText(menu.c.host).then(() => toast('success', text('Copied {name}.', { name: menu.c.host }))) },
                { id: 'tick', label: ticked.has(menu.c.id) ? text('Untick') : text('Tick for a bulk change'), shortcut: 'Space', onSelect: () => setTicked(toggle(ticked, menu.c.id)) },
              ],
            },
            { id: 'end', items: [{ id: 'unwatch', label: text('Stop watching'), danger: true, disabled: ro, reason: off, onSelect: () => void unwatch(menu.c) }] },
          ]}
        />
      ) : null}
      {adding && !ro ? (
        <WatchHost
          companies={companies}
          org={org}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function WatchHost({ companies, org, onClose, onDone }: { companies: Org[]; org: number; onClose: () => void; onDone: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(443);
  const [company, setCompany] = useState(org || companies[0]?.id || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host.trim()) && port > 0 && port < 65_536 && company > 0;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await watchHost(company, host.trim().toLowerCase(), port);
      toast('success', text('Watching {host}.', { host: host.trim() }));
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Watch a host’s certificate"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!ok || busy} onClick={() => void save()}>Watch</Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
          <Field label="Host">
            <input aria-label="Host" autoFocus placeholder="shop.example.com" value={host} onChange={(e) => setHost(e.target.value)} className={input} />
          </Field>
          <Field label="Port">
            <input aria-label="Port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 0)} className={input} />
          </Field>
        </div>
        {companies.length > 1 ? (
          <Field label="Company">
            <Select aria-label="Company" value={company} onChange={(e) => setCompany(Number(e.target.value))} className={input}>
              {companies.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <p className="m-0 text-[11.5px] text-ink-3">WorkSuite reads the certificate now and again every day. Nothing changes on the host.</p>
        {err ? <Note tone="error">{err}</Note> : null}
      </div>
    </Modal>
  );
}
