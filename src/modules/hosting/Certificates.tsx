import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { checkCertificate, daysLeft, fetchCertificate, fetchCertificates, K, watchHost, type Certificate } from './api';
import { moveIndex } from './Domains';
import { Explain } from './Explain';
import type { Nav } from './HostingShell';
import { Btn, Days, Field, Kbd, PageHead, Row, Status, input, useReadOnly, when } from './parts';

/**
 * Certificates (D-05, HDM-SSL-01/03): every watched host with its state, days left and issuer; the selected one beside
 * it — issuer, names covered, validity, serial, fingerprint, server, last check and what is wrong in plain words —
 * with Check now (⌘R), Explain with AI (HDM-AI-01, where the server has it) and Watch host.
 */
export const hostLabel = (c: Pick<Certificate, 'host' | 'port'>) => (c.port && c.port !== 443 ? `${c.host}:${c.port}` : c.host);

/** What is wrong with a certificate in a sentence, from what the server read. Null when nothing is. */
export function certProblem(c: Certificate): string | null {
  const s = (c.status ?? '').toLowerCase();
  if (c.check_error) return c.check_error;
  if (s === 'mismatch') return text('The server sends a certificate for {names}. Apps will warn on connect.', { names: sans(c).join(', ') || (c.common_name ?? text('another name')) });
  if (s === 'untrusted') return text('The certificate is not signed by an authority browsers trust.');
  if (s === 'unreachable') return text('The host did not answer on port {port}.', { port: c.port ?? 443 });
  if (s === 'expired') return text('The certificate has expired.');
  return null;
}
const sans = (c: Certificate) => (Array.isArray(c.sans) ? c.sans : typeof c.sans === 'string' ? c.sans.split(/[\s,]+/).filter(Boolean) : []);

export default function Certificates({ org, active, selected, watch }: { org: number; nav: Nav; active: boolean; selected: number | null; watch: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [moved, setAt] = useState<number | null>(null);
  const [adding, setAdding] = useState(watch);
  const body = useRef<HTMLDivElement>(null);
  const params = { q: q.trim() || undefined, org: org || undefined, per_page: 200, sort: 'expires_on' };
  const list = useQuery({ queryKey: K.certificates(params), queryFn: ({ signal }) => fetchCertificates(params, signal), placeholderData: keepPreviousData });
  const items = list.data?.items ?? [];
  // The certificate a link asked for, until the person moves.
  const at = moved ?? Math.max(0, selected === null ? 0 : items.findIndex((c) => c.id === selected));
  const sel = items[Math.min(at, Math.max(0, items.length - 1))];
  const detail = useQuery({ queryKey: K.certificate(sel?.id ?? 0), queryFn: ({ signal }) => fetchCertificate(sel!.id, signal), enabled: !!sel, staleTime: 30_000 });
  const c = detail.data ?? sel;

  const check = async (id: number) => {
    try {
      await checkCertificate(id);
      toast('success', text('Checked again.'));
      void qc.invalidateQueries({ queryKey: ['hosting', 'certificate'] });
      void qc.invalidateQueries({ queryKey: ['hosting', 'certificates'] });
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
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHead title="Certificates" sub={list.data ? text('{n} hosts', { n: list.data.total }) : undefined}>
        <input aria-label="Search hosts" placeholder="Search hosts" value={q} onChange={(e) => (setQ(e.target.value), setAt(0))} className={cx(input, 'w-[200px]')} />
        <Btn primary disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => setAdding(true)}>
          Watch host
        </Btn>
      </PageHead>
      {list.isError ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div className="flex min-h-0 flex-1 gap-4">
        <div ref={body} tabIndex={0} role="listbox" aria-label="Certificates" onKeyDown={onKey} className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[10px] border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-primary/40 scroll-thin">
          {list.isPending ? <Spinner /> : null}
          {items.map((x, i) => (
            <div key={x.id} role="option" aria-selected={i === at} onClick={() => setAt(i)} className={cx('grid h-9 grid-cols-[minmax(0,2fr)_100px_70px_minmax(0,1fr)] items-center gap-2 border-b border-line/60 px-3 text-[12.5px]', i === at ? 'bg-[#EEF1FD] shadow-[inset_3px_0_0_#23349E] dark:bg-selection' : 'hover:bg-subtle')}>
              <span className="truncate font-semibold text-ink">{hostLabel(x)}</span>
              <span>
                <Status value={x.status} />
              </span>
              <span>
                <Days days={daysLeft(x)} />
              </span>
              <span className="truncate text-ink-2">{x.issuer ?? '—'}</span>
            </div>
          ))}
          {list.isSuccess && !items.length ? <p className="m-0 px-3 py-6 text-center text-[12.5px] text-ink-3">No certificates are watched yet.</p> : null}
        </div>
        {c ? (
          <aside aria-label={hostLabel(c)} className="flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto rounded-[10px] border border-line bg-surface p-4 scroll-thin">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-ink">{hostLabel(c)}</span>
              <Status value={c.status} />
            </div>
            {certProblem(c) ? <p className="m-0 text-[12.5px] text-ink-2">{certProblem(c)}</p> : null}
            <div>
              <Row label="Issuer">{c.issuer ?? '—'}</Row>
              <Row label="Covers">{sans(c).join(', ') || c.common_name || '—'}</Row>
              <Row label="Valid">{c.issued_on || c.expires_on ? `${when(c.issued_on)} → ${when(c.expires_on)}` : '—'}</Row>
              <Row label="Serial">
                <span className="font-mono text-[11.5px]">{c.serial ?? '—'}</span>
              </Row>
              <Row label="SHA-256">
                <span className="font-mono text-[11.5px] break-all">{c.fingerprint ?? '—'}</span>
              </Row>
              <Row label="Server">{c.server ?? '—'}</Row>
              <Row label="Checked">{[when(c.checked_at), c.protocol].filter((v) => v && v !== '—').join(' · ') || '—'}</Row>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Btn disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => void check(c.id)}>
                Check now <Kbd>⌘R</Kbd>
              </Btn>
            </div>
            <Explain kind="certificate" id={c.id} />
          </aside>
        ) : null}
      </div>
      {adding && !ro ? (
        <WatchHost
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            void qc.invalidateQueries({ queryKey: ['hosting', 'certificates'] });
          }}
        />
      ) : null}
    </div>
  );
}

function WatchHost({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(443);
  const [busy, setBusy] = useState(false);
  const ok = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host.trim()) && port > 0 && port < 65_536;
  const save = async () => {
    setBusy(true);
    try {
      await watchHost(host.trim().toLowerCase(), port);
      toast('success', text('Watching {host}.', { host: host.trim() }));
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
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
      <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
        <Field label="Host">
          <input aria-label="Host" autoFocus placeholder="shop.example.com" value={host} onChange={(e) => setHost(e.target.value)} className={input} />
        </Field>
        <Field label="Port">
          <input aria-label="Port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 0)} className={input} />
        </Field>
      </div>
    </Modal>
  );
}
