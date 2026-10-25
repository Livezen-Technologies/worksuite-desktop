import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { toast } from '../../core/toasts';
import { useWedge } from '../../core/scanner';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, checkAudit, completeAudit, fetchLookups, toCsv, type Audit, type AuditLine, type Can } from './api';
import { Badge, Btn, Card, Field, Kbd, Note, PageHead, Table, input, td, useReadOnly } from './parts';
import { call } from '../../core/bridge';

/**
 * Audits (D18): the list, a new audit, and an audit run — scan each asset where it stands (the scanner works
 * wherever the focus is), or pick a line and press F found, E elsewhere, M missing. Lines refresh every few seconds so
 * two people can scan at once. Complete asks the server, which refuses while lines are unchecked unless told to mark
 * them missing. A missing asset is never written off here — that is a disposal, decided by someone else.
 */
export default function Audits({ can, active, open, onOpen }: { org: number; can: Can; active: boolean; open: number | null; onOpen: (id: number) => void }) {
  return open ? <Run id={open} can={can} active={active} /> : <List can={can} onOpen={onOpen} />;
}

function List({ can, onOpen }: { can: Can; onOpen: (id: number) => void }) {
  const ro = useReadOnly() || !(can.audit || can.manage);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assets', 'audits'], queryFn: ({ signal }) => apiGet<{ audits: Audit[] }>(`${BASE}/audits`, { per_page: 100 }, signal) });
  const cats = useQuery({ queryKey: ['assets', 'lookups', 'categories'], queryFn: ({ signal }) => fetchLookups('categories', signal), staleTime: 300_000 });
  const [name, setName] = useState('');
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));
  const [cat, setCat] = useState(0);
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ id?: number }>(`${BASE}/audits`, { name: name.trim(), scheduled_for: when, category_id: cat || undefined, branch: branch.trim() || undefined });
      void qc.invalidateQueries({ queryKey: ['assets', 'audits'] });
      if (r.id) onOpen(r.id);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-3">
        <PageHead title="Audits" />
        <Card>
          {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} /></div> : null}
          <Table head={['Audit', 'When', 'Progress', 'Status']}>
            {(q.data?.audits ?? []).map((a) => (
              <tr key={a.id} onDoubleClick={() => onOpen(a.id)} className="hover:bg-subtle">
                <td className={td}><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpen(a.id)}>{a.name}</button></td>
                <td className={td}>{shortDate(a.scheduled_for)}</td>
                <td className={td}>{`${a.progress.checked} of ${a.progress.total} · ${a.progress.missing} missing`}</td>
                <td className={td}><Badge status={a.status} /></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <aside aria-label="New audit" className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
        <h2 className="m-0 text-[13.5px] font-bold">New audit</h2>
        <Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Q4 audit — HQ Floor 2" /></Field>
        <Field label="Date"><input className={input} type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Category">
          <select className={input} value={cat} onChange={(e) => setCat(Number(e.target.value))}>
            <option value={0}>Every category</option>
            {(cats.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Site"><input className={input} value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
        <Btn primary disabled={ro || busy || !name.trim()} onClick={() => void create()}>Start audit</Btn>
      </aside>
    </div>
  );
}

function Run({ id, can, active }: { id: number; can: Can; active: boolean }) {
  const ro = useReadOnly() || !(can.audit || can.manage);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assets', 'audit', id], queryFn: ({ signal }) => apiGet<{ audit: Audit; lines: AuditLine[]; can_manage: boolean }>(`${BASE}/audits/${id}`, undefined, signal), refetchInterval: active ? 8_000 : false });
  const [sel, setSel] = useState<number | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const lines = q.data?.lines ?? [];
  const cur = lines.find((l) => l.id === sel) ?? null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['assets', 'audit', id] });

  const mark = async (l: AuditLine, found: boolean, outcome?: 'elsewhere') => {
    try {
      await checkAudit(id, { line_id: l.id, found, outcome: outcome ?? (found ? 'found' : 'missing'), condition: found ? (l.condition ?? 'good') : undefined, note: outcome ? 'Found elsewhere' : undefined });
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  const scan = async (c: string) => {
    if (ro || !c.trim()) return;
    setCode('');
    try {
      const r = await checkAudit(id, { asset_code: c.trim(), found: true, condition: 'good' });
      setLast(r.message ?? `${c.trim()} found.`);
      refresh();
    } catch (e) {
      setLast(`${c.trim()}: ${refusal(e)}`);
    }
  };
  useWedge((c) => void scan(c), active && !ro);

  useEffect(() => {
    if (!active || !cur || ro) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'f') void mark(cur, true);
      else if (k === 'e') void mark(cur, true, 'elsewhere');
      else if (k === 'm') void mark(cur, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (q.isPending) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data.audit;
  const p = a.progress;
  const complete = async () => {
    const unchecked = p.total - p.checked;
    if (unchecked > 0 && !window.confirm(`${unchecked} ${unchecked === 1 ? 'line is' : 'lines are'} not checked. Complete and mark them missing?`)) return;
    try {
      await completeAudit(id, unchecked > 0);
      toast('success', 'Audit completed.');
      void qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  const exportCsv = () =>
    void call('files:saveText', { name: `audit-${id}.csv`, text: toCsv(['Code', 'Asset', 'Expected', 'Found', 'Condition', 'Note', 'By', 'At'], lines.map((l) => [l.asset_code, l.asset, l.expected_location, l.found === null ? '' : l.found ? 'yes' : 'no', l.condition, l.note, l.checked_by, l.checked_at])) }).catch((e) => toast('error', refusal(e)));

  return (
    <div className="flex flex-col gap-3">
      <PageHead title={a.name} sub={`${p.checked} of ${p.total} checked · ${p.found} found · ${p.missing} missing`}>
        <Btn onClick={exportCsv}>Export</Btn>
        {a.status !== 'completed' ? <Btn primary disabled={ro} onClick={() => void complete()}>Complete audit</Btn> : <Badge status="completed" />}
      </PageHead>
      <div className="h-2 overflow-hidden rounded-full bg-subtle"><span className="block h-full bg-primary" style={{ width: `${p.total ? Math.round((p.checked / p.total) * 100) : 0}%` }} /></div>
      {a.status !== 'completed' ? (
        <input aria-label="Scan or type a code" className={input} placeholder="Scan an asset, or type its code and Enter" value={code} disabled={ro} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void scan(code)} />
      ) : null}
      {last ? <Note>{`Last scan: ${last}`}</Note> : null}
      <Card>
        <Table head={['Asset', 'Expected', 'Outcome', 'Condition', 'By']}>
          {lines.map((l) => (
            <tr key={l.id} onClick={() => setSel(l.id)} className={cx('cursor-default', l.id === sel ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
              <td className={td}><span className="font-mono text-[11px]">{l.asset_code}</span> {l.asset}</td>
              <td className={td}>{l.expected_location ?? '—'}</td>
              <td className={td}>{l.found === null ? (l.id === sel && !ro ? <span className="text-[11px] text-ink-3"><Kbd>F</Kbd> found · <Kbd>E</Kbd> elsewhere · <Kbd>M</Kbd> missing</span> : '—') : l.found ? <Badge status="available">{l.outcome === 'elsewhere' || l.note === 'Found elsewhere' ? `Elsewhere${l.actual_location ? ` · ${l.actual_location}` : ''}` : l.outcome === 'unexpected' ? 'Not expected here' : 'Found'}</Badge> : <Badge status="missing">Missing</Badge>}</td>
              <td className={td}>{l.condition ?? '—'}</td>
              <td className={td}>{l.checked_by ? `${l.checked_by} ${l.checked_at ? l.checked_at.slice(11, 16) : ''}` : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <p className="m-0 text-[11.5px] text-ink-3">Missing 30 days → offered for write-off by disposal. Never automatic. Two people can scan at once; lines update live.</p>
    </div>
  );
}
