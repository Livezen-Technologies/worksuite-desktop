import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiPost, apiPut } from '../../core/api';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal } from '../finance/api';
import { BASE, fetchLookups, statusLabel, type Lookup } from './api';
import { Badge, Btn, Card, Field, PageHead, Pills, Table, input, td, tdr, useReadOnly } from './parts';

/**
 * Lists & fields (D23): categories (with their code, default life and method), brands, models and types; add, rename,
 * archive and restore. How many assets use each is the server's count.
 */
const KINDS: Array<[string, string]> = [['categories', 'Categories'], ['brands', 'Brands'], ['models', 'Models'], ['types', 'Types']];

export default function Lookups({ kind, onKind }: { kind: string; onKind: (k: string) => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const k = KINDS.some(([x]) => x === kind) ? kind : 'categories';
  const q = useQuery({ queryKey: ['assets', 'lookups', k], queryFn: ({ signal }) => fetchLookups(k, signal) });
  const [sel, setSel] = useState<Lookup | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [life, setLife] = useState('');
  const [busy, setBusy] = useState(false);
  const cats = k === 'categories';
  const pick = (l: Lookup | null) => {
    setSel(l);
    setName(l?.name ?? '');
    setCode(l?.code ?? '');
    setLife(l?.default_life_months ? String(l.default_life_months) : '');
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      void qc.invalidateQueries({ queryKey: ['assets', 'lookups'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const body = () => ({ name: name.trim(), ...(cats ? { code: code.trim() || undefined, default_life_months: Number(life) || undefined } : {}) });

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-3">
        <PageHead title="Lists & fields">
          <Btn primary disabled={ro} onClick={() => pick(null)}>Add</Btn>
        </PageHead>
        <Pills label="List" value={k} onChange={(x) => (onKind(x), pick(null))} options={KINDS.map(([id, label]) => ({ id, label }))} />
        <Card>
          {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} /></div> : null}
          <Table head={cats ? ['Category', 'Code', ['Life', 'r'], 'Method', ['Assets', 'r'], ''] : ['Name', ['Assets', 'r'], '']}>
            {(q.data?.items ?? []).map((l) => (
              <tr key={l.id} onClick={() => pick(l)} className={cx('cursor-default', sel?.id === l.id ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                <td className={td}><b>{l.name}</b></td>
                {cats ? <td className={td}><span className="font-mono text-[11px]">{l.code ?? ''}</span></td> : null}
                {cats ? <td className={tdr}>{l.default_life_months ? `${l.default_life_months} mo` : '—'}</td> : null}
                {cats ? <td className={td}>{statusLabel(l.default_method)}</td> : null}
                <td className={tdr}>{l.assets}</td>
                <td className={td}>{l.status === 'archived' ? <Badge status="cancelled">Archived</Badge> : null}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <aside aria-label={sel ? sel.name : 'Add'} className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
        <h2 className="m-0 text-[13.5px] font-bold">{sel ? sel.name : `New ${KINDS.find(([x]) => x === k)![1].toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')}`}</h2>
        <Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {cats ? (
          <div className="flex gap-2">
            <Field label="Code" className="flex-1"><input className={input} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <Field label="Life (months)" className="flex-1"><input className={input} inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value)} /></Field>
          </div>
        ) : null}
        <Btn primary disabled={ro || busy || !name.trim()} onClick={() => void act(() => (sel ? apiPut(`${BASE}/lookups/${k}/${sel.id}`, body()) : apiPost(`${BASE}/lookups/${k}`, body())), 'Saved.')}>Save</Btn>
        {sel ? <Btn disabled={ro || busy} onClick={() => void act(() => apiPut(`${BASE}/lookups/${k}/${sel.id}`, { status: sel.status === 'active' ? 'archived' : 'active' }), sel.status === 'active' ? 'Archived.' : 'Restored.').then(() => pick(null))}>{sel.status === 'active' ? 'Archive' : 'Restore'}</Btn> : null}
      </aside>
    </div>
  );
}
